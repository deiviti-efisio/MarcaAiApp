-- =====================================================
-- RPC: sincronizar assinatura IAP → user_subscriptions + users.plan_is_active
-- Executar no SQL Editor do Supabase (como postgres).
-- O app chama: supabase.rpc('sync_user_subscription_from_client', { ... })
-- Usa auth.uid() — não confie em user_id vindo do cliente.
-- =====================================================

CREATE OR REPLACE FUNCTION public.sync_user_subscription_from_client(
  p_reconcile_clear boolean DEFAULT false,
  p_product_id text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_transaction_id text DEFAULT NULL,
  p_original_transaction_id text DEFAULT NULL,
  p_purchase_token text DEFAULT NULL,
  p_expires_at_ms bigint DEFAULT NULL,
  p_purchased_at_ms bigint DEFAULT NULL,
  p_auto_renew boolean DEFAULT TRUE,
  p_source text DEFAULT 'client_sync'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_tx text;
  v_orig text;
  v_source text;
  v_now_ms bigint;
  v_status text;
  v_make_provisional_active boolean := false;
  v_purchased timestamptz;
  v_expires timestamptz;
  v_expires_from_store timestamptz;
  v_existing_tx_id uuid;
  v_existing_sub_id uuid;
  v_existing_confirmed_ios_id uuid;
  v_billing text;
  v_plan_active boolean;
  v_product text;
  v_cap_end timestamptz;
  v_fallback_end timestamptz;
  v_other_owner uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Reconcile sem loja: expira apenas linhas “da loja”. Linhas manuais
  -- (metadata.source = 'manual_db') permanecem active para cortesias / testes.
  IF p_reconcile_clear THEN
    UPDATE public.user_subscriptions
    SET status = 'expired'
    WHERE user_id = uid
      AND status IN ('active', 'grace_period', 'pending')
      AND COALESCE(metadata->>'source', '') <> 'manual_db';

    UPDATE public.users u
    SET plan_is_active = public.user_subscription_is_active(u.id)
    WHERE u.id = uid;

    RETURN jsonb_build_object('ok', true, 'action', 'cleared');
  END IF;

  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_product');
  END IF;

  v_product := btrim(p_product_id);
  IF v_product = '' OR v_product NOT IN (
    'marcaai_mensal_app',
    'marcaai_anual_app',
    'marcaai_mensal',
    'marcaai_anual'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_product');
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_platform');
  END IF;

  v_tx := nullif(btrim(coalesce(p_transaction_id, '')), '');
  IF v_tx IS NULL AND p_purchase_token IS NOT NULL AND btrim(p_purchase_token) <> '' THEN
    v_tx := 'gplay:' || left(btrim(p_purchase_token), 120);
  END IF;

  IF v_tx IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_transaction_or_token');
  END IF;

  v_orig := nullif(btrim(coalesce(p_original_transaction_id, '')), '');
  IF v_orig IS NULL THEN
    v_orig := v_tx;
  END IF;

  SELECT s.user_id INTO v_other_owner
  FROM public.user_subscriptions s
  WHERE s.user_id IS DISTINCT FROM uid
    AND s.status IN ('active', 'grace_period', 'pending')
    AND (
      s.store_latest_transaction_id = v_tx
      OR (v_orig IS NOT NULL AND s.store_original_transaction_id = v_orig)
    )
  LIMIT 1;

  IF v_other_owner IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'subscription_belongs_to_other_account');
  END IF;

  v_now_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;
  v_source := COALESCE(nullif(btrim(p_source), ''), 'client_sync');

  -- Após compra concluída no app (iOS/Android): libera Premium imediato
  -- como active provisório até confirmação oficial da loja/webhook.
  IF v_source = 'after_purchase' THEN
    v_make_provisional_active := true;
  END IF;

  IF p_expires_at_ms IS NOT NULL AND p_expires_at_ms < v_now_ms THEN
    v_status := 'expired';
  ELSE
    v_status := CASE
      WHEN v_make_provisional_active THEN 'active'
      ELSE 'pending'
    END;
  END IF;

  IF p_purchased_at_ms IS NOT NULL THEN
    v_purchased := to_timestamp(p_purchased_at_ms / 1000.0);
  ELSE
    v_purchased := NULL;
  END IF;

  IF p_expires_at_ms IS NOT NULL THEN
    v_expires_from_store := to_timestamp(p_expires_at_ms / 1000.0);
  ELSE
    v_expires_from_store := NULL;
  END IF;

  -- SKU fixo (PT/EN por nome do produto na loja) — não usar só LIKE '%annual%'
  -- senão marcaai_anual_app cai no ELSE e vira monthly.
  v_billing := CASE v_product
    WHEN 'marcaai_anual_app' THEN 'annual'
    WHEN 'marcaai_anual' THEN 'annual'
    WHEN 'marcaai_mensal_app' THEN 'monthly'
    WHEN 'marcaai_mensal' THEN 'monthly'
    ELSE 'monthly'
  END;

  v_cap_end := clock_timestamp() + CASE v_billing
    WHEN 'annual' THEN interval '400 days'
    ELSE interval '40 days'
  END;
  v_fallback_end := clock_timestamp() + CASE
    WHEN p_platform = 'android' THEN CASE v_billing
      WHEN 'annual' THEN interval '400 days'
      ELSE interval '32 days'
    END
    WHEN v_source = 'after_purchase' THEN interval '2 days'
    ELSE interval '1 day'
  END;

  IF v_expires_from_store IS NOT NULL AND v_expires_from_store > v_cap_end THEN
    v_expires_from_store := v_cap_end;
  END IF;

  SELECT s.id INTO v_existing_tx_id
  FROM public.user_subscriptions s
  WHERE s.user_id = uid AND s.store_latest_transaction_id = v_tx
  ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
  LIMIT 1;

  IF v_existing_tx_id IS NOT NULL THEN
    UPDATE public.user_subscriptions SET
      product_id = v_product,
      billing_period = v_billing,
      platform = p_platform,
      status = CASE
        WHEN v_status = 'expired' THEN 'expired'
        WHEN status = 'expired'
          AND v_status = 'pending'
          AND p_platform = 'ios'
          AND p_expires_at_ms IS NOT NULL
          AND p_expires_at_ms > v_now_ms THEN
          CASE
            WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false) THEN 'active'
            ELSE 'pending'
          END
        WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false)
          AND status IN ('active', 'grace_period') THEN status
        ELSE CASE
          WHEN v_make_provisional_active THEN 'active'
          ELSE 'pending'
        END
      END,
      purchased_at = v_purchased,
      expires_at = CASE
        WHEN v_status = 'expired' THEN v_expires_from_store
        WHEN status = 'expired'
          AND v_status = 'pending'
          AND p_platform = 'ios'
          AND p_expires_at_ms IS NOT NULL
          AND p_expires_at_ms > v_now_ms THEN
          COALESCE(v_expires_from_store, to_timestamp(p_expires_at_ms / 1000.0))
        WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false)
          AND status IN ('active', 'grace_period') THEN COALESCE(v_expires_from_store, expires_at)
        ELSE COALESCE(v_expires_from_store, v_fallback_end)
      END,
      auto_renew = COALESCE(p_auto_renew, TRUE),
      metadata = CASE
        WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false) THEN
          metadata
            || jsonb_build_object(
              'client_resync_at_ms', v_now_ms,
              'source', COALESCE(v_source, metadata->>'source', 'client_sync'),
              'provisional_active', false
            )
        ELSE jsonb_build_object(
          'source', v_source,
          'purchaseTokenPresent', (p_purchase_token IS NOT NULL AND btrim(p_purchase_token) <> ''),
          'apple_store_confirmed', false,
          'client_sync_at_ms', v_now_ms,
          'store_expires_at_client_ms', p_expires_at_ms,
          'provisional_active', v_make_provisional_active,
          'provisional_until_ms', COALESCE(p_expires_at_ms, v_now_ms + 86400000)
        )
      END
    WHERE id = v_existing_tx_id;

    SELECT
      CASE
        WHEN s.status = 'revoked' OR s.status = 'expired' THEN false
        WHEN s.status IN ('active', 'grace_period') THEN true
        WHEN s.status = 'pending'
          AND s.expires_at IS NOT NULL
          AND s.expires_at > clock_timestamp()
          AND COALESCE((s.metadata->>'apple_store_confirmed')::boolean, false) = false
          THEN true
        ELSE false
      END
    INTO v_plan_active
    FROM public.user_subscriptions s
    WHERE s.id = v_existing_tx_id;

    UPDATE public.users SET plan_is_active = COALESCE(v_plan_active, false) WHERE id = uid;
    RETURN jsonb_build_object('ok', true, 'action', 'noop_idempotent');
  END IF;

  SELECT s.id INTO v_existing_sub_id
  FROM public.user_subscriptions s
  WHERE s.user_id = uid AND s.store_original_transaction_id = v_orig
  ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
  LIMIT 1;

  IF v_existing_sub_id IS NOT NULL THEN
    UPDATE public.user_subscriptions SET
      product_id = v_product,
      billing_period = v_billing,
      platform = p_platform,
      status = CASE
        WHEN v_status = 'expired' THEN 'expired'
        WHEN status = 'expired'
          AND v_status = 'pending'
          AND p_platform = 'ios'
          AND p_expires_at_ms IS NOT NULL
          AND p_expires_at_ms > v_now_ms THEN
          CASE
            WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false) THEN 'active'
            ELSE 'pending'
          END
        WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false)
          AND status IN ('active', 'grace_period') THEN status
        ELSE CASE
          WHEN v_make_provisional_active THEN 'active'
          ELSE 'pending'
        END
      END,
      purchased_at = v_purchased,
      expires_at = CASE
        WHEN v_status = 'expired' THEN v_expires_from_store
        WHEN status = 'expired'
          AND v_status = 'pending'
          AND p_platform = 'ios'
          AND p_expires_at_ms IS NOT NULL
          AND p_expires_at_ms > v_now_ms THEN
          COALESCE(v_expires_from_store, to_timestamp(p_expires_at_ms / 1000.0))
        WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false)
          AND status IN ('active', 'grace_period') THEN COALESCE(v_expires_from_store, expires_at)
        ELSE COALESCE(v_expires_from_store, v_fallback_end)
      END,
      cancelled_at = NULL,
      store_original_transaction_id = v_orig,
      store_latest_transaction_id = v_tx,
      auto_renew = COALESCE(p_auto_renew, TRUE),
      metadata = CASE
        WHEN COALESCE((metadata->>'apple_store_confirmed')::boolean, false) THEN
          metadata
            || jsonb_build_object(
              'client_resync_at_ms', v_now_ms,
              'source', COALESCE(v_source, metadata->>'source', 'client_sync'),
              'provisional_active', false
            )
        ELSE jsonb_build_object(
          'source', v_source,
          'purchaseTokenPresent', (p_purchase_token IS NOT NULL AND btrim(p_purchase_token) <> ''),
          'apple_store_confirmed', false,
          'client_sync_at_ms', v_now_ms,
          'store_expires_at_client_ms', p_expires_at_ms,
          'provisional_active', v_make_provisional_active,
          'provisional_until_ms', COALESCE(p_expires_at_ms, v_now_ms + 86400000)
        )
      END
    WHERE id = v_existing_sub_id;

    SELECT
      CASE
        WHEN s.status = 'revoked' OR s.status = 'expired' THEN false
        WHEN s.status IN ('active', 'grace_period') THEN true
        WHEN s.status = 'pending'
          AND s.expires_at IS NOT NULL
          AND s.expires_at > clock_timestamp()
          AND COALESCE((s.metadata->>'apple_store_confirmed')::boolean, false) = false
          THEN true
        ELSE false
      END
    INTO v_plan_active
    FROM public.user_subscriptions s
    WHERE s.id = v_existing_sub_id;

    UPDATE public.users SET plan_is_active = COALESCE(v_plan_active, false) WHERE id = uid;
    RETURN jsonb_build_object('ok', true, 'action', 'updated');
  END IF;

  -- iOS reconcile não deve alterar status/datas quando já existe confirmação Apple.
  -- Nesse cenário, apenas webhook ASN V2 deve atualizar a assinatura.
  IF v_status = 'pending' AND p_platform = 'ios' THEN
    SELECT s.id INTO v_existing_confirmed_ios_id
    FROM public.user_subscriptions s
    WHERE s.user_id = uid
      AND s.platform = 'ios'
      AND s.product_id = v_product
      AND COALESCE((s.metadata->>'apple_store_confirmed')::boolean, false) = true
      AND s.status IN ('active', 'grace_period', 'expired')
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1;

    IF v_existing_confirmed_ios_id IS NOT NULL
       AND v_source = 'reconcile' THEN
      UPDATE public.users
      SET plan_is_active = public.user_subscription_is_active(uid)
      WHERE id = uid;

      RETURN jsonb_build_object('ok', true, 'action', 'noop_reconcile_waiting_apple_webhook');
    END IF;
  END IF;

  -- iOS reconcile sem match em linha existente: não inserir pending novo.
  -- A criação/atualização deve vir do webhook da Apple.
  IF v_status = 'pending'
     AND p_platform = 'ios'
     AND v_source = 'reconcile' THEN
    UPDATE public.users
    SET plan_is_active = public.user_subscription_is_active(uid)
    WHERE id = uid;

    RETURN jsonb_build_object('ok', true, 'action', 'noop_reconcile_waiting_apple_webhook');
  END IF;

  -- Nova compra IAP (pending): só expira outras pendentes da loja; não mexe em active/grace (webhook troca depois).
  IF v_status = 'pending' THEN
    UPDATE public.user_subscriptions
    SET status = 'expired'
    WHERE user_id = uid
      AND status = 'pending'
      AND COALESCE(metadata->>'source', '') <> 'manual_db';
  END IF;

  -- Não-expired: usa data da loja quando existir; senão janela curta (+1 dia) até confirmação.
  IF v_status = 'expired' THEN
    v_expires := v_expires_from_store;
  ELSE
    v_expires := COALESCE(v_expires_from_store, v_fallback_end);
  END IF;

  INSERT INTO public.user_subscriptions (
    user_id, product_id, billing_period, platform, status,
    purchased_at, expires_at, cancelled_at,
    store_original_transaction_id, store_latest_transaction_id,
    auto_renew, metadata
  ) VALUES (
    uid, v_product, v_billing, p_platform, v_status,
    v_purchased, v_expires, NULL,
    v_orig, v_tx,
    COALESCE(p_auto_renew, TRUE),
    jsonb_build_object(
      'source', v_source,
      'purchaseTokenPresent', (p_purchase_token IS NOT NULL AND btrim(p_purchase_token) <> ''),
      'apple_store_confirmed', false,
      'client_sync_at_ms', v_now_ms,
      'store_expires_at_client_ms', p_expires_at_ms,
      'provisional_active', v_make_provisional_active,
      'provisional_until_ms', COALESCE(p_expires_at_ms, v_now_ms + 86400000)
    )
  );

  UPDATE public.users
  SET plan_is_active = public.user_subscription_is_active(uid)
  WHERE id = uid;

  RETURN jsonb_build_object('ok', true, 'action', 'inserted');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unique_violation');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'db_error', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_subscription_from_client(
  boolean, text, text, text, text, text, bigint, bigint, boolean, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_user_subscription_from_client(
  boolean, text, text, text, text, text, bigint, bigint, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.sync_user_subscription_from_client(
  boolean, text, text, text, text, text, bigint, bigint, boolean, text
) TO service_role;

COMMENT ON FUNCTION public.sync_user_subscription_from_client IS
  'IAP: after_purchase libera active; Android usa 32/400 dias; iOS sem data da loja usa 2 dias até o webhook; teto de expiry no cliente; recusa transação já ligada a outra conta.';
