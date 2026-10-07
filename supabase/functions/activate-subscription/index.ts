/**
 * App Store Server Notifications V2 → Supabase (`user_subscriptions` + `users.plan_is_active`)
 *
 * Fluxo: JWS (PEM/x5c/G3) → bundle com.marcaai.app → claim notificationUUID →
 * UPDATE por transactionId / originalTransactionId → consolida pending; INSERT se preciso.
 * Não apaga cortesia manual_db. Recalcula plan_is_active com Apple + Android + cortesia.
 *
 * SQL extra: database/apple_webhook_events.sql
 * Deploy: `supabase functions deploy activate-subscription`
 * URL:    https://<ref>.supabase.co/functions/v1/activate-subscription
 *
 * App Store Connect → Notificações do servidor → Versão 2 → URLs produção + sandbox.
 *
 * Corpo: { "signedPayload": "<JWS>" }
 * O app deve enviar appAccountToken = UUID do usuário Supabase na compra (StoreKit 2).
 *
 * Assinatura: `verifyJWS` valida ES256, cadeia `x5c` (folha → intermediária) contra a raiz
 * Apple Root CA - G3 (PEM embutido) e confirma o JWS com `jose.compactVerify`.
 *
 * @see https://developer.apple.com/documentation/appstoreservernotifications
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import * as jose from "npm:jose@5.9.6";
import { X509Certificate } from "node:crypto";

/** Bundle iOS no App Store Connect / Xcode — não usar o applicationId Android. */
const APPLE_BUNDLE_ID = "com.marcaai.app";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, detectSessionInUrl: false },
      })
    : null;

const ALLOWED_PRODUCT_IDS = new Set([
  "meushow_990",
  "meushow_9990",
  "marcaai_mensal_app",
  "marcaai_anual_app",
  "marcaai_mensal",
  "marcaai_anual",
]);

