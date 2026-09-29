import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  deepLinkToSubscriptions,
  ErrorCode,
  getActiveSubscriptions,
  getAvailablePurchases,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
  type Product,
  type Purchase,
} from 'expo-iap';
import * as InAppPurchases from '../services/inAppPurchasesCompat';
import { router, Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { cacheService } from '../services/cacheService';
import { userSubscriptionIsActive } from '../services/supabase/userService';
import {
  effectivePremiumSkuForIos,
  getLastSubscriptionSyncError,
  handleStorePurchaseUpdate,
  syncSubscriptionAfterRestore,
} from '../services/subscriptionSyncService';
import { LEGAL_URLS } from '../constants/legal';

const PREMIUM_SKUS = ['marcaai_mensal_app', 'marcaai_anual_app'];
const PLAN_LABELS: Record<string, string> = {
  marcaai_mensal_app: 'Marca AI Premium Mensal',
  marcaai_anual_app: 'Marca AI Premium Anual',
  marcaai_mensal: 'Marca AI Premium Mensal',
  marcaai_anual: 'Marca AI Premium Anual',
};
const FREE_VS_PREMIUM = [
  { label: 'Perfis de artista', free: '1', premium: 'Ilimitados' },
  { label: 'Colaboradores por artista', free: 'Até 4', premium: 'Ilimitados' },
  { label: 'Financeiro', free: 'Básico', premium: 'Completo' },
  { label: 'Relatórios', free: 'Essenciais', premium: 'Avançados + PDF' },
  { label: 'Suporte', free: 'Padrão', premium: 'Prioritário' },
];
const MONTHLY_SKU = 'marcaai_mensal_app';
const ANNUAL_SKU = 'marcaai_anual_app';

/** Só carrega `fetchProducts` no iOS depois que o usuário confirma que vai usar conta Sandbox na folha da loja (evita login com Apple ID do aparelho por engano). */
const IOS_SANDBOX_IAP_ACK_KEY = 'marcaai_ios_sandbox_iap_ack_v1';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function openLegalUrl(url: string) {
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Erro', 'Não foi possível abrir o link.');
    }
  } catch {
    Alert.alert('Erro', 'Não foi possível abrir o link.');
  }
}

/**
 * StoreKit 2 (`Product.products(for:)`), não o delegate `productsRequest(_:didReceive:)`.
 * A Apple não devolve `invalidProductIdentifiers` ao JS: SKUs inválidos ou bloqueados simplesmente
 * não aparecem em `products`. Comparar pedido × resposta reproduz o mesmo diagnóstico.
 */
function logIapProductFetchDiagnostics(params: {
  attemptLabel: string;
  requestedSkus: readonly string[];
  rawProducts: Product[];
}) {
  if (!__DEV__) return;
  const returnedIds = params.rawProducts.map((p) => p.id);
  const returnedSet = new Set(returnedIds);
  const missingLikeInvalidIds = params.requestedSkus.filter((id) => !returnedSet.has(id));
  console.log(
    `[IAP debug] ${params.attemptLabel} — como productsRequest didReceive (StoreKit 2 / expo-iap):`,
    {
      requestedSkus: [...params.requestedSkus],
      productsLength: params.rawProducts.length,
      returnedProductIds: returnedIds,
      /** Se preenchido: equivalente a `invalidProductIdentifiers` (ID errado, contrato, app/bundle, etc.) */
      missingOrInvalidSkus: missingLikeInvalidIds,
    },
  );
  if (missingLikeInvalidIds.length > 0 && missingLikeInvalidIds.length < params.requestedSkus.length) {
    console.warn(
      '[IAP debug] Alguns SKUs não retornaram (como invalidProductIdentifiers na SK1). Revise IDs e contrato “Apps com pagamento” no App Store Connect.',
      missingLikeInvalidIds,
    );
  }
}

function logIapAllSkusMissingHint() {
  if (!__DEV__) return;
  console.warn(
    '[IAP debug] Nenhum produto na resposta para todos os SKUs pedidos, sem throw: costuma ser status do contrato, metadata/revisão no ASC, propagação da assinatura, ou (iOS) sessão da loja ainda não pronta após login sandbox — não confunda com “só autenticação errada”.',
  );
}

