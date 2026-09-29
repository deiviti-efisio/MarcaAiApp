import { useEffect } from 'react';
import {
  initConnection,
  purchaseUpdatedListener,
  type Purchase,
} from 'expo-iap';
import { handleStorePurchaseUpdate } from '../services/subscriptionSyncService';

const PREMIUM_SKUS = ['marcaai_mensal_app', 'marcaai_anual_app'];

/**
 * Escuta compras da loja em qualquer tela (não só em Assine Premium).
 */
export default function IapPurchaseSyncHost() {
  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;

    void initConnection()
      .then((ok) => {
        if (!ok || cancelled) return;
        const sub = purchaseUpdatedListener(async (purchase: Purchase) => {
          if (!PREMIUM_SKUS.includes(purchase.productId)) return;
          try {
            await handleStorePurchaseUpdate(purchase);
          } catch {
            /* ignore */
          }
        });
        remove = () => sub.remove();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}
