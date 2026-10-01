/**
 * App Store Server Notifications V2 → Supabase (`user_subscriptions` + `users.plan_is_active`)
 *
 * Fluxo anti-duplicata: UPDATE por transactionId → por originalTransactionId → consolida pending do app; INSERT só se não houver linha compatível.
 *
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

/** Valida JWS assinado pela Apple (ASN V2 / transação / renovação): x5c + ES256 + raiz G3. */
async function verifyJWS(jws: string): Promise<boolean> {
  try {
    const header = jose.decodeProtectedHeader(jws);
    if (header.alg !== "ES256") return false;

    const x5c = header.x5c;
    if (!Array.isArray(x5c) || x5c.length < 2) return false;
    const leafB64 = x5c[0];
    const intermediateB64 = x5c[1];
    if (typeof leafB64 !== "string" || typeof intermediateB64 !== "string") {
      return false;
    }

    const leaf = new X509Certificate(derFromX5cBase64(leafB64));
    const intermediate = new X509Certificate(derFromX5cBase64(intermediateB64));
    const root = new X509Certificate(APPLE_ROOT_CA_G3_PEM);

    if (!intermediate.checkIssued(root)) return false;
    if (!leaf.checkIssued(intermediate)) return false;
    if (!intermediate.verify(root.publicKey)) return false;
    if (!leaf.verify(intermediate.publicKey)) return false;

    const now = Date.now();
    if (new Date(leaf.validTo).getTime() < now) return false;
    if (new Date(leaf.validFrom).getTime() > now) return false;

    const key = await jose.importX509(leaf.toString(), "ES256");
    await jose.compactVerify(jws, key);
    return true;
  } catch {
    return false;
  }
}