const parsePriceFromDisplay = (displayPrice: string): number | null => {
  const normalized = displayPrice.replace(/[^\d,.-]/g, '');
  if (!normalized) return null;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  const decimalSeparator = lastComma > lastDot ? ',' : '.';

  if (lastComma === -1 && lastDot === -1) {
    const integerValue = Number(normalized.replace(/[^\d-]/g, ''));
    return Number.isFinite(integerValue) ? integerValue : null;
  }

  const thousandSeparator = decimalSeparator === ',' ? '.' : ',';
  const withoutThousands = normalized.split(thousandSeparator).join('');
  const canonical = withoutThousands.replace(decimalSeparator, '.');
  const value = Number(canonical);
  return Number.isFinite(value) ? value : null;
};

const getProductPrice = (product?: Product): number | null => {
  if (!product) return null;
  if (typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0) {
    return product.price;
  }
  return parsePriceFromDisplay(product.displayPrice);
};

const getAnnualSavingsPercent = (monthlyProduct?: Product, annualProduct?: Product): number | null => {
  const monthly = getProductPrice(monthlyProduct);
  const annual = getProductPrice(annualProduct);
  if (!monthly || !annual) return null;

  const yearlyFromMonthly = monthly * 12;
  if (yearlyFromMonthly <= 0) return null;

  const savingsPercent = Math.round(((yearlyFromMonthly - annual) / yearlyFromMonthly) * 100);
  return savingsPercent > 0 ? savingsPercent : null;
};

/**
 * Qual SKU Premium está realmente ativo: mesmo grupo pode devolver várias linhas em getAvailablePurchases;
 * priorizamos o anual e usamos getActiveSubscriptions quando possível (iOS StoreKit 2).
 */
function resolveActivePremiumSkuFromPurchases(purchases: Purchase[]): string | null {
  const premium = purchases.filter((p) => PREMIUM_SKUS.includes(p.productId));
  if (!premium.length) return null;

  const now = Date.now();
  const valid = premium.filter((p) => {
    const exp = 'expirationDateIOS' in p ? p.expirationDateIOS : undefined;
    if (exp == null || exp === undefined) return true;
    return exp > now;
  });
  const pool = valid.length > 0 ? valid : premium;

  const annual = pool.find((p) => effectivePremiumSkuForIos(p) === ANNUAL_SKU);
  if (annual) return ANNUAL_SKU;

  const monthly = pool.find((p) => effectivePremiumSkuForIos(p) === MONTHLY_SKU);
  if (monthly) return MONTHLY_SKU;

  return pool[0] ? effectivePremiumSkuForIos(pool[0]) : null;
}

/**
 * StoreKit / Google Play frequentemente devolvem "usuário cancelou" quando o fluxo só foi
 * interrompido: cartão recusado, banco bloqueou, folha de verificação da Apple, etc.
 */
const IAP_PURCHASE_FLOW_INCOMPLETE_BODY =
  'A cobrança não foi concluída na loja. Isso pode ocorrer se o cartão foi recusado, o banco bloqueou a transação ou a Apple pediu verificação da conta em Ajustes → Apple ID → Pagamento e Envio. Confira e tente novamente.';

