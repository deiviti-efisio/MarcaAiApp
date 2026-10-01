import {
  finishTransaction,
  getActiveSubscriptions,
  getAvailablePurchases,
  initConnection,
  type ActiveSubscription,
  type Purchase,
} from 'expo-iap';
import { Platform } from 'react-native';
import { ALL_PREMIUM_SKUS, isAnnualSku, isPremiumSku } from '../constants/iapSkus';
import { supabase } from '../lib/supabase';
import { cacheService } from './cacheService';
import { checkUserSubscriptionFromTable } from './supabase/userService';

const DAY_MS = 86_400_000;

/** Teto do que o cliente pode enviar (mensal ~40 dias, anual ~400). */
function clientExpiryCapMs(productId: string): number {
  return Date.now() + (isAnnualSku(productId) ? 400 : 40) * DAY_MS;
}

/**
 * Data de expiração enviada ao backend.
 * Android quase nunca traz expiry da Play: usa 32/400 dias.
 * iOS usa a data da StoreKit, limitada ao teto (evita “10 anos” forjados).
 */
export function resolveExpiresAtMs(
  productId: string,
  storeExpiresMs: number | null | undefined,
  platform: 'ios' | 'android',
): number {
  const cap = clientExpiryCapMs(productId);
  if (storeExpiresMs != null && Number.isFinite(storeExpiresMs) && storeExpiresMs > Date.now()) {
    return Math.min(storeExpiresMs, cap);
  }
  if (platform === 'android') {
    return Date.now() + (isAnnualSku(productId) ? 400 : 32) * DAY_MS;
  }
  return Date.now() + 2 * DAY_MS;
}

/**
 * iOS (StoreKit 2): a linha de assinatura pode vir com `productId` ainda mensal enquanto o usuário
 * fez upgrade para anual — o anual aparece em `pendingUpgradeProductId` / `autoRenewPreference`.
 */
export function effectivePremiumSkuForIos(row: {
  productId: string;
  renewalInfoIOS?: {
    autoRenewPreference?: string | null;
    pendingUpgradeProductId?: string | null;
  } | null;
}): string {
  const candidates = [
    row.renewalInfoIOS?.pendingUpgradeProductId,
    row.renewalInfoIOS?.autoRenewPreference,
    row.productId,
  ].filter(
    (id): id is string => typeof id === 'string' && isPremiumSku(id),
  );

  const annual = candidates.find(isAnnualSku);
  if (annual) return annual;
  if (candidates[0]) return candidates[0];
  return row.productId;
}

type SyncPayload = {
  source: 'after_purchase' | 'reconcile';
  platform: 'ios' | 'android';
  productId: string;
  transactionId?: string | null;
  originalTransactionId?: string | null;
  purchaseToken?: string | null;
  expiresAtMs?: number | null;
  purchasedAtMs?: number | null;
  autoRenew?: boolean | null;
};

function resolveActivePremiumPurchase(purchases: Purchase[]): Purchase | null {
  const premium = purchases.filter((p) => isPremiumSku(p.productId));
  if (!premium.length) return null;

  const now = Date.now();
  const valid = premium.filter((p) => {
    const exp = 'expirationDateIOS' in p ? p.expirationDateIOS : undefined;
    if (exp == null || exp === undefined) return true;
    return exp > now;
  });
  const pool = valid.length > 0 ? valid : premium;

  const annual = pool.find((p) => isAnnualSku(effectivePremiumSkuForIos(p)));
  if (annual) return annual;
  return pool[0] ?? null;
}

function purchaseToPayload(purchase: Purchase, source: SyncPayload['source']): SyncPayload {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  if (platform === 'ios') {
    const p = purchase as Purchase & {
      originalTransactionIdentifierIOS?: string;
      expirationDateIOS?: number;
      originalTransactionDateIOS?: number;
      renewalInfoIOS?: {
        autoRenewPreference?: string | null;
        pendingUpgradeProductId?: string | null;
      } | null;
    };
    return {
      source,
      platform: 'ios',
      productId: effectivePremiumSkuForIos(p),
      transactionId: p.transactionId ?? null,
      originalTransactionId: p.originalTransactionIdentifierIOS ?? p.transactionId ?? null,
      purchaseToken: purchase.purchaseToken ?? null,
      expiresAtMs: resolveExpiresAtMs(effectivePremiumSkuForIos(p), p.expirationDateIOS ?? null, 'ios'),
      purchasedAtMs: p.originalTransactionDateIOS ?? purchase.transactionDate,
      autoRenew: purchase.isAutoRenewing,
    };
  }

  return {
    source,
    platform: 'android',
    productId: purchase.productId,
    transactionId: purchase.transactionId ?? null,
    originalTransactionId: purchase.purchaseToken ?? purchase.transactionId ?? null,
    purchaseToken: purchase.purchaseToken ?? null,
    expiresAtMs: resolveExpiresAtMs(purchase.productId, null, 'android'),
    purchasedAtMs: purchase.transactionDate,
    autoRenew: purchase.isAutoRenewing,
  };
}

