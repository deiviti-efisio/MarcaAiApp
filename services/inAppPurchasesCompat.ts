/**
 * API no estilo legado `expo-in-app-purchases` (connectAsync / getProductsAsync / IAPResponseCode),
 * implementada com `expo-iap` — um único módulo nativo, recomendado no Expo SDK atual.
 *
 * Não instale o pacote `expo-in-app-purchases` junto com `expo-iap`: haveria conflito na loja.
 */
import { endConnection, fetchProducts, initConnection, type Product } from 'expo-iap';
import { storePurchaseSkus } from '../constants/iapSkus';

/** Valores alinhados ao enum clássico da Expo (OK = sucesso da consulta). */
export const IAPResponseCode = {
  OK: 0,
  USER_CANCELED: 1,
  DEFERRED: 2,
  ERROR: 3,
} as const;

export type IAPResponseCodeValue = (typeof IAPResponseCode)[keyof typeof IAPResponseCode];

export const subscriptionIds = storePurchaseSkus();

export async function connectAsync(): Promise<void> {
  const ok = await initConnection();
  if (!ok) {
    throw new Error('Não foi possível conectar à loja.');
  }
}

export async function disconnectAsync(): Promise<void> {
  await endConnection();
}

export async function getProductsAsync(
  ids: string[],
): Promise<{ results: Product[]; responseCode: IAPResponseCodeValue }> {
  try {
    const raw = (await fetchProducts({
      skus: ids,
      type: 'subs',
    })) as Product[] | null;
    const results = (raw ?? []).filter((p): p is Product => typeof p?.id === 'string');
    return { results, responseCode: IAPResponseCode.OK };
  } catch {
    return { results: [], responseCode: IAPResponseCode.ERROR };
  }
}

export async function carregarAssinaturas(
  ids: readonly string[] = subscriptionIds,
): Promise<Product[] | null> {
  try {
    await connectAsync();
    const { results, responseCode } = await getProductsAsync([...ids]);

    if (responseCode === IAPResponseCode.OK) {
      if (__DEV__) {
        console.log('[IAP] Assinaturas carregadas com sucesso:', results);
      }
      return results;
    }
    console.warn('[IAP] Erro na resposta da loja. Code:', responseCode);
    return null;
  } catch (error) {
    console.error('[IAP] Falha ao inicializar IAP:', error);
    return null;
  }
}