function sanitizeIapErrorMessage(message: string): string {
  return message
    .replace(/^Calling the ['"]requestPurchase['"] function has failed\s*->\s*Caused by:\s*/i, '')
    .replace(/^Calling the ['"]requestPurchase['"] function has failed\s*:\s*/i, '')
    .trim();
}

function purchaseErrorLooksLikeUserDismissal(error: unknown): boolean {
  const rec = error as { code?: string; message?: string };
  const code = rec?.code;
  if (
    code === ErrorCode.UserCancelled ||
    code === ErrorCode.Interrupted ||
    code === ErrorCode.DeferredPayment
  ) {
    return true;
  }
  const msg = (
    rec?.message ??
    (error instanceof Error ? error.message : typeof error === 'string' ? error : '')
  ).toLowerCase();
  return (
    msg.includes('user cancel') ||
    msg.includes('user_cancelled') ||
    msg.includes('user-cancelled') ||
    msg.includes('cancelled the purchase') ||
    msg.includes('canceled the purchase') ||
    msg.includes('e_user_cancelled')
  );
}

function userFacingPurchaseMessage(error: unknown): string {
  const rec = error as { code?: string; message?: string };
  const raw = rec?.message ?? (error instanceof Error ? error.message : '');
  const inner = raw ? sanitizeIapErrorMessage(raw) : '';
  const low = inner.toLowerCase();

  if (rec?.code === ErrorCode.NetworkError || low.includes('network')) {
    return 'Verifique sua conexão com a internet e tente novamente.';
  }
  if (
    rec?.code === ErrorCode.BillingUnavailable ||
    (low.includes('billing') && low.includes('unavailable'))
  ) {
    return 'A loja de aplicativos não está disponível no momento. Tente novamente em alguns minutos.';
  }
  if (rec?.code === ErrorCode.IapNotAvailable) {
    return 'Compras dentro do app não estão disponíveis neste dispositivo ou conta.';
  }
  if (rec?.code === ErrorCode.AlreadyOwned || low.includes('already owned')) {
    return 'Esta assinatura já consta na sua conta da loja. Use Restaurar compras para sincronizar.';
  }

  return 'Não foi possível concluir o pagamento. Verifique o método de pagamento na App Store ou Google Play e tente novamente.';
}

export default function AssinePremiumScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingSku, setProcessingSku] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [activeSku, setActiveSku] = useState<string | null>(null);
  const [planIsActive, setPlanIsActive] = useState(false);
  /** Evita Alert a cada abertura da tela: a loja pode reentregar compra sem o usuário ter tocado em “Assinar”. */
  const userStartedPurchaseFlowRef = useRef(false);
  /** Evita dois alerts seguidos (listener nativo + reject do requestPurchase). */
  const purchaseErrorAlertAtRef = useRef(0);

  const showDebouncedPurchaseAlert = useCallback((title: string, message: string) => {
    const now = Date.now();
    if (now - purchaseErrorAlertAtRef.current < 900) return;
    purchaseErrorAlertAtRef.current = now;
    Alert.alert(title, message);
  }, []);
  /** Um aviso em __DEV__ se a assinatura vier do StoreKit “Xcode” (local), não do sandbox Apple. */
  const warnedStoreKitXcodeRef = useRef(false);

  const [iosIapHydrated, setIosIapHydrated] = useState(Platform.OS !== 'ios');
  const [iosIapUserConfirmed, setIosIapUserConfirmed] = useState(Platform.OS !== 'ios');

  const refreshPlanFromDb = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setPlanIsActive(false);
      return;
    }
    const { active } = await userSubscriptionIsActive(user.id);
    setPlanIsActive(active);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPlanFromDb();
    }, [refreshPlanFromDb]),
  );

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AsyncStorage.getItem(IOS_SANDBOX_IAP_ACK_KEY)
      .then((v) => {
        if (v === '1') setIosIapUserConfirmed(true);
      })
      .finally(() => setIosIapHydrated(true));
  }, []);

  /** Atualiza qual SKU a loja considera ativo (para “Gerenciar assinatura”). */
  const syncPurchasedStatus = useCallback(async () => {
    try {
      const activeSubs = await getActiveSubscriptions(PREMIUM_SKUS);
      if (
        __DEV__ &&
        Platform.OS === 'ios' &&
        !warnedStoreKitXcodeRef.current &&
        activeSubs.some((s) => s.environmentIOS === 'Xcode')
      ) {
        warnedStoreKitXcodeRef.current = true;
        console.warn(
          '[assine-premium] Loja em ambiente Xcode (StoreKit local): webhooks da Apple e “Última compra” no App Store Connect não se aplicam. Para sandbox real: Edit Scheme → Run → Options → StoreKit Configuration = None; iPhone físico. Guia: ios/TESTE_SANDBOX_APPLE.md',
        );
      }
      const premiumRows = activeSubs.filter((s) => s.isActive && PREMIUM_SKUS.includes(s.productId));
      if (premiumRows.length > 0) {
        const annualRow = premiumRows.find((s) => effectivePremiumSkuForIos(s) === ANNUAL_SKU);
        const row = annualRow ?? premiumRows[0];
        const sku = row ? effectivePremiumSkuForIos(row) : null;
        setActiveSku(sku);
        return;
      }
    } catch {
      /* fallback abaixo */
    }

    const purchases = await getAvailablePurchases({
      onlyIncludeActiveItemsIOS: true,
    });
    const sku = resolveActivePremiumSkuFromPurchases(purchases);
    setActiveSku(sku);
  }, []);

  const loadProducts = useCallback(async (options?: { skipFullScreenLoading?: boolean }) => {
    try {
      setError(null);
      if (!options?.skipFullScreenLoading) {
        setLoading(true);
      }
      await InAppPurchases.connectAsync();

      const fetchPremiumSubsOnce = async (): Promise<{ filtered: Product[]; raw: Product[] }> => {
        const { results, responseCode } = await InAppPurchases.getProductsAsync([...PREMIUM_SKUS]);
        if (responseCode !== InAppPurchases.IAPResponseCode.OK) {
          if (__DEV__) {
            console.warn('[assine-premium] getProductsAsync respondeu com code:', responseCode);
          }
          return { filtered: [], raw: [] };
        }
        const raw = results;
        const filtered = raw.filter((p) => PREMIUM_SKUS.includes(p.id));
        return { filtered, raw };
      };

      /**
       * No iOS, após login sandbox da loja, a primeira busca de produtos pode voltar vazia;
       * novas tentativas com atraso substituem sync com a App Store (evita sheet de login).
       */
      let { filtered, raw } = await fetchPremiumSubsOnce();
      logIapProductFetchDiagnostics({
        attemptLabel: Platform.OS === 'ios' ? 'iOS tentativa 1' : 'Android tentativa 1',
        requestedSkus: PREMIUM_SKUS,
        rawProducts: raw,
      });

      if (Platform.OS === 'ios' && filtered.length === 0) {
        await sleep(1200);
        ({ filtered, raw } = await fetchPremiumSubsOnce());
        logIapProductFetchDiagnostics({
          attemptLabel: 'iOS tentativa 2 (após delay)',
          requestedSkus: PREMIUM_SKUS,
          rawProducts: raw,
        });
      }

      if (Platform.OS === 'ios' && filtered.length === 0) {
        await sleep(2200);
        ({ filtered, raw } = await fetchPremiumSubsOnce());
        logIapProductFetchDiagnostics({
          attemptLabel: 'iOS tentativa 3 (após delay)',
          requestedSkus: PREMIUM_SKUS,
          rawProducts: raw,
        });
      }

      if (filtered.length === 0) {
        logIapAllSkusMissingHint();
      }

      filtered.sort((a, b) => PREMIUM_SKUS.indexOf(a.id) - PREMIUM_SKUS.indexOf(b.id));
      setProducts(filtered);
      await syncPurchasedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar produtos da loja.';
      if (__DEV__) {
        console.warn(
          '[IAP debug] connect/getProducts falhou (rede, loja indisponível, query, etc.). Não é o mesmo caso “products vazio sem erro”.',
          e,
        );
      }
      setError(msg);
      setProducts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [syncPurchasedStatus]);

  const confirmIosSandboxAndConnectStore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await AsyncStorage.setItem(IOS_SANDBOX_IAP_ACK_KEY, '1');
      setIosIapUserConfirmed(true);
    } catch {
      setIosIapUserConfirmed(true);
    }
  }, []);

  const resetIosSandboxInstructions = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(IOS_SANDBOX_IAP_ACK_KEY);
    } catch {
      /* ignore */
    }
    setIosIapUserConfirmed(false);
    setProducts([]);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const subscriptions: { remove: () => void }[] = [];

    subscriptions.push(
      purchaseUpdatedListener(async (purchase: Purchase) => {
        if (!PREMIUM_SKUS.includes(purchase.productId)) return;

        const userStartedThisFlow = userStartedPurchaseFlowRef.current;
        try {
          const synced = await handleStorePurchaseUpdate(purchase);
          await syncPurchasedStatus();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id) await cacheService.invalidateUserData(user.id);
          if (synced) {
            await refreshPlanFromDb();
            router.back();
            return;
          }
          if (userStartedThisFlow) {
            Alert.alert(
              'Assinatura na loja',
              'A compra foi confirmada, mas não conseguimos atualizar seu plano no servidor. Tente Restaurar compras ou abra o app novamente.',
            );
          } else {
            console.warn(
              '[assine-premium] Sync com servidor falhou em evento da loja (sem fluxo iniciado na tela). Use Restaurar compras se o Premium não aparecer.',
            );
          }
        } catch {
          if (userStartedThisFlow) {
            Alert.alert(
              'Erro ao confirmar assinatura',
              'Sua compra foi processada, mas nao conseguimos finalizar automaticamente. Tente restaurar compras.',
            );
          } else {
            console.warn('[assine-premium] Erro ao processar atualização de compra em background.');
          }
        } finally {
          userStartedPurchaseFlowRef.current = false;
          setProcessingSku(null);
        }
      }),
    );

    subscriptions.push(
      purchaseErrorListener((purchaseError) => {
        const hadStartedFlow = userStartedPurchaseFlowRef.current;
        userStartedPurchaseFlowRef.current = false;
        setProcessingSku(null);
        const code = purchaseError?.code;
        if (
          code === ErrorCode.UserCancelled ||
          code === ErrorCode.Interrupted ||
          code === ErrorCode.DeferredPayment
        ) {
          if (hadStartedFlow) {
            showDebouncedPurchaseAlert('Assinatura não finalizada', IAP_PURCHASE_FLOW_INCOMPLETE_BODY);
          }
          return;
        }
        const friendly = userFacingPurchaseMessage(purchaseError);
        showDebouncedPurchaseAlert('Assinatura não concluída', friendly);
      }),
    );

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      // Não chamar disconnect/endConnection aqui: ao sair da tela isso derrubava a sessão da loja e o iOS
      // pedia login de novo ao voltar. Outras telas também usam IAP (ex.: reconcile). Só removemos listeners.
    };
  }, [loadProducts, refreshPlanFromDb, showDebouncedPurchaseAlert, syncPurchasedStatus]);

  useEffect(() => {
    if (!iosIapHydrated) return;
    if (Platform.OS === 'ios' && !iosIapUserConfirmed) {
      setLoading(false);
      return;
    }
    void loadProducts();
  }, [iosIapHydrated, iosIapUserConfirmed, loadProducts]);

  const onRefresh = async () => {
    if (Platform.OS === 'ios' && !iosIapUserConfirmed) {
      return;
    }
    setRefreshing(true);
    await loadProducts({ skipFullScreenLoading: true });
  };

  const handleAssinar = async (product: Product) => {
    if (activeSku === product.id) {
      try {
        await deepLinkToSubscriptions({
          packageNameAndroid: 'com.organizei.marcaai',
          skuAndroid: product.id,
        });
      } catch {
        Alert.alert('Nao foi possivel abrir assinaturas', 'Tente abrir o gerenciamento de assinaturas nas configuracoes da loja.');
      }
      return;
    }

    try {
      userStartedPurchaseFlowRef.current = true;
      setProcessingSku(product.id);
      if (Platform.OS === 'ios') {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) {
          userStartedPurchaseFlowRef.current = false;
          setProcessingSku(null);
          Alert.alert(
            'Entre na sua conta',
            'Para assinar o Premium, faça login no app. Assim vinculamos sua assinatura ao seu perfil.',
          );
          return;
        }
        await requestPurchase({
          type: 'subs',
          request: { apple: { sku: product.id, appAccountToken: user.id } },
        });
      } else {
        const {
          data: { user: androidUser },
        } = await supabase.auth.getUser();
        if (!androidUser?.id) {
          userStartedPurchaseFlowRef.current = false;
          setProcessingSku(null);
          Alert.alert(
            'Entre na sua conta',
            'Para assinar o Premium, faça login no app. Assim vinculamos sua assinatura ao seu perfil.',
          );
          return;
        }
        await requestPurchase({
          type: 'subs',
          request: {
            google: {
              skus: [product.id],
              obfuscatedAccountIdAndroid: androidUser.id,
              obfuscatedProfileIdAndroid: androidUser.id,
            },
          },
        });
      }
    } catch (purchaseStartError) {
      userStartedPurchaseFlowRef.current = false;
      setProcessingSku(null);
      if (purchaseErrorLooksLikeUserDismissal(purchaseStartError)) {
        showDebouncedPurchaseAlert('Assinatura não finalizada', IAP_PURCHASE_FLOW_INCOMPLETE_BODY);
        return;
      }
      showDebouncedPurchaseAlert(
        'Não foi possível assinar',
        userFacingPurchaseMessage(purchaseStartError),
      );
    }
  };

  const handleRestaurarCompras = async () => {
    try {
      setRestoring(true);
      await restorePurchases();
      const synced = await syncSubscriptionAfterRestore();
      await syncPurchasedStatus();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) await cacheService.invalidateUserData(user.id);
      await refreshPlanFromDb();
      const syncErr = getLastSubscriptionSyncError();
      if (syncErr === 'subscription_belongs_to_other_account') {
        Alert.alert(
          'Assinatura de outra conta',
          'Esta compra da loja já está vinculada a outro usuário do Marca AI. Entre na conta original ou fale com o suporte.',
        );
        return;
      }
      Alert.alert(
        synced ? 'Compras restauradas' : 'Restauração concluída',
        synced
          ? 'Seu plano Premium foi sincronizado com sucesso.'
          : 'Não encontramos assinatura Premium ativa nesta conta da loja. Se você assina em outro dispositivo, use a mesma Apple ID / Google.',
      );
    } catch (restoreError) {
      const details = restoreError instanceof Error ? restoreError.message : '';
      const msg = details
        ? `Nao foi possivel restaurar suas compras. Detalhes: ${details}`
        : 'Nao foi possivel restaurar suas compras.';
      Alert.alert('Erro ao restaurar compras', msg);
    } finally {
      setRestoring(false);
    }
  };

  const handleManageSubscription = useCallback(async () => {
    try {
      await deepLinkToSubscriptions({
        packageNameAndroid: 'com.organizei.marcaai',
        skuAndroid: activeSku ?? MONTHLY_SKU,
      });
    } catch {
      Alert.alert(
        'Nao foi possivel abrir assinaturas',
        'Para cancelar ou alterar seu plano, abra as assinaturas da App Store/Google Play.',
      );
    }
  }, [activeSku]);

  const monthlyProduct = products.find((item) => item.id === MONTHLY_SKU);
  const annualProduct = products.find((item) => item.id === ANNUAL_SKU);
  const annualSavingsPercent = getAnnualSavingsPercent(monthlyProduct, annualProduct);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Assine Premium</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {planIsActive ? (
          <View style={[styles.premiumActiveBanner, { backgroundColor: `${colors.primary}14`, borderColor: colors.primary }]}>
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            <View style={styles.premiumActiveBannerText}>
              <Text style={[styles.premiumActiveTitle, { color: colors.text }]}>Plano Premium ativo</Text>
              <Text style={[styles.premiumActiveSub, { color: colors.textSecondary }]}>
                Todos os recursos estão liberados na sua conta. Você pode gerenciar a cobrança na loja pelo plano contratado.
              </Text>
              <TouchableOpacity
                style={[styles.manageSubscriptionBtn, { backgroundColor: colors.primary }]}
                onPress={() => void handleManageSubscription()}
              >
                <Text style={styles.manageSubscriptionBtnText}>Gerenciar ou cancelar assinatura</Text>
              </TouchableOpacity>
              <Text style={[styles.manageSubscriptionHint, { color: colors.textSecondary }]}>
                O cancelamento e feito diretamente na App Store ou Google Play.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.compareCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.compareSectionTitle, { color: colors.text }]}>Free vs Premium</Text>
          <Text style={[styles.compareSectionHint, { color: colors.textSecondary }]}>
            O que você ganha ao assinar.
          </Text>

          <View style={[styles.tableHeader, { backgroundColor: colors.secondary }]}>
            <View style={styles.tableColFeature}>
              <Text style={[styles.tableHeadText, { color: colors.textSecondary }]}>Recurso</Text>
            </View>
            <View style={styles.tableColPlan}>
              <Text style={[styles.tableHeadText, { color: colors.textSecondary }]}>Free</Text>
            </View>
            <View style={styles.tableColPlan}>
              <Text style={[styles.tableHeadText, { color: colors.primary }]}>Premium</Text>
            </View>
          </View>

          {FREE_VS_PREMIUM.map((item, index) => (
            <View
              key={item.label}
              style={[
                styles.tableRow,
                { borderBottomColor: colors.border },
                index === FREE_VS_PREMIUM.length - 1 && styles.tableRowLast,
              ]}
            >
              <View style={styles.tableColFeature}>
                <Text style={[styles.tableCellFeature, { color: colors.text }]}>{item.label}</Text>
              </View>
              <View style={styles.tableColPlan}>
                <Text style={[styles.tableCellFree, { color: colors.textSecondary }]} numberOfLines={2}>
                  {item.free}
                </Text>
              </View>
              <View style={[styles.tableColPlan, styles.premiumCell]}>
                <Ionicons name="checkmark-circle" size={15} color={colors.primary} style={styles.premiumIcon} />
                <Text style={[styles.tableCellPremium, { color: colors.primary }]} numberOfLines={2}>
                  {item.premium}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={[styles.plansSectionLabel, { color: colors.textSecondary }]}>Planos</Text>

        {Platform.OS === 'ios' && !iosIapHydrated ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Preparando instruções da loja…</Text>
          </View>
        ) : null}

        {Platform.OS === 'ios' && iosIapHydrated && !iosIapUserConfirmed ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
            <Text style={[styles.emptyText, { color: colors.text, fontWeight: '800', fontSize: 15 }]}>
              Teste Sandbox (Apple) — leia antes de carregar os planos
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 10 }]}>
              1) Em <Text style={{ fontWeight: '700', color: colors.text }}>Ajustes → Compras na iTunes Store e App Store</Text>, saia da conta sandbox se estiver logado lá.
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 8 }]}>
              2) Toque no botão abaixo. Quando o iPhone pedir login da loja, use o{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>e-mail e senha do testador Sandbox</Text> criado em App Store Connect (Usuários e acesso → Sandbox) —{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>não</Text> a senha só da Apple ID do aparelho, se for outra conta.
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 8 }]}>
              3) “Entrar com a Apple” no login do app usa sua Apple ID real; isso é separado da compra de teste.
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary, marginTop: 16, alignSelf: 'stretch' }]}
              onPress={() => void confirmIosSandboxAndConnectStore()}
            >
              <Text style={styles.retryBtnText}>Estou pronto — carregar planos da App Store</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 14, alignSelf: 'center' }} onPress={() => void resetIosSandboxInstructions()}>
              <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>Limpar confirmação e ver de novo</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error && Platform.OS === 'ios' && iosIapUserConfirmed && products.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.text, fontWeight: '700' }]}>
              Se você deixou a conta sandbox logada em Ajustes → Compras / App Store
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 6 }]}>
              Saia dessa conta:{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>Ajustes → [seu nome] → Compras na iTunes Store e App Store → Sair</Text>. Use sua Apple ID pessoal no iCloud ou fique sem login de compras. A sandbox entra{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>só</Text> na janela que o iPhone abre ao carregar planos ou ao assinar. Assim evita pedir senha várias vezes e lista vazia.
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
              Se os planos não aparecerem: aguarde ou{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>puxe para atualizar</Text> / use o botão abaixo.
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 10 }]}>
              <Text style={{ fontWeight: '700', color: colors.text }}>“Nenhuma assinatura”</Text> na loja é normal até você{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>concluir uma compra de teste</Text> (botão Assinar até o final). Só digitar senha ao abrir a tela não cria assinatura.
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary, marginTop: 12 }]}
              onPress={() => {
                setRefreshing(true);
                void loadProducts({ skipFullScreenLoading: true });
              }}
            >
              <Text style={styles.retryBtnText}>Atualizar loja agora</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading && (Platform.OS !== 'ios' || iosIapUserConfirmed) ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Carregando planos...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => void loadProducts()}>
              <Text style={styles.retryBtnText}>Tentar novamente</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error && (Platform.OS !== 'ios' || iosIapUserConfirmed)
          ? PREMIUM_SKUS.map((sku) => {
              const product = products.find((item) => item.id === sku);
              const productName = product?.displayName || product?.title || PLAN_LABELS[sku] || sku;
              const productPrice = product?.displayPrice || 'Valor indisponível';
              const rawDescription = product?.description?.trim() ?? '';
              const showDescription = rawDescription.length > 0 && rawDescription !== 'Produto ainda não retornado pela loja.';
              const unavailable = !product;
              const isAnnual = sku === ANNUAL_SKU;
              const isHighlighted = isAnnual && annualSavingsPercent !== null;
              const isThisSkuInStore = activeSku === sku;
              const premiumLocked = planIsActive && !isThisSkuInStore;

              return (
                <View
                  key={sku}
                  style={[
                    styles.planCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: isHighlighted ? colors.primary : colors.border,
                      shadowColor: isHighlighted ? colors.primary : '#000',
                    },
                  ]}
                >
                <View style={styles.planTop}>
                  <View style={styles.planTitleBlock}>
                    <Text style={[styles.planPeriod, { color: colors.textSecondary }]}>
                      {isAnnual ? 'Cobrança anual' : 'Cobrança mensal'}
                    </Text>
                    <Text style={[styles.planTitle, { color: colors.text }]} numberOfLines={2}>
                      {productName}
                    </Text>
                  </View>
                  <Text style={[styles.planPrice, { color: colors.primary }]}>{productPrice}</Text>
                </View>
                <View style={styles.planTags}>
                  {isHighlighted ? (
                    <View style={[styles.highlightTag, { backgroundColor: `${colors.primary}18` }]}>
                      <Ionicons name="diamond" size={12} color={colors.primary} />
                      <Text style={[styles.highlightTagText, { color: colors.primary }]}>Melhor custo</Text>
                    </View>
                  ) : null}
                  {sku === ANNUAL_SKU && annualSavingsPercent !== null ? (
                    <View style={[styles.savingsTag, { backgroundColor: `${colors.success}22` }]}>
                      <Text style={[styles.savingsTagText, { color: colors.success }]}>−{annualSavingsPercent}%</Text>
                    </View>
                  ) : null}
                  {activeSku === sku ? (
                    <View style={[styles.activeTag, { backgroundColor: `${colors.primary}20` }]}>
                      <Text style={[styles.activeTagText, { color: colors.primary }]}>Ativo</Text>
                    </View>
                  ) : null}
                </View>
                {showDescription ? (
                  <Text style={[styles.planDesc, { color: colors.textSecondary }]} numberOfLines={3}>
                    {rawDescription}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.planBtn,
                    {
                      backgroundColor: premiumLocked ? colors.textSecondary : colors.primary,
                      opacity:
                        unavailable || premiumLocked || (processingSku && processingSku !== sku) ? 0.55 : 1,
                    },
                  ]}
                  onPress={() => {
                    if (product && !premiumLocked) void handleAssinar(product);
                  }}
                  disabled={unavailable || !!processingSku || premiumLocked}
                >
                  {processingSku === sku ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.planBtnText}>
                      {unavailable
                        ? 'Indisponível'
                        : premiumLocked
                          ? 'Incluso no seu Premium'
                          : isThisSkuInStore
                            ? 'Gerenciar assinatura'
                            : isAnnual
                              ? 'Assinar plano anual'
                              : 'Assinar plano mensal'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
              );
            })
          : null}

        <TouchableOpacity
          style={[styles.restoreBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={handleRestaurarCompras}
          disabled={restoring || (Platform.OS === 'ios' && !iosIapUserConfirmed)}
        >
          {restoring ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="refresh" size={16} color={colors.primary} />}
          <Text style={[styles.restoreBtnText, { color: colors.text }]}>Restaurar compras</Text>
        </TouchableOpacity>
        <Text style={[styles.restoreHint, { color: colors.textSecondary }]}>
          Use esta opcao se voce ja assinou antes e quer reativar seu acesso neste aparelho.
        </Text>

        <View style={styles.legalBlock}>
          <Text style={[styles.legalIntro, { color: colors.textSecondary }]}>
            O nome do plano, o valor e o período (mensal ou anual) aparecem nos cartões acima. A assinatura é renovada
            automaticamente até você cancelar nas configurações da loja.
          </Text>
          <View style={styles.legalLinksRow}>
            <TouchableOpacity onPress={() => void openLegalUrl(LEGAL_URLS.PRIVACY_POLICY)} accessibilityRole="link">
              <Text style={[styles.legalLink, { color: colors.primary }]}>Política de Privacidade</Text>
            </TouchableOpacity>
            <Text style={[styles.legalDot, { color: colors.textSecondary }]}> · </Text>
            <TouchableOpacity onPress={() => void openLegalUrl(LEGAL_URLS.TERMS_OF_USE_EULA)} accessibilityRole="link">
              <Text style={[styles.legalLink, { color: colors.primary }]}>Termos de Uso (EULA)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  premiumActiveBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  premiumActiveBannerText: { flex: 1, gap: 4 },
  premiumActiveTitle: { fontSize: 16, fontWeight: '800' },
  premiumActiveSub: { fontSize: 13, lineHeight: 18 },
  manageSubscriptionBtn: {
    marginTop: 8,
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  manageSubscriptionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  manageSubscriptionHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  header: {
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  compareCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 0,
    paddingBottom: 4,
    overflow: 'hidden',
  },
  compareSectionTitle: { fontSize: 18, fontWeight: '800', paddingHorizontal: 16, marginBottom: 4 },
  compareSectionHint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, marginBottom: 14 },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  tableHeadText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRowLast: { borderBottomWidth: 0 },
  tableColFeature: { flex: 1.15, minWidth: 0, paddingRight: 6 },
  tableColPlan: { flex: 1, minWidth: 0, paddingLeft: 2 },
  tableCellFeature: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  tableCellFree: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  tableCellPremium: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  premiumCell: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  premiumIcon: { marginTop: 1 },
  plansSectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
    marginBottom: -4,
  },
  restoreBtn: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  restoreBtnText: { fontSize: 14, fontWeight: '600' },
  restoreHint: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: -2 },
  legalBlock: { gap: 10, marginTop: 4, paddingHorizontal: 4 },
  legalIntro: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  legalLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  legalLink: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  legalDot: { fontSize: 13 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 12 },
  errorText: { fontSize: 14, fontWeight: '600' },
  emptyText: { fontSize: 14, lineHeight: 20 },
  retryBtn: { alignSelf: 'flex-start', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  planCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  planTitleBlock: { flex: 1, minWidth: 0, gap: 4 },
  planPeriod: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  planTitle: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  planPrice: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  planTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  highlightTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  highlightTagText: { fontSize: 11, fontWeight: '800' },
  activeTag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  activeTagText: { fontSize: 11, fontWeight: '800' },
  savingsTag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  savingsTagText: { fontSize: 11, fontWeight: '800' },
  planDesc: { fontSize: 13, lineHeight: 19 },
  planBtn: { borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  planBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