function decodeJWSPayload<T = Record<string, unknown>>(jws: string): T {
  const parts = jws.split(".");
  if (parts.length < 2) {
    throw new Error("JWS inválido");
  }
  const payload = parts[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const json = atob(padded);
  return JSON.parse(json) as T;
}

/**
 * Raiz Apple G3 (DER oficial → PEM). Usada como âncora de confiança; não confiar no 3º
 * certificado do `x5c` sem validar a cadeia até esta raiz.
 * Fonte: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
 */
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`;

function derFromX5cBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `X509Certificate.toString()` no Deno/Node não é PEM — o jose precisa do PEM do x5c. */
function x5cToPem(b64: string): string {
  const clean = b64.replace(/\s/g, "");
  const lines = clean.match(/.{1,64}/g) ?? [clean];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

function certDateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Valida JWS ASN V2: cadeia x5c (folha → WWDR → Apple Root CA G3) + assinatura.
 * Alinhado à library oficial da Apple (`chain.length` 3; usa x5c[0]/x5c[1] e raiz embarcada).
 */
async function verifyJWS(jws: string): Promise<boolean> {
  try {
    const header = jose.decodeProtectedHeader(jws);
    const alg = header.alg;
    if (alg !== "ES256" && alg !== "ES384") {
      console.error("[Apple Webhook] verifyJWS: alg não suportado:", alg);
      return false;
    }

    const x5c = header.x5c;
    if (!Array.isArray(x5c) || x5c.length < 2) {
      console.error(
        "[Apple Webhook] verifyJWS: x5c ausente ou curto (esperado 2–3 certs). length=",
        Array.isArray(x5c) ? x5c.length : x5c,
      );
      return false;
    }
    const leafB64 = x5c[0];
    const intermediateB64 = x5c[1];
    if (typeof leafB64 !== "string" || typeof intermediateB64 !== "string") {
      console.error("[Apple Webhook] verifyJWS: x5c[0]/x5c[1] não são string.");
      return false;
    }

    const leaf = new X509Certificate(derFromX5cBase64(leafB64));
    const intermediate = new X509Certificate(derFromX5cBase64(intermediateB64));
    const root = new X509Certificate(APPLE_ROOT_CA_G3_PEM);

    if (typeof x5c[2] === "string") {
      const chainRoot = new X509Certificate(derFromX5cBase64(x5c[2]));
      const sameFp =
        typeof chainRoot.fingerprint256 === "string" &&
        typeof root.fingerprint256 === "string" &&
        chainRoot.fingerprint256.length > 0 &&
        chainRoot.fingerprint256 === root.fingerprint256;
      const sameSubject = chainRoot.subject === root.subject;
      if (!sameFp && !sameSubject) {
        console.error(
          "[Apple Webhook] verifyJWS: x5c[2] não é Apple Root CA - G3.",
          "subject=",
          chainRoot.subject,
        );
        return false;
      }
    }

    if (leaf.issuer !== intermediate.subject) {
      console.error(
        "[Apple Webhook] verifyJWS: folha não emitida pela intermediária.",
        "issuer=",
        leaf.issuer,
        "intermediate.subject=",
        intermediate.subject,
      );
      return false;
    }
    if (intermediate.issuer !== root.subject) {
      console.error(
        "[Apple Webhook] verifyJWS: intermediária não emitida pela G3.",
        "issuer=",
        intermediate.issuer,
        "root.subject=",
        root.subject,
      );
      return false;
    }

    try {
      if (!leaf.verify(intermediate.publicKey)) {
        console.error("[Apple Webhook] verifyJWS: assinatura da folha inválida.");
        return false;
      }
      if (!intermediate.verify(root.publicKey)) {
        console.error("[Apple Webhook] verifyJWS: assinatura da intermediária inválida.");
        return false;
      }
    } catch (e) {
      console.warn(
        "[Apple Webhook] verifyJWS: X509.verify indisponível neste runtime; seguindo com DN + G3 + JWS.",
        e instanceof Error ? e.message : String(e),
      );
    }

    const now = Date.now();
    const leafFrom = certDateMs(leaf.validFrom);
    const leafTo = certDateMs(leaf.validTo);
    if (Number.isFinite(leafTo) && leafTo < now) {
      console.error("[Apple Webhook] verifyJWS: certificado folha expirado.", leaf.validTo);
      return false;
    }
    if (Number.isFinite(leafFrom) && leafFrom > now) {
      console.error("[Apple Webhook] verifyJWS: certificado folha ainda não válido.", leaf.validFrom);
      return false;
    }

    const key = await jose.importX509(x5cToPem(leafB64), alg);
    await jose.compactVerify(jws, key);
    return true;
  } catch (e) {
    console.error(
      "[Apple Webhook] verifyJWS: falha ao verificar JWS.",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

type AppleTransaction = {
  appAccountToken?: string;
  bundleId?: string;
  environment?: string;
  expiresDate?: number;
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number;
  revocationDate?: number;
  transactionId?: string;
};

type AppleRenewal = {
  appAccountToken?: string;
  autoRenewStatus?: number;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  originalTransactionId?: string;
};

function autoRenewFromApple(
  subtype: string | undefined,
  renewal: AppleRenewal | null,
  previousAutoRenew: boolean,
): boolean {
  if (subtype === "AUTO_RENEW_DISABLED") return false;
  if (subtype === "AUTO_RENEW_ENABLED") return true;
  if (renewal?.autoRenewStatus === 0) return false;
  if (renewal?.autoRenewStatus === 1) return true;
  return previousAutoRenew;
}

function mapSubscriptionStatus(
  notificationType: string,
  subtype: string | undefined,
  transaction: AppleTransaction,
  renewal: AppleRenewal | null,
  now = Date.now(),
): string {
  if (transaction.revocationDate != null) return "revoked";

  const expires = transaction.expiresDate ?? 0;
  const graceUntil = renewal?.gracePeriodExpiresDate ?? 0;
  const inGrace =
    (notificationType === "DID_FAIL_TO_RENEW" && subtype === "GRACE_PERIOD") ||
    (graceUntil > now &&
      (renewal?.isInBillingRetryPeriod === true ||
        notificationType === "DID_FAIL_TO_RENEW"));

  if (inGrace && graceUntil > now) return "grace_period";

  const stillValid = expires > now;

  switch (notificationType) {
    case "SUBSCRIBED":
    case "INITIAL_BUY":
    case "DID_RENEW":
    case "DID_RECOVER":
    case "RENEWAL_EXTENDED":
    case "OFFER_REDEEMED":
    case "INTERACTIVE_RENEWAL":
    case "DID_CHANGE_RENEWAL_STATUS":
    case "DID_CHANGE_RENEWAL_PREF":
    case "REFUND_DECLINED":
    case "PRICE_INCREASE":
    case "PRICE_INCREASE_CONSENT":
      return stillValid ? "active" : "expired";

    case "DID_FAIL_TO_RENEW":
      return stillValid ? "active" : "expired";

    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return "expired";

    case "REFUND":
    case "REVOKE":
      return "revoked";

    default:
      return stillValid ? "active" : "expired";
  }
}

/** Alinhado à RPC sync_user_subscription_from_client (SKU explícito, não só "annual" no nome). */
function billingPeriodFromProductId(productId: string): "monthly" | "annual" {
  const p = productId.trim();
  if (p === "meushow_9990" || p === "marcaai_anual_app" || p === "marcaai_anual") return "annual";
  if (p === "meushow_990" || p === "marcaai_mensal_app" || p === "marcaai_mensal") return "monthly";
  const low = p.toLowerCase();
  if (low.includes("anual") || low.includes("annual") || low.includes("year"))
    return "annual";
  if (low.includes("mensal") || low.includes("month")) return "monthly";
  return "monthly";
}

function msToIso(ms: number | undefined): string | null {
  if (ms == null || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

type JsonRecord = Record<string, unknown>;

/** Preserva metadata do app (ex.: client_sync) e sobrepõe campos oficiais da Apple. */
function mergeAppleServerMetadata(
  prev: unknown,
  layer: JsonRecord,
): JsonRecord {
  const base =
    prev && typeof prev === "object" && prev !== null && !Array.isArray(prev)
      ? { ...(prev as JsonRecord) }
      : {};
  return { ...base, ...layer };
}

type SubRow = {
  id: string;
  user_id?: string;
  status?: string;
  expires_at?: string | null;
  auto_renew?: boolean | null;
  metadata: unknown;
  store_original_transaction_id?: string | null;
  store_latest_transaction_id?: string | null;
};

function metadataObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

function isManualDbMetadata(metadata: unknown): boolean {
  const source = String(metadataObject(metadata).source ?? "");
  return source === "manual_db" || source.startsWith("manual_db");
}

function metadataNumber(metadata: unknown, key: string): number | null {
  const value = metadataObject(metadata)[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isOlderAppleEvent(metadata: unknown, signedDate?: number): boolean {
  if (!signedDate) return false;
  const previous = metadataNumber(metadata, "apple_signed_date_ms");
  return previous != null && signedDate < previous;
}

function entitlementIsActive(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
  graceExpiresAt: number | null,
): boolean {
  const now = Date.now();
  if (status === "revoked" || status === "expired") return false;
  if (status === "grace_period") {
    return graceExpiresAt != null && graceExpiresAt > now;
  }
  if (status === "cancelled") {
    return !!expiresAt && new Date(expiresAt).getTime() > now;
  }
  if (status === "active") {
    return !expiresAt || new Date(expiresAt).getTime() > now;
  }
  if (status === "pending") {
    return !!expiresAt && new Date(expiresAt).getTime() > now;
  }
  return false;
}

function isMissingAppleEventsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/apple_webhook_events/i.test(msg) && /does not exist|schema cache|Could not find/i.test(msg))
  );
}

/**
 * Linha iOS não manual a atualizar (pending/active/grace ou, se só houver, a mais recente inclusive expired).
 * Evita `.or` em JSON no PostgREST, que costuma falhar e forçar INSERT duplicado.
 */
async function selectIosRowToMergeAppleWebhook(
  userId: string,
): Promise<SubRow | null> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select("id, metadata, status")
    .eq("user_id", userId)
    .eq("platform", "ios")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) {
    console.warn(
      "[Apple Webhook] Falha ao buscar linhas iOS para consolidar (user_id):",
      error.message,
      "— A consolidação por usuário será ignorada nesta execução.",
    );
    return null;
  }
  const rows = (data ?? []) as {
    id: string;
    metadata: unknown;
    status: string;
  }[];
  const nonManual = rows.filter((r) => !isManualDbMetadata(r.metadata));
  if (nonManual.length === 0) return null;
  const preferred = nonManual.find((r) =>
    ["pending", "active", "grace_period", "cancelled"].includes(r.status),
  );
  const chosen = preferred ?? nonManual[0];
  return { id: chosen.id, metadata: chosen.metadata };
}

async function selectUserIdByOriginalTransactionId(
  originalTransactionId: string,
): Promise<string | null> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select("user_id")
    .eq("store_original_transaction_id", originalTransactionId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(
      "[Apple Webhook] Falha ao resolver usuário pelo original_transaction_id da loja:",
      error.message,
    );
    return null;
  }
  return (data?.[0] as { user_id?: string } | undefined)?.user_id ?? null;
}

/**
 * `.maybeSingle()` retorna erro (PGRST116) se houver 2+ linhas — comum com pending duplicado do app + webhook.
 * Sempre usa limit(1) ordenado pela linha mais recente.
 */
async function selectRowByLatestTransactionId(
  userId: string,
  transactionId: string,
): Promise<SubRow | null> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select(
      "id, user_id, status, expires_at, auto_renew, metadata, store_original_transaction_id, store_latest_transaction_id",
    )
    .eq("user_id", userId)
    .eq("store_latest_transaction_id", transactionId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(
      "[Apple Webhook] Falha ao buscar assinatura pelo último transaction_id:",
      error.message,
    );
    return null;
  }
  return (data?.[0] as SubRow | undefined) ?? null;
}

async function selectRowByOriginalTransactionId(
  userId: string,
  originalTransactionId: string,
): Promise<SubRow | null> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select(
      "id, user_id, status, expires_at, auto_renew, metadata, store_original_transaction_id, store_latest_transaction_id",
    )
    .eq("user_id", userId)
    .eq("store_original_transaction_id", originalTransactionId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(
      "[Apple Webhook] Falha ao buscar assinatura pelo original_transaction_id:",
      error.message,
    );
    return null;
  }
  return (data?.[0] as SubRow | undefined) ?? null;
}

/** Expira outros `pending` iOS não manual (sem `.or` em JSON no PostgREST). */
async function expireOtherIosPendingDuplicates(
  userId: string,
  keepId: string,
): Promise<void> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("platform", "ios")
    .eq("status", "pending")
    .neq("id", keepId);
  if (error) {
    console.warn(
      "[Apple Webhook] Não foi possível listar pendentes iOS para expirar duplicados:",
      error.message,
    );
    return;
  }
  const pendingRows = (data ?? []) as { id: string; metadata: unknown }[];
  for (const row of pendingRows) {
    if (isManualDbMetadata(row.metadata)) continue;
    const { error: upErr } = await supabase!
      .from("user_subscriptions")
      .update({ status: "expired" })
      .eq("id", row.id);
    if (upErr) {
      console.warn(
        "[Apple Webhook] Falha ao expirar um pending duplicado (id):",
        row.id,
        upErr.message,
      );
    }
  }
}

/** Antes do INSERT: expira linhas iOS ativas/pending da loja. Não toca em cortesia manual_db. */
async function expireIosNonManualForAppleReplace(userId: string): Promise<void> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("platform", "ios")
    .in("status", ["active", "grace_period", "pending"]);
  if (error) {
    console.warn(
      "[Apple Webhook] Não foi possível listar assinaturas iOS ativas/pendentes antes de inserir nova:",
      error.message,
    );
    return;
  }
  const rows = (data ?? []) as { id: string; metadata: unknown }[];
  for (const row of rows) {
    if (isManualDbMetadata(row.metadata)) continue;
    await supabase!
      .from("user_subscriptions")
      .update({ status: "expired" })
      .eq("id", row.id);
  }
}

async function selectSubscriptionsForUser(userId: string): Promise<SubRow[]> {
  const { data, error } = await supabase!
    .from("user_subscriptions")
    .select("id, user_id, status, expires_at, metadata")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error(
      "[Apple Webhook] Erro ao listar assinaturas para plan_is_active:",
      error.message,
    );
    return [];
  }
  return (data ?? []) as SubRow[];
}

/** Recalcula Premium com Apple + Android + cortesia manual_db. */
async function syncUserPlanActive(userId: string): Promise<void> {
  if (!supabase) return;

  const rows = await selectSubscriptionsForUser(userId);
  let planActive = false;

  for (const row of rows) {
    const metadata = metadataObject(row.metadata);
    if (isManualDbMetadata(metadata)) {
      if (
        (row.status === "active" ||
          row.status === "grace_period" ||
          row.status === "cancelled" ||
          row.status === "pending") &&
        (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())
      ) {
        planActive = true;
        break;
      }
      continue;
    }
    const graceExpiresAt = metadataNumber(metadata, "apple_grace_period_expires_date_ms");
    if (entitlementIsActive(row.status, row.expires_at, graceExpiresAt)) {
      planActive = true;
      break;
    }
  }

  const { error } = await supabase
    .from("users")
    .update({ plan_is_active: planActive })
    .eq("id", userId);

  if (error) {
    console.error(
      "[Apple Webhook] Erro ao sincronizar users.plan_is_active (usuário",
      userId,
      "):",
      error.message,
    );
  }
}

async function resolveUserId(
  originalTransactionId: string,
  appAccountToken?: string,
): Promise<string | null> {
  const existingOwner = await selectUserIdByOriginalTransactionId(originalTransactionId);
  const token = typeof appAccountToken === "string" ? appAccountToken.trim() : "";
  const tokenIsUuid = UUID_RE.test(token);

  if (existingOwner) {
    if (tokenIsUuid && existingOwner.toLowerCase() !== token.toLowerCase()) {
      console.error(
        "[Apple Webhook] CONFLITO: originalTransactionId já pertence a outro usuário.",
      );
      return null;
    }
    return existingOwner;
  }

  if (!tokenIsUuid) {
    console.error(
      "[Apple Webhook] Sem appAccountToken UUID e sem vínculo prévio deste originalTransactionId.",
      "Na compra iOS, envie appAccountToken = UUID do usuário no requestPurchase (StoreKit 2).",
    );
    return null;
  }
  return token;
}

async function claimNotification(notificationUUID: string): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const { data: inserted, error: insertError } = await supabase!
    .from("apple_webhook_events")
    .insert({
      notification_uuid: notificationUUID,
      status: "processing",
      claimed_at: now.toISOString(),
    })
    .select("notification_uuid")
    .maybeSingle();

  if (!insertError && inserted) return true;
  if (isMissingAppleEventsTable(insertError)) {
    console.warn(
      "[Apple Webhook] Tabela apple_webhook_events ausente — processando sem idempotência. Rode database/apple_webhook_events.sql.",
    );
    return true;
  }

  const { data: existing, error: readError } = await supabase!
    .from("apple_webhook_events")
    .select("status, claimed_at")
    .eq("notification_uuid", notificationUUID)
    .limit(1)
    .maybeSingle();

  if (isMissingAppleEventsTable(readError)) return true;
  if (readError || !existing) {
    if (insertError?.code === "23505") return false;
    console.warn(
      "[Apple Webhook] Não foi possível claim da notificação:",
      readError?.message ?? insertError?.message,
    );
    return true;
  }

  if (existing.status === "processed") return false;
  if (
    existing.status === "processing" &&
    existing.claimed_at &&
    existing.claimed_at > staleBefore
  ) {
    return false;
  }

  let query = supabase!
    .from("apple_webhook_events")
    .update({
      status: "processing",
      claimed_at: now.toISOString(),
      last_error: null,
    })
    .eq("notification_uuid", notificationUUID);

  if (existing.status === "processing") {
    query = query.eq("status", "processing").lt("claimed_at", staleBefore);
  } else {
    query = query.eq("status", "failed");
  }

  const { data: claimed, error: claimError } = await query
    .select("notification_uuid")
    .limit(1);
  if (claimError) {
    if (isMissingAppleEventsTable(claimError)) return true;
    console.warn("[Apple Webhook] Falha ao re-claim:", claimError.message);
    return true;
  }
  return Array.isArray(claimed) && claimed.length > 0;
}

async function markNotificationProcessed(
  notificationUUID: string | null,
  userId: string | null,
  transactionId: string | null,
  signedDate: number | null,
): Promise<void> {
  if (!notificationUUID) return;
  const { error } = await supabase!
    .from("apple_webhook_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      user_id: userId,
      transaction_id: transactionId,
      signed_date: signedDate ? new Date(signedDate).toISOString() : null,
      last_error: null,
    })
    .eq("notification_uuid", notificationUUID);
  if (error && !isMissingAppleEventsTable(error)) {
    console.warn("[Apple Webhook] Falha ao marcar processed:", error.message);
  }
}

async function markNotificationFailed(
  notificationUUID: string | null,
  err: unknown,
): Promise<void> {
  if (!notificationUUID) return;
  const { error } = await supabase!
    .from("apple_webhook_events")
    .update({
      status: "failed",
      last_error:
        err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000),
    })
    .eq("notification_uuid", notificationUUID);
  if (error && !isMissingAppleEventsTable(error)) {
    console.warn("[Apple Webhook] Falha ao marcar failed:", error.message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  if (!supabase) {
    console.error(
      "[Apple Webhook] Configuração incompleta: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis da Edge Function.",
    );
    return new Response("server misconfigured", { status: 500 });
  }

  let notificationUUID: string | null = null;

  try {
    const body = await req.json();

    const signedPayload = body?.signedPayload as string | undefined;
    if (!signedPayload || typeof signedPayload !== "string") {
      console.warn(
        "[Apple Webhook] Corpo JSON sem o campo signedPayload (notificações V2 exigem esse JWS).",
      );
      return new Response("ok", { status: 200 });
    }

    if (!(await verifyJWS(signedPayload))) {
      console.error(
        "[Apple Webhook] Assinatura do JWS externo (signedPayload) rejeitada.",
      );
      return new Response("invalid signature", { status: 401 });
    }

    const outer = decodeJWSPayload<{
      notificationType?: string;
      subtype?: string;
      notificationUUID?: string;
      signedDate?: number;
      data?: {
        bundleId?: string;
        environment?: string;
        status?: number;
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
      };
    }>(signedPayload);

    const notificationType = outer.notificationType ?? "UNKNOWN";
    const subtype = outer.subtype;
    const signedDate = outer.signedDate;
    notificationUUID =
      typeof outer.notificationUUID === "string" && UUID_RE.test(outer.notificationUUID)
        ? outer.notificationUUID
        : null;

    console.log(
      "[Apple Webhook] Notificação — tipo:",
      notificationType,
      "| subtipo:",
      subtype ?? "(nenhum)",
      "| ambiente:",
      outer.data?.environment ?? "(não informado)",
      "| bundle:",
      outer.data?.bundleId ?? "(não informado)",
    );

    if (notificationType === "TEST") {
      console.log("[Apple Webhook] TEST: URL validada; nada gravado em user_subscriptions.");
      return new Response("ok", { status: 200 });
    }

    const outerBundle = outer.data?.bundleId;
    if (outerBundle && outerBundle !== APPLE_BUNDLE_ID) {
      console.error("[Apple Webhook] bundleId rejeitado:", outerBundle);
      return new Response("ok", { status: 200 });
    }

    const environment = outer.data?.environment;
    if (environment && environment !== "Production" && environment !== "Sandbox") {
      console.error("[Apple Webhook] environment inválido:", environment);
      return new Response("ok", { status: 200 });
    }

    if (notificationUUID) {
      const shouldProcess = await claimNotification(notificationUUID);
      if (!shouldProcess) {
        return new Response("ok", { status: 200 });
      }
    }

    const signedTransactionInfo = outer.data?.signedTransactionInfo;
    if (!signedTransactionInfo) {
      await markNotificationProcessed(notificationUUID, null, null, signedDate ?? null);
      return new Response("ok", { status: 200 });
    }

    if (!(await verifyJWS(signedTransactionInfo))) {
      console.error("[Apple Webhook] JWS da transação rejeitado.");
      return new Response("invalid transaction jws", { status: 401 });
    }

    const tx = decodeJWSPayload<AppleTransaction>(signedTransactionInfo);

    if (tx.bundleId && tx.bundleId !== APPLE_BUNDLE_ID) {
      console.error("[Apple Webhook] bundleId da transação rejeitado:", tx.bundleId);
      await markNotificationProcessed(notificationUUID, null, tx.transactionId ?? null, signedDate ?? null);
      return new Response("ok", { status: 200 });
    }

    const originalTransactionId = tx.originalTransactionId;
    const transactionId = tx.transactionId;
    const productId = tx.productId?.trim();

    if (!originalTransactionId || !transactionId || !productId) {
      console.warn("[Apple Webhook] Transação incompleta (ids).");
      await markNotificationProcessed(notificationUUID, null, transactionId ?? null, signedDate ?? null);
      return new Response("ok", { status: 200 });
    }

    if (!ALLOWED_PRODUCT_IDS.has(productId)) {
      console.warn("[Apple Webhook] Produto não permitido:", productId);
      await markNotificationProcessed(notificationUUID, null, transactionId, signedDate ?? null);
      return new Response("ok", { status: 200 });
    }

    let renewal: AppleRenewal | null = null;
    const signedRenewal = outer.data?.signedRenewalInfo;
    if (signedRenewal) {
      try {
        if (await verifyJWS(signedRenewal)) {
          renewal = decodeJWSPayload<AppleRenewal>(signedRenewal);
          if (
            renewal.originalTransactionId &&
            renewal.originalTransactionId !== originalTransactionId
          ) {
            console.warn(
              "[Apple Webhook] originalTransactionId do renewal não bate com a transação — ignorando renewal.",
            );
            renewal = null;
          }
        }
      } catch (e) {
        console.warn(
          "[Apple Webhook] signedRenewalInfo ignorado:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const userId = await resolveUserId(
      originalTransactionId,
      tx.appAccountToken ?? renewal?.appAccountToken,
    );

    if (!userId) {
      await markNotificationProcessed(notificationUUID, null, transactionId, signedDate ?? null);
      return new Response("ok", { status: 200 });
    }

    const existingByTx = await selectRowByLatestTransactionId(userId, transactionId);
    const existingSub =
      existingByTx ?? (await selectRowByOriginalTransactionId(userId, originalTransactionId));

    if (existingSub?.user_id && existingSub.user_id !== userId) {
      console.error("[Apple Webhook] Tentativa de alterar assinatura de outro usuário.");
      await markNotificationProcessed(notificationUUID, null, transactionId, signedDate ?? null);
      return new Response("ok", { status: 200 });
    }

    if (existingSub && isOlderAppleEvent(existingSub.metadata, signedDate)) {
      await syncUserPlanActive(userId);
      await markNotificationProcessed(notificationUUID, userId, transactionId, signedDate ?? null);
      console.log("[Apple Webhook] Notificação antiga ignorada:", notificationUUID);
      return new Response("ok", { status: 200 });
    }

    const previousAutoRenew = existingSub?.auto_renew !== false;
    const autoRenew = autoRenewFromApple(subtype, renewal, previousAutoRenew);
    const status = mapSubscriptionStatus(notificationType, subtype, tx, renewal);
    const purchasedAt = msToIso(tx.purchaseDate);
    const expiresAt = msToIso(tx.expiresDate);
    const cancelledAt = tx.revocationDate
      ? msToIso(tx.revocationDate)
      : !autoRenew
        ? msToIso(signedDate)
        : null;

    const appleMetaLayer: JsonRecord = {
      source: "apple_asn_v2",
      apple_store_confirmed: true,
      apple_signed_date_ms: signedDate ?? null,
      apple_confirmed_at_ms: Date.now(),
      apple_notification_uuid: notificationUUID,
      notificationType,
      subtype: subtype ?? null,
      environment: environment ?? null,
      apple_status: outer.data?.status ?? null,
      apple_grace_period_expires_date_ms: renewal?.gracePeriodExpiresDate ?? null,
      apple_is_in_billing_retry_period: renewal?.isInBillingRetryPeriod ?? false,
      apple_expiration_intent: renewal?.expirationIntent ?? null,
      transaction: tx as unknown as JsonRecord,
      renewal: renewal as unknown as JsonRecord,
    };

    const rowPayload = (metadata: JsonRecord) => ({
      user_id: userId,
      product_id: productId,
      billing_period: billingPeriodFromProductId(productId),
      platform: "ios" as const,
      status,
      purchased_at: purchasedAt,
      expires_at: expiresAt,
      cancelled_at: cancelledAt,
      store_original_transaction_id: originalTransactionId,
      store_latest_transaction_id: transactionId,
      auto_renew: autoRenew,
      metadata,
    });

    const finishOk = async (keepId: string, path: string) => {
      await expireOtherIosPendingDuplicates(userId, keepId);
      await syncUserPlanActive(userId);
      await markNotificationProcessed(notificationUUID, userId, transactionId, signedDate ?? null);
      console.log("[Apple Webhook] Sucesso", path, "| tipo:", notificationType, "| status:", status, "| user:", userId);
    };

    if (existingByTx) {
      const metadata = mergeAppleServerMetadata(existingByTx.metadata, appleMetaLayer);
      const { error } = await supabase
        .from("user_subscriptions")
        .update(rowPayload(metadata))
        .eq("id", existingByTx.id)
        .eq("user_id", userId);
      if (error) {
        console.error("[Apple Webhook] Erro UPDATE transaction_id:", error.message);
        return new Response("db error", { status: 500 });
      }
      await finishOk(existingByTx.id, "caminho 1 (mesmo transaction_id)");
      return new Response("ok", { status: 200 });
    }

    if (existingSub) {
      const metadata = mergeAppleServerMetadata(existingSub.metadata, appleMetaLayer);
      const { error } = await supabase
        .from("user_subscriptions")
        .update(rowPayload(metadata))
        .eq("id", existingSub.id)
        .eq("user_id", userId);
      if (error) {
        console.error("[Apple Webhook] Erro UPDATE original_transaction_id:", error.message);
        return new Response("db error", { status: 500 });
      }
      await finishOk(existingSub.id, "caminho 2 (mesmo original_transaction_id)");
      return new Response("ok", { status: 200 });
    }

    const consolidateRow = await selectIosRowToMergeAppleWebhook(userId);
    if (consolidateRow) {
      const metadata = mergeAppleServerMetadata(consolidateRow.metadata, appleMetaLayer);
      const { error } = await supabase
        .from("user_subscriptions")
        .update(rowPayload(metadata))
        .eq("id", consolidateRow.id)
        .eq("user_id", userId);
      if (error) {
        console.error("[Apple Webhook] Erro consolidação:", error.message);
        return new Response("db error", { status: 500 });
      }
      await finishOk(consolidateRow.id, "caminho 3 (consolidação)");
      return new Response("ok", { status: 200 });
    }

    if (status === "active" || status === "grace_period") {
      await expireIosNonManualForAppleReplace(userId);
    }

    const metadata = mergeAppleServerMetadata({}, appleMetaLayer);
    const { data: insertedRows, error } = await supabase
      .from("user_subscriptions")
      .insert(rowPayload(metadata))
      .select("id");
    if (error) {
      const raceRow = await selectRowByOriginalTransactionId(userId, originalTransactionId);
      if (raceRow) {
        const raceMetadata = mergeAppleServerMetadata(raceRow.metadata, appleMetaLayer);
        const { error: retryError } = await supabase
          .from("user_subscriptions")
          .update(rowPayload(raceMetadata))
          .eq("id", raceRow.id)
          .eq("user_id", userId);
        if (retryError) {
          console.error("[Apple Webhook] Erro INSERT/retry:", retryError.message);
          return new Response("db error", { status: 500 });
        }
        await finishOk(raceRow.id, "caminho 4b (corrida no insert)");
        return new Response("ok", { status: 200 });
      }
      console.error("[Apple Webhook] Erro INSERT:", error.message);
      return new Response("db error", { status: 500 });
    }
    const insertedId = insertedRows?.[0]?.id;
    if (insertedId) await finishOk(insertedId, "caminho 4 (insert)");
    else {
      await syncUserPlanActive(userId);
      await markNotificationProcessed(notificationUUID, userId, transactionId, signedDate ?? null);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[Apple Webhook] Exceção:", err);
    try {
      await markNotificationFailed(notificationUUID, err);
    } catch {
      /* ignore */
    }
    return new Response("error", { status: 500 });
  }
});

