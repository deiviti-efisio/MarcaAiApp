import { useEffect } from 'react';
import {
  initConnection,
  purchaseUpdatedListener,
  type Purchase,
} from 'expo-iap';
import { isPremiumSku } from '../constants/iapSkus';
import { handleStorePurchaseUpdate } from '../services/subscriptionSyncService';

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
          if (!isPremiumSku(purchase.productId)) return;
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