function mapSubscriptionStatus(
  notificationType: string,
  subtype: string | undefined,
): string {
  switch (notificationType) {
    case "SUBSCRIBED":
    case "INITIAL_BUY":
    case "DID_RENEW":
    case "RENEWAL_EXTENDED":
    case "OFFER_REDEEMED":
      return "active";

    case "DID_CHANGE_RENEWAL_PREF":
    case "DID_CHANGE_RENEWAL_STATUS":
      return "active";

    case "REFUND_DECLINED":
      return "active";

    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return "expired";

    case "REFUND":
    case "REVOKE":
      return "revoked";

    case "DID_FAIL_TO_RENEW":
      return subtype === "GRACE_PERIOD" ? "grace_period" : "active";

    case "PRICE_INCREASE":
      return "active";

    default:
      return "pending";
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

type SubRow = { id: string; metadata: unknown };

function isManualDbMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const source = String((metadata as JsonRecord).source ?? "");
  return source === "manual_db" || source.startsWith("manual_db");
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
    ["pending", "active", "grace_period"].includes(r.status),
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
    .select("id, metadata")
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
    .select("id, metadata")
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

/** Antes do INSERT: expira linhas iOS ativas/pending não manuais + cortesia manual ativa. */
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
  const { data: courtesyRows } = await supabase!
    .from("user_subscriptions")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("platform", "ios")
    .in("status", ["active", "grace_period"])
    .order("updated_at", { ascending: false })
    .limit(20);
  const manualId = (courtesyRows ?? []).find((row) => isManualDbMetadata(row.metadata))
    ?.id as string | undefined;
  if (manualId) {
    await supabase!
      .from("user_subscriptions")
      .update({ status: "expired" })
      .eq("id", manualId);
  }
}

async function syncUserPlanActive(
  userId: string,
  status: string,
  expiresAtIso: string | null,
): Promise<void> {
  if (!supabase) return;

  let planActive = false;

  if (status === "revoked" || status === "expired") {
    planActive = false;
  } else if (status === "active" || status === "grace_period") {
    planActive = true;
  } else if (
    status === "pending" &&
    expiresAtIso &&
    new Date(expiresAtIso).getTime() > Date.now()
  ) {
    planActive = true;
  }

  const { error } = await supabase
    .from("users")
    .update({ plan_is_active: planActive })
    .eq("id", userId);

  if (error) {
    console.error(
      "[Apple Webhook] Erro ao sincronizar users.plan_is_active com o status da assinatura (usuário",
      userId,
      "):",
      error.message,
      "— O registro em user_subscriptions pode estar correto; confira o usuário no app.",
    );
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

  try {
    const body = await req.json();

    const signedPayload = body?.signedPayload as string | undefined;
    if (!signedPayload || typeof signedPayload !== "string") {
      console.warn(
        "[Apple Webhook] Corpo JSON sem o campo signedPayload (notificações V2 exigem esse JWS).",
        "Nada foi alterado no banco. No App Store Connect, use Notificações do servidor em formato V2.",
      );
      return new Response("ok", { status: 200 });
    }

    const outerOk = await verifyJWS(signedPayload);
    if (!outerOk) {
      console.error(
        "[Apple Webhook] Assinatura do JWS externo (signedPayload) rejeitada pela verificação.",
        "Resposta 401 para a Apple tentar novamente após corrigir chaves/certificados em produção.",
      );
      return new Response("invalid signature", { status: 401 });
    }

    const outer = decodeJWSPayload<{
      notificationType?: string;
      subtype?: string;
      notificationUUID?: string;
      data?: {
        bundleId?: string;
        environment?: string;
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
      };
    }>(signedPayload);

    const notificationType = outer.notificationType ?? "UNKNOWN";
    const subtype = outer.subtype;
    console.log(
      "[Apple Webhook] Notificação recebida — tipo:",
      notificationType,
      "| subtipo:",
      subtype ?? "(nenhum)",
      "| ambiente no payload:",
      outer.data?.environment ?? "(não informado)",
    );

    /** Ping da Apple ao configurar a URL — não deve gravar em `user_subscriptions`. */
    if (notificationType === "TEST") {
      console.log(
        "[Apple Webhook] Notificação TEST: a Apple só validou a URL do webhook.",
        "Nenhuma linha em user_subscriptions foi alterada (comportamento esperado).",
      );
      return new Response("ok", { status: 200 });
    }

    const signedTransactionInfo = outer.data?.signedTransactionInfo;
    if (!signedTransactionInfo) {
      console.log(
        "[Apple Webhook] Esta notificação não traz signedTransactionInfo dentro de data.",
        "Nada a sincronizar na tabela user_subscriptions; retornando 200 para a Apple.",
      );
      return new Response("ok", { status: 200 });
    }

    const txOk = await verifyJWS(signedTransactionInfo);
    if (!txOk) {
      console.error(
        "[Apple Webhook] Assinatura do JWS da transação (signedTransactionInfo) rejeitada.",
        "Resposta 401 para a Apple reenviar após correção.",
      );
      return new Response("invalid transaction jws", { status: 401 });
    }

    const tx = decodeJWSPayload<{
      originalTransactionId?: string;
      transactionId?: string;
      productId?: string;
      purchaseDate?: number;
      expiresDate?: number;
      revocationDate?: number;
      appAccountToken?: string;
    }>(signedTransactionInfo);

    const originalTransactionId = tx.originalTransactionId;
    const transactionId = tx.transactionId;
    const productId = tx.productId;

    if (!originalTransactionId || !transactionId || !productId) {
      console.warn(
        "[Apple Webhook] JWS da transação incompleto: faltam originalTransactionId, transactionId ou productId.",
        "Nada foi gravado. Verifique o produto na App Store Connect e o payload da notificação.",
      );
      return new Response("ok", { status: 200 });
    }

    if (!ALLOWED_PRODUCT_IDS.has(productId.trim())) {
      console.warn(
        "[Apple Webhook] product_id da Apple não está na lista permitida deste app:",
        productId,
        "— Ignorado de propósito (sem alterar o banco).",
      );
      return new Response("ok", { status: 200 });
    }

    let userId: string | null = null;

    if (tx.appAccountToken) {
      const raw = tx.appAccountToken.trim();
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRe.test(raw)) {
        userId = raw;
      } else {
        console.warn(
          "[Apple Webhook] appAccountToken veio na transação, mas não é um UUID válido (esperado: id do usuário Supabase).",
          "Tentando localizar o usuário pelo original_transaction_id já salvo no banco.",
        );
      }
    }

    if (!userId) {
      userId = await selectUserIdByOriginalTransactionId(originalTransactionId);
    }

    if (!userId) {
      console.error(
        "[Apple Webhook] Não foi possível identificar o usuário: nem appAccountToken (UUID) nem linha em user_subscriptions com este original_transaction_id.",
        "Na compra iOS, envie appAccountToken = UUID do usuário no requestPurchase (StoreKit 2).",
        "Retornando 200 para a Apple não ficar reenfileirando erro de aplicação.",
      );
      return new Response("ok", { status: 200 });
    }

    const status = mapSubscriptionStatus(notificationType, subtype);
    const purchasedAt = msToIso(tx.purchaseDate);
    const expiresAt = msToIso(tx.expiresDate);
    const cancelledAt = msToIso(tx.revocationDate);

    let autoRenew = true;
    const signedRenewal = outer.data?.signedRenewalInfo;
    if (signedRenewal) {
      try {
        const renOk = await verifyJWS(signedRenewal);
        if (renOk) {
          const ren = decodeJWSPayload<{ autoRenewStatus?: number }>(
            signedRenewal,
          );
          if (ren.autoRenewStatus === 0) autoRenew = false;
        }
      } catch (e) {
        console.warn(
          "[Apple Webhook] Não foi possível interpretar signedRenewalInfo (renovação automática).",
          "Mantendo auto_renew=true. Detalhe:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const appleMetaLayer: JsonRecord = {
      source: "apple_asn_v2",
      apple_store_confirmed: true,
      apple_confirmed_at_ms: Date.now(),
      notificationType,
      subtype: subtype ?? null,
      notificationUUID: outer.notificationUUID ?? null,
      environment: outer.data?.environment ?? null,
      transaction: tx as unknown as JsonRecord,
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

    const existingByTx = await selectRowByLatestTransactionId(
      userId,
      transactionId,
    );

    if (existingByTx) {
      const metadata = mergeAppleServerMetadata(
        existingByTx.metadata,
        appleMetaLayer,
      );
      const { error } = await supabase
        .from("user_subscriptions")
        .update(rowPayload(metadata))
        .eq("id", existingByTx.id);
      if (error) {
        console.error(
          "[Apple Webhook] Erro ao atualizar user_subscriptions quando já existia o mesmo store_latest_transaction_id (confirmação idempotente).",
          "user_id:",
          userId,
          "| Mensagem do banco:",
          error.message,
        );
        return new Response("db error", { status: 500 });
      }
      await expireOtherIosPendingDuplicates(userId, existingByTx.id);
      const txTail =
        transactionId.length > 10
          ? `…${transactionId.slice(-8)}`
          : transactionId;
      console.log(
        "[Apple Webhook] Sucesso (caminho 1 — mesmo último transaction_id):",
        "O app ou a RPC já havia gravado este transactionId na linha da assinatura.",
        "A Apple reenviou a notificação; atualizamos status, datas e metadata (confirmação oficial).",
        "| Tipo da notificação:",
        notificationType,
        "| Sufixo do transaction_id:",
        txTail,
        "| user_id:",
        userId,
      );
      await syncUserPlanActive(userId, status, expiresAt);
      console.log(
        "[Apple Webhook] Campo users.plan_is_active atualizado para user_id",
        userId,
        "de acordo com o status",
        status,
        "(após caminho 1).",
      );
      return new Response("ok", { status: 200 });
    }

    const existingSub = await selectRowByOriginalTransactionId(
      userId,
      originalTransactionId,
    );

    if (existingSub) {
      const metadata = mergeAppleServerMetadata(
        existingSub.metadata,
        appleMetaLayer,
      );
      const { error } = await supabase
        .from("user_subscriptions")
        .update(rowPayload(metadata))
        .eq("id", existingSub.id);
      if (error) {
        console.error(
          "[Apple Webhook] Erro ao atualizar user_subscriptions pelo original_transaction_id (renovação ou alinhamento com a linha existente).",
          "user_id:",
          userId,
          "| Mensagem:",
          error.message,
        );
        return new Response("db error", { status: 500 });
      }
      await expireOtherIosPendingDuplicates(userId, existingSub.id);
      console.log(
        "[Apple Webhook] Sucesso (caminho 2 — mesmo original_transaction_id):",
        "Encontramos a assinatura pelo ID original da loja (ex.: renovação com novo transaction_id).",
        "Linha atualizada; pendentes iOS duplicados foram expirados quando aplicável.",
        "| Tipo:",
        notificationType,
        "| user_id:",
        userId,
      );
    } else {
      const consolidateRow = await selectIosRowToMergeAppleWebhook(userId);

      if (consolidateRow) {
        const metadata = mergeAppleServerMetadata(
          consolidateRow.metadata,
          appleMetaLayer,
        );
        const { error } = await supabase
          .from("user_subscriptions")
          .update(rowPayload(metadata))
          .eq("id", consolidateRow.id);
        if (error) {
          console.error(
            "[Apple Webhook] Erro ao consolidar na linha iOS existente do usuário (sem criar registro novo).",
            "user_id:",
            userId,
            "| Mensagem:",
            error.message,
          );
          return new Response("db error", { status: 500 });
        }
        await expireOtherIosPendingDuplicates(userId, consolidateRow.id);
        console.log(
          "[Apple Webhook] Sucesso (caminho 3 — consolidação por usuário):",
          "Não havia match por transaction_id/original_id, mas existe linha iOS não manual para este usuário.",
          "Atualizamos essa linha para evitar duplicata; não foi feito INSERT.",
          "| Tipo:",
          notificationType,
          "| user_id:",
          userId,
        );
      } else {
        if (status === "active" || status === "grace_period") {
          await expireIosNonManualForAppleReplace(userId);
        }

        const metadata = mergeAppleServerMetadata({}, appleMetaLayer);
        const { data: insertedRows, error } = await supabase
          .from("user_subscriptions")
          .insert(rowPayload(metadata))
          .select("id");
        if (error) {
          console.error(
            "[Apple Webhook] Erro ao inserir nova linha em user_subscriptions (primeira assinatura iOS deste usuário no banco).",
            "user_id:",
            userId,
            "| Mensagem:",
            error.message,
          );
          return new Response("db error", { status: 500 });
        }
        const insertedId = insertedRows?.[0]?.id;
        if (insertedId) {
          await expireOtherIosPendingDuplicates(userId, insertedId);
        }
        console.log(
          "[Apple Webhook] Sucesso (caminho 4 — novo registro):",
          "Não havia linha iOS compatível; inserimos user_subscriptions a partir dos dados oficiais da Apple.",
          "Outras assinaturas ativas/pendentes não manuais podem ter sido expiradas antes do insert (status active/grace).",
          "| Tipo:",
          notificationType,
          "| user_id:",
          userId,
        );
      }
    }

    await syncUserPlanActive(userId, status, expiresAt);

    console.log(
      "[Apple Webhook] Campo users.plan_is_active atualizado para user_id",
      userId,
      "de acordo com o status",
      status,
      "(após caminho 2, 3 ou 4).",
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(
      "[Apple Webhook] Exceção não tratada ao processar a notificação (stack / mensagem abaixo).",
      "A Apple pode reenviar; corrija o código ou os dados e monitore os logs.",
      err,
    );
    return new Response("error", { status: 500 });
  }
});