let lastSyncError: string | null = null;

export function getLastSubscriptionSyncError(): string | null {
  return lastSyncError;
}

async function rpcSync(payload: SyncPayload): Promise<boolean> {
  const expiresMs =
    payload.expiresAtMs != null && Number.isFinite(payload.expiresAtMs)
      ? Math.round(payload.expiresAtMs)
      : null;
  const purchasedMs =
    payload.purchasedAtMs != null && Number.isFinite(payload.purchasedAtMs)
      ? Math.round(payload.purchasedAtMs)
      : null;

  const { data, error } = await supabase.rpc('sync_user_subscription_from_client', {
    p_reconcile_clear: false,
    p_product_id: payload.productId,
    p_platform: payload.platform,
    p_transaction_id: payload.transactionId ?? null,
    p_original_transaction_id: payload.originalTransactionId ?? null,
    p_purchase_token: payload.purchaseToken ?? null,
    p_expires_at_ms: expiresMs,
    p_purchased_at_ms: purchasedMs,
    p_auto_renew: payload.autoRenew ?? true,
    p_source: payload.source,
  });

  if (error) {
    console.warn('[subscriptionSync] rpc error', error.message);
    lastSyncError = error.message;
    return false;
  }

  const row = data as { ok?: boolean; error?: string } | null;
  if (row && row.ok === false && row.error) {
    console.warn('[subscriptionSync] sync failed', row.error);
    lastSyncError = row.error;
    return false;
  }
  lastSyncError = null;
  return row?.ok === true;
}

/** Marca assinaturas ativas no banco como expiradas e `plan_is_active = false` (loja sem Premium). */
async function rpcReconcileClear(): Promise<boolean> {
  const { data, error } = await supabase.rpc('sync_user_subscription_from_client', {
    p_reconcile_clear: true,
  });

  if (error) {
    console.warn('[subscriptionSync] reconcile clear rpc error', error.message);
    return false;
  }

  const row = data as { ok?: boolean; error?: string } | null;
  if (row && row.ok === false && row.error) {
    console.warn('[subscriptionSync] reconcile clear failed', row.error);
    return false;
  }
  return row?.ok === true;
}

function pickBestActiveSubscription(rows: ActiveSubscription[]): ActiveSubscription | null {
  const premium = rows.filter(
    (s) => s.isActive && isPremiumSku(s.productId),
  );
  if (!premium.length) return null;

  const now = Date.now();
  const valid = premium.filter((s) => {
    const exp = s.expirationDateIOS;
    if (exp == null || exp === undefined) return true;
    return exp > now;
  });
  const pool = valid.length > 0 ? valid : premium;

  const annual = pool.find((s) => isAnnualSku(effectivePremiumSkuForIos(s)));
  if (annual) return annual;
  return pool[0] ?? null;
}

function activeSubscriptionToPayload(sub: ActiveSubscription): SyncPayload {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const iosSub = sub as ActiveSubscription & {
    originalTransactionIdentifierIOS?: string | null;
  };
  const productId =
    platform === 'ios'
      ? effectivePremiumSkuForIos({
          productId: sub.productId,
          renewalInfoIOS: sub.renewalInfoIOS ?? null,
        })
      : sub.productId;

  if (platform === 'ios') {
    return {
      source: 'reconcile',
      platform: 'ios',
      productId,
      transactionId: sub.transactionId ?? null,
      originalTransactionId: iosSub.originalTransactionIdentifierIOS ?? sub.transactionId ?? null,
      purchaseToken: sub.purchaseToken ?? null,
      expiresAtMs: resolveExpiresAtMs(productId, sub.expirationDateIOS ?? null, 'ios'),
      purchasedAtMs: sub.transactionDate,
      autoRenew: sub.renewalInfoIOS?.willAutoRenew ?? true,
    };
  }

  return {
    source: 'reconcile',
    platform: 'android',
    productId,
    transactionId: sub.transactionId ?? null,
    originalTransactionId: sub.purchaseTokenAndroid ?? sub.purchaseToken ?? sub.transactionId ?? null,
    purchaseToken: sub.purchaseTokenAndroid ?? sub.purchaseToken ?? null,
    expiresAtMs: resolveExpiresAtMs(productId, null, 'android'),
    purchasedAtMs: sub.transactionDate,
    autoRenew: sub.autoRenewingAndroid ?? true,
  };
}

export type ReconcileResult =
  | 'synced'
  | 'cleared'
  | 'skipped_no_session'
  | 'skipped_init_failed'
  | 'skipped_store_unavailable'
  | 'rpc_failed';

let reconcileInFlight: Promise<ReconcileResult> | null = null;

export type RefreshSubscriptionFromDbResult = {
  /** True quando pending passou da janela de 1 dia sem confirmação da loja (usuário volta ao free). */
  paymentConfirmationFailed?: boolean;
};

