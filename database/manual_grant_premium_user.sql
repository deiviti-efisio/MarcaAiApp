-- =====================================================
-- Liberar Premium manualmente (cortesia / testes / equipe)
-- =====================================================
-- O app NÃO usa só users.plan_is_active. O que vale é:
--   user_subscriptions.status IN ('active', 'grace_period')
--   AND (expires_at IS NULL OR expires_at > now())
-- Depois o script também marca users.plan_is_active = true.
--
-- metadata.source DEVE começar com 'manual_db' (ex.: manual_db).
-- Assim o reconcile Apple/Google NÃO expira essa linha.
--
-- No DECLARE: use UUID OU e-mail (não os dois vazios).
-- Depois execute só o bloco DO $$ ... END $$;
-- =====================================================

DO $$
DECLARE
  -- Opção A: UUID (Authentication → Users, ou SELECT id, email FROM auth.users ...)
  v_user uuid := NULL;

  -- Opção B: e-mail em auth.users (se usar, deixe v_user = NULL)
  v_lookup_email text := NULL;

  -- Duração da cortesia
  v_duration interval := interval '1 year';

  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_orig text;
  v_tx text;
BEGIN
  IF v_lookup_email IS NOT NULL AND btrim(v_lookup_email) <> '' THEN
    SELECT au.id
    INTO v_user
    FROM auth.users au
    WHERE lower(au.email) = lower(btrim(v_lookup_email))
    LIMIT 1;
    IF v_user IS NULL THEN
      RAISE EXCEPTION
        'E-mail não encontrado em auth.users: "%". Confira Authentication → Users.',
        btrim(v_lookup_email);
    END IF;
  END IF;

  IF v_user IS NULL THEN
    RAISE EXCEPTION
      'Defina v_user := ''SEU-UUID''::uuid OU v_lookup_email := ''email@exemplo.com''.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN
    RAISE EXCEPTION 'UUID não encontrado em auth.users: %', v_user;
  END IF;

  v_orig := 'manual_grant_' || v_suffix || '_orig';
  v_tx := 'manual_grant_' || v_suffix || '_txn';

  UPDATE public.user_subscriptions
  SET
    status = 'expired',
    updated_at = now()
  WHERE user_id = v_user
    AND status IN ('active', 'grace_period', 'pending');

  INSERT INTO public.user_subscriptions (
    user_id,
    product_id,
    billing_period,
    platform,
    status,
    purchased_at,
    expires_at,
    cancelled_at,
    store_original_transaction_id,
    store_latest_transaction_id,
    auto_renew,
    metadata
  ) VALUES (
    v_user,
    'marcaai_anual_app',
    'annual',
    'ios',
    'active',
    now(),
    now() + v_duration,
    NULL,
    v_orig,
    v_tx,
    false,
    jsonb_build_object(
      'source', 'manual_db',
      'granted_at', now(),
      'apple_store_confirmed', true
    )
  );

  UPDATE public.users
  SET
    plan_is_active = true,
    updated_at = now()
  WHERE id = v_user;
END $$;

-- Conferir
-- SELECT id, email FROM auth.users WHERE email ilike '%parte%';
-- SELECT user_id, status, expires_at, metadata, platform
-- FROM public.user_subscriptions
-- WHERE user_id = 'UUID-AQUI'
-- ORDER BY updated_at DESC LIMIT 5;

-- =====================================================
-- Já existe linha? Só reativar (mesmo usuário)
-- Troque o UUID. Mantém a linha, não cria outra.
-- =====================================================
-- UPDATE public.user_subscriptions
-- SET
--   status = 'active',
--   expires_at = now() + interval '1 year',
--   cancelled_at = NULL,
--   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
--     'source', 'manual_db',
--     'granted_at', now(),
--     'apple_store_confirmed', true
--   ),
--   updated_at = now()
-- WHERE id = (
--   SELECT id FROM public.user_subscriptions
--   WHERE user_id = 'UUID-AQUI'::uuid
--   ORDER BY updated_at DESC
--   LIMIT 1
-- );
--
-- UPDATE public.users
-- SET plan_is_active = true, updated_at = now()
-- WHERE id = 'UUID-AQUI'::uuid;
