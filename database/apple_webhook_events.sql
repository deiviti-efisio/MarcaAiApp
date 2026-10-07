-- =====================================================
-- Idempotência das App Store Server Notifications V2
-- Executar no SQL Editor do Supabase ANTES ou junto do deploy
-- da Edge Function activate-subscription.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apple_webhook_events (
  notification_uuid text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('processing', 'processed', 'failed')),
  claimed_at timestamptz,
  processed_at timestamptz,
  user_id uuid,
  transaction_id text,
  signed_date timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apple_webhook_events_status
  ON public.apple_webhook_events (status);

CREATE INDEX IF NOT EXISTS idx_apple_webhook_events_user_id
  ON public.apple_webhook_events (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.apple_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.apple_webhook_events IS
  'Claim de notificationUUID da Apple (ASN V2). Escrita só via service_role da Edge Function.';