/**
 * Após login / foreground: expira pending vencido, revalida tabela + cache.
 */
export async function refreshSubscriptionStateFromDatabase(): Promise<RefreshSubscriptionFromDbResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return {};

  let stale = false;
  try {
    const { data: expireData, error: expireErr } = await supabase.rpc(
      'expire_stale_pending_subscriptions_for_user',
    );
    if (expireErr && __DEV__) {
      console.warn('[subscriptionSync] expire_stale_pending_subscriptions_for_user', expireErr.message);
    }
    if (
      !expireErr &&
      expireData &&
      typeof expireData === 'object' &&
      (expireData as { stale_pending_expired?: boolean }).stale_pending_expired === true
    ) {
      stale = true;
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[subscriptionSync] expire stale pending RPC indisponível', e);
    }
  }

  await checkUserSubscriptionFromTable(userId);
  await cacheService.invalidateUserData(userId).catch(() => undefined);

  return { paymentConfirmationFailed: Boolean(stale) };
}

/**
 * Alinha `user_subscriptions` com a loja (IAP), sem bloquear UI.
 * - Loja com Premium ativo → RPC sync (upsert / atualiza expiração).
 * - Loja sem Premium (consulta bem-sucedida e vazia) → RPC reconcile_clear.
 * Não chama `endConnection` (outras telas podem usar IAP).
 *
 * iOS: não usa `syncIOS()` em lugar nenhum deste serviço — evita App Store sync / restore automático
 * e o sheet de login da Apple (reconcile roda no login e ao voltar ao foreground).
 */
export async function reconcileSubscriptionWithStore(): Promise<ReconcileResult> {
  if (reconcileInFlight) return reconcileInFlight;

  reconcileInFlight = (async (): Promise<ReconcileResult> => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return 'skipped_no_session';

      const okInit = await initConnection().catch(() => false);
      if (!okInit) return 'skipped_init_failed';

      let payload: SyncPayload | null = null;
      let storeResponded = false;

      try {
        const activeSubs = await getActiveSubscriptions([...ALL_PREMIUM_SKUS]);
        storeResponded = true;
        const best = pickBestActiveSubscription(activeSubs);
        if (best) {
          payload = activeSubscriptionToPayload(best);
        }
      } catch {
        /* tenta getAvailablePurchases */
      }

      if (!payload) {
        try {
          const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
          storeResponded = true;
          const purchase = resolveActivePremiumPurchase(purchases);
          if (purchase) {
            payload = purchaseToPayload(purchase, 'reconcile');
          }
        } catch {
          if (!storeResponded) {
            return 'skipped_store_unavailable';
          }
        }
      }

      if (!storeResponded) {
        return 'skipped_store_unavailable';
      }

      if (payload) {
        const ok = await rpcSync(payload);
        if (ok) {
          await cacheService.invalidateUserData(userId).catch(() => undefined);
          return 'synced';
        }
        return 'rpc_failed';
      }

      const cleared = await rpcReconcileClear();
      if (cleared) {
        await cacheService.invalidateUserData(userId).catch(() => undefined);
        return 'cleared';
      }
      return 'rpc_failed';
    } finally {
      reconcileInFlight = null;
    }
  })();

  return reconcileInFlight;
}

/** Após compra confirmada na loja (listener). Retorna se o Supabase confirmou o sync. */
export async function syncSubscriptionAfterPurchase(purchase: Purchase): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return false;
  if (!isPremiumSku(purchase.productId)) return false;

  const payload = purchaseToPayload(purchase, 'after_purchase');
  return rpcSync(payload);
}

/** Após restaurar compras: envia assinatura Premium ativa para o backend. */
export async function syncSubscriptionAfterRestore(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return false;

  const okInit = await initConnection().catch(() => false);
  if (!okInit) return false;

  const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
  const purchase = resolveActivePremiumPurchase(purchases);
  if (purchase) {
    return syncSubscriptionAfterPurchase(purchase);
  }
  return false;
}

const recentPurchaseKeys = new Map<string, number>();

/**
 * Finaliza a transação na loja e sincroniza o Premium (deduplica eventos duplos).
 * Usar no host global e na tela Assine Premium.
 */
export async function handleStorePurchaseUpdate(purchase: Purchase): Promise<boolean> {
  if (!isPremiumSku(purchase.productId)) {
    return false;
  }
  const key = String(
    purchase.transactionId || purchase.purchaseToken || `${purchase.productId}:${purchase.transactionDate ?? 0}`,
  );
  const now = Date.now();
  const prev = recentPurchaseKeys.get(key);
  if (prev != null && now - prev < 10_000) {
    return true;
  }
  recentPurchaseKeys.set(key, now);

  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch {
    /* já finalizada */
  }

  const synced = await syncSubscriptionAfterPurchase(purchase);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user?.id) {
    await cacheService.invalidateUserData(session.user.id).catch(() => undefined);
  }
  return synced;
}
