import { Platform } from 'react-native';

/** IDs atuais no App Store Connect (grupo MeuShow). */
export const IOS_MONTHLY_SKU = 'meushow_990';
export const IOS_ANNUAL_SKU = 'meushow_9990';

/** IDs atuais na Play Store (inalterados). */
export const ANDROID_MONTHLY_SKU = 'marcaai_mensal_app';
export const ANDROID_ANNUAL_SKU = 'marcaai_anual_app';

const LEGACY_APPLE_SKUS = ['marcaai_mensal_app', 'marcaai_anual_app', 'marcaai_mensal', 'marcaai_anual'] as const;

export const ANNUAL_PRODUCT_IDS = new Set<string>([
  IOS_ANNUAL_SKU,
  ANDROID_ANNUAL_SKU,
  'marcaai_anual',
]);

export const MONTHLY_PRODUCT_IDS = new Set<string>([
  IOS_MONTHLY_SKU,
  ANDROID_MONTHLY_SKU,
  'marcaai_mensal',
]);

/** Todos os IDs que o app reconhece (compra atual + legado). */
export const ALL_PREMIUM_SKUS: string[] = [
  IOS_MONTHLY_SKU,
  IOS_ANNUAL_SKU,
  ...LEGACY_APPLE_SKUS,
];

export const PLAN_LABELS: Record<string, string> = {
  [IOS_MONTHLY_SKU]: 'MeuShow Premium Mensal',
  [IOS_ANNUAL_SKU]: 'MeuShow Premium Anual',
  marcaai_mensal_app: 'MeuShow Premium Mensal',
  marcaai_anual_app: 'MeuShow Premium Anual',
  marcaai_mensal: 'MeuShow Premium Mensal',
  marcaai_anual: 'MeuShow Premium Anual',
};

export function isAnnualSku(productId: string): boolean {
  return ANNUAL_PRODUCT_IDS.has(productId);
}

export function isPremiumSku(productId: string): boolean {
  return MONTHLY_PRODUCT_IDS.has(productId) || ANNUAL_PRODUCT_IDS.has(productId);
}

/** SKUs oferecidos na tela de compra desta plataforma. */
export function storePurchaseSkus(): [string, string] {
  if (Platform.OS === 'ios') {
    return [IOS_MONTHLY_SKU, IOS_ANNUAL_SKU];
  }
  return [ANDROID_MONTHLY_SKU, ANDROID_ANNUAL_SKU];
}

export function storeMonthlySku(): string {
  return storePurchaseSkus()[0];
}

export function storeAnnualSku(): string {
  return storePurchaseSkus()[1];
}
