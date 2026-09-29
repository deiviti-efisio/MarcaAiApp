-- =====================================================
-- Verificação de Premium a partir de user_subscriptions
-- Inclui pending com expires_at no futuro (aguardando webhook Apple).
-- Executar no SQL Editor do Supabase após a tabela existir.
-- =====================================================

CREATE OR REPLACE FUNCTION public.user_subscription_is_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions s
    WHERE s.user_id = p_user_id
      AND (
        (
          s.status IN ('active', 'grace_period')
          AND (s.expires_at IS NULL OR s.expires_at > now())
        )
        OR (
          s.status = 'pending'
          AND s.expires_at IS NOT NULL
          AND s.expires_at > now()
          AND COALESCE((s.metadata->>'apple_store_confirmed')::boolean, false) = false
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_subscription_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_subscription_is_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_subscription_is_active(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.any_users_have_active_subscription(p_user_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.user_subscriptions s
      WHERE s.user_id = ANY (p_user_ids)
        AND (
          (
            s.status IN ('active', 'grace_period')
            AND (s.expires_at IS NULL OR s.expires_at > now())
          )
          OR (
            s.status = 'pending'
            AND s.expires_at IS NOT NULL
            AND s.expires_at > now()
            AND COALESCE((s.metadata->>'apple_store_confirmed')::boolean, false) = false
          )
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.any_users_have_active_subscription(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.any_users_have_active_subscription(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.any_users_have_active_subscription(uuid[]) TO service_role;

COMMENT ON FUNCTION public.user_subscription_is_active(uuid) IS
  'Premium: active/grace_period com expiração válida OU pending (sem confirmação Apple) com expires_at > agora (janela até webhook).';

COMMENT ON FUNCTION public.any_users_have_active_subscription(uuid[]) IS
  'Indica se algum dos usuários tem assinatura vigente (inclui pending na janela).';

-- Expira pending/active provisório cuja janela passou sem apple_store_confirmed; recalcula plan_is_active.
CREATE OR REPLACE FUNCTION public.expire_stale_pending_subscriptions_for_user()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  n int := 0;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  WITH upd AS (
    UPDATE public.user_subscriptions s
    SET
      status = 'expired',
      metadata = s.metadata
        || jsonb_build_object(
          'pending_expired_reason', 'webhook_not_confirmed_in_window',
          'pending_expired_at', clock_timestamp(),
          'provisional_active', false
        )
    WHERE s.user_id = uid
      AND s.status IN ('pending', 'active')
      AND s.expires_at IS NOT NULL
      AND s.expires_at <= clock_timestamp()
      AND COALESCE((s.metadata->>'apple_store_confirmed')::boolean, false) = false
      AND COALESCE(s.metadata->>'source', '') NOT LIKE 'manual_db%'
    RETURNING s.id
  )
  SELECT count(*)::int INTO n FROM upd;

  UPDATE public.users u
  SET plan_is_active = public.user_subscription_is_active(u.id)
  WHERE u.id = uid;

  RETURN jsonb_build_object(
    'ok', true,
    'stale_pending_expired', n > 0,
    'expired_rows', n
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_pending_subscriptions_for_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_subscriptions_for_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_subscriptions_for_user() TO service_role;

COMMENT ON FUNCTION public.expire_stale_pending_subscriptions_for_user() IS
  'Marca pending/active provisório vencido como expired (não apaga): mantém store_*_transaction_id e metadata para o webhook ASN ainda encontrar a linha por transactionId e atualizar para active se a Apple confirmar tarde. Atualiza users.plan_is_active.';
