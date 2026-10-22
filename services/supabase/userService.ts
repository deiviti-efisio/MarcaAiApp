import { supabase } from '../../lib/supabase';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  city?: string;
  state?: string;
  phone?: string;
  profile_url?: string;
  plan_is_active?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserProfileData {
  id: string;
  name: string;
  email: string;
  city?: string;
  state?: string;
  phone?: string;
  profile_url?: string;
  plan_is_active?: boolean;
}

function isDuplicateKeyError(message: string | null | undefined): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('duplicate') || m.includes('unique') || m.includes('23505');
}

// Verificar se o usuário existe na tabela users
export const checkUserExists = async (userId: string): Promise<{ exists: boolean; error: string | null }> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle(); // Usar maybeSingle() para evitar erro quando não encontrar

    if (error) {
      console.error('❌ checkUserExists: Erro na consulta:', error);
      return { exists: false, error: error.message };
    }

    const exists = data !== null;
    return { exists, error: null };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { exists: false, error: msg.trim() || 'Erro de conexão' };
  }
};

// Criar perfil do usuário
export const createUserProfile = async (userData: CreateUserProfileData): Promise<{ success: boolean; error: string | null }> => {
  try {
    // Buscar token FCM apenas ao criar novo usuário
    let tokenFCM: string | null = null;
    try {
      const { getFCMToken } = await import('../pushNotificationHandler');
      tokenFCM = await getFCMToken();
      if (tokenFCM) {
        console.log('🔑 Token FCM obtido com sucesso!');
      } else {
        console.log('⚠️ Token FCM não disponível ao criar usuário');
      }
    } catch (tokenError) {
      console.log('⚠️ Erro ao obter token FCM (continuando sem token):', tokenError);
      // Continua sem o token se houver erro
    }

    const { error } = await supabase
      .from('users')
      .insert({
        id: userData.id,
        name: userData.name,
        email: userData.email,
        city: userData.city || null,
        state: userData.state || null,
        phone: userData.phone || null,
        profile_url: userData.profile_url || null,
        plan_is_active: userData.plan_is_active || false,
        token_fcm: tokenFCM || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (error) {
      if (isDuplicateKeyError(error.message)) {
        return updateUserProfile(userData.id, {
          name: userData.name,
          email: userData.email,
          city: userData.city,
          state: userData.state,
          phone: userData.phone,
          profile_url: userData.profile_url,
        });
      }
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

export const saveUserCadastro = async (
  userData: CreateUserProfileData
): Promise<{ success: boolean; error: string | null }> => {
  const { exists, error: checkError } = await checkUserExists(userData.id);
  if (checkError) {
    return { success: false, error: checkError };
  }
  if (exists) {
    return updateUserProfile(userData.id, {
      name: userData.name,
      email: userData.email,
      city: userData.city,
      state: userData.state,
      phone: userData.phone,
      profile_url: userData.profile_url,
    });
  }
  return createUserProfile(userData);
};

// Criar ou atualizar usuário com dados do Google
interface SocialUserData {
  name?: string;
  email: string;
  photo?: string | null;
}

const upsertSocialUserProfile = async (
  userId: string,
  socialData: SocialUserData
): Promise<{ success: boolean; error: string | null; isNewUser?: boolean }> => {
  try {
    const { exists, error: checkError } = await checkUserExists(userId);

    if (checkError) {
      console.error('❌ [Social User] Erro ao verificar usuário:', checkError);
      return { success: false, error: checkError };
    }

    if (exists) {
      // Usuário já existe: não sobrescrever dados. Apple só traz nome no primeiro login;
      // nos próximos fullName vem vazio. Manter os dados do banco intactos.
      return { success: true, error: null, isNewUser: false };
    }

    let tokenFCM: string | null = null;
    try {
      const { getFCMToken } = await import('../pushNotificationHandler');
      tokenFCM = await getFCMToken();
      if (tokenFCM) {
        console.log('🔑 Token FCM obtido ao criar usuário social:', tokenFCM);
      }
    } catch (tokenError) {
      console.log('⚠️ Erro ao obter token FCM (continuando sem token):', tokenError);
    }

    const { error: insertError } = await supabase
      .from('users')
      .insert({
        id: userId,
        name: socialData.name || 'Usuário',
        email: socialData.email,
        profile_url: socialData.photo || null,
        plan_is_active: false,
        token_fcm: tokenFCM || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      if (isDuplicateKeyError(insertError.message)) {
        return { success: true, error: null, isNewUser: false };
      }
      console.error('❌ [Social User] Erro ao criar usuário:', insertError);
      return { success: false, error: insertError.message };
    }

    return { success: true, error: null, isNewUser: true };
  } catch (error) {
    console.error('❌ [Social User] Erro inesperado:', error);
    return { success: false, error: 'Erro de conexão' };
  }
};

export const createOrUpdateUserFromGoogle = async (
  userId: string,
  googleData: {
    name: string;
    email: string;
    photo?: string;
  }
): Promise<{ success: boolean; error: string | null; isNewUser?: boolean }> => {
  return upsertSocialUserProfile(userId, {
    name: googleData.name,
    email: googleData.email,
    photo: googleData.photo || null
  });
};

export const createOrUpdateUserFromApple = async (
  userId: string,
  appleData: {
    name?: string;
    email: string;
    photo?: string;
  }
): Promise<{ success: boolean; error: string | null; isNewUser?: boolean }> => {
  return upsertSocialUserProfile(userId, {
    name: appleData.name,
    email: appleData.email,
    photo: appleData.photo || null
  });
};

// Buscar perfil do usuário
export const getUserProfile = async (userId: string): Promise<{ profile: UserProfile | null; error: string | null }> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle(); // Usar maybeSingle() ao invés de single() para evitar erro se não houver resultado

    if (error) {
      console.error('❌ Erro ao buscar perfil:', error);
      return { profile: null, error: error.message };
    }

    if (!data) {
      return { profile: null, error: 'Perfil não encontrado' };
    }

    console.log('✅ Perfil encontrado:', data);
    return { profile: data, error: null };
  } catch (error) {
    console.error('💥 Erro de conexão ao buscar perfil:', error);
    return { profile: null, error: 'Erro de conexão' };
  }
};

/** Nome da conta que dá para reutilizar no artista (ignora e-mail Apple, "Usuário", vazio). */
export function accountNameForArtist(name?: string | null): string | null {
  const n = String(name ?? '').trim();
  if (n.length < 2 || n.length > 50) return null;
  const lower = n.toLowerCase();
  if (lower === 'usuário' || lower === 'usuario') return null;
  if (n.includes('@')) return null;
  if (/privaterelay\.appleid\.com/i.test(n)) return null;
  return n;
}

// Atualizar perfil do usuário
export const updateUserProfile = async (userId: string, userData: Partial<CreateUserProfileData>): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { error } = await supabase
      .from('users')
      .update({
        ...userData,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

/** Máximo de perfis de artista que o usuário pode possuir como admin no plano gratuito (sem assinatura ativa em `user_subscriptions`). */
export const FREE_PLAN_MAX_OWNED_ARTIST_PROFILES = 1;

/** No gratuito: no máximo 2 colaboradores além do criador/admin (3 pessoas no `artist_members` no total). */
export const FREE_PLAN_MAX_COLLABORATORS_PER_ARTIST = 2;

/** Total de membros permitidos no artista no plano gratuito (criador + colaboradores). */
export const FREE_PLAN_MAX_TEAM_MEMBERS_PER_ARTIST = 1 + FREE_PLAN_MAX_COLLABORATORS_PER_ARTIST;

const FREE_PLAN_TEAM_LIMIT_MESSAGE =
  'No plano gratuito, cada artista pode ter no máximo 2 colaboradores (3 pessoas no time no total, incluindo o criador). Se algum administrador ou proprietário tiver Premium, o limite some.';

/** Indica se o usuário tem assinatura vigente em `user_subscriptions` (status + expires_at). */
export const userSubscriptionIsActive = async (
  userId: string,
): Promise<{ active: boolean; error: string | null }> => {
  try {
    const { data, error } = await supabase.rpc('user_subscription_is_active', {
      p_user_id: userId,
    });
    if (error) return { active: false, error: error.message };
    return { active: data === true, error: null };
  } catch {
    return { active: false, error: 'Erro de conexão' };
  }
};

export type UserSubscriptionTableCheck = {
  isActive: boolean;
  status: string | null;
  error: string | null;
};

function metadataAppleStoreConfirmed(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as { apple_store_confirmed?: unknown }).apple_store_confirmed === true;
}

/**
 * Consulta `user_subscriptions`: Premium se active/grace com expiração válida,
 * ou `pending` com expires_at no futuro e sem confirmação Apple (igual à RPC `user_subscription_is_active`).
 */
export const checkUserSubscriptionFromTable = async (
  userId: string,
): Promise<UserSubscriptionTableCheck> => {
  try {
    const { data: rows, error } = await supabase
      .from('user_subscriptions')
      .select('status, expires_at, metadata')
      .eq('user_id', userId)
      .in('status', ['active', 'grace_period', 'cancelled', 'pending']);

    if (error) {
      return { isActive: false, status: null, error: error.message };
    }
    if (!rows?.length) {
      return { isActive: false, status: null, error: null };
    }

    const now = Date.now();
    let bestStatus: string | null = null;

    for (const row of rows) {
      const exp = row.expires_at ? new Date(row.expires_at).getTime() : null;
      const expiresOk = exp == null || exp > now;
      if (!expiresOk) continue;

      if (row.status === 'active' || row.status === 'grace_period') {
        return { isActive: true, status: row.status, error: null };
      }
      if (row.status === 'cancelled' && row.expires_at && exp != null && exp > now) {
        return { isActive: true, status: row.status, error: null };
      }
      if (
        row.status === 'pending' &&
        row.expires_at &&
        exp != null &&
        exp > now &&
        !metadataAppleStoreConfirmed(row.metadata)
      ) {
        bestStatus = 'pending';
      }
    }

    if (bestStatus === 'pending') {
      return { isActive: true, status: 'pending', error: null };
    }

    return { isActive: false, status: null, error: null };
  } catch {
    return { isActive: false, status: null, error: 'Erro de conexão' };
  }
};

/** Limite de exportações financeiras (PDF/cópia) no trial antes do Premium. */
export const FREE_FINANCE_TRIAL_EXPORT_LIMIT = 3;

/** Limite de aberturas da tela de detalhes financeiros no trial antes do Premium. */
export const FREE_FINANCE_TRIAL_DETAIL_OPEN_LIMIT = 3;

export type FinancialTrialKind = 'export' | 'detail_open';

export type FinancialTrialStatus = {
  premium: boolean;
  exportsUsed: number;
  exportsLimit: number;
  exportsRemaining: number;
  detailOpensUsed: number;
  detailOpensLimit: number;
  detailOpensRemaining: number;
  error: string | null;
};

const emptyFinancialTrialStatus = (error: string | null): FinancialTrialStatus => ({
  premium: false,
  exportsUsed: 0,
  exportsLimit: FREE_FINANCE_TRIAL_EXPORT_LIMIT,
  exportsRemaining: 0,
  detailOpensUsed: 0,
  detailOpensLimit: FREE_FINANCE_TRIAL_DETAIL_OPEN_LIMIT,
  detailOpensRemaining: 0,
  error,
});

/**
 * Lê contadores de trial em `users` + Premium em `user_subscriptions` (via RPC no Supabase).
 * Requer script `database/free_financial_trial.sql` aplicado no projeto.
 */
export const getFinancialTrialStatus = async (): Promise<FinancialTrialStatus> => {
  try {
    const { data, error } = await supabase.rpc('get_financial_trial_status');
    if (error) {
      const msg = error.message || '';
      const code = (error as { code?: string }).code;
      if (
        code === 'PGRST202' ||
        code === '42883' ||
        msg.includes('get_financial_trial_status') ||
        msg.includes('does not exist') ||
        msg.includes('42883')
      ) {
        return emptyFinancialTrialStatus('rpc_missing');
      }
      return emptyFinancialTrialStatus(msg);
    }
    if (!data || typeof data !== 'object') {
      return emptyFinancialTrialStatus('Resposta inválida do servidor');
    }
    const j = data as Record<string, unknown>;
    if (j.error === 'not_authed') {
      return emptyFinancialTrialStatus('Sessão expirada');
    }
    return {
      premium: j.premium === true,
      exportsUsed: Number(j.exportsUsed) || 0,
      exportsLimit: Number(j.exportsLimit) || FREE_FINANCE_TRIAL_EXPORT_LIMIT,
      exportsRemaining: Number(j.exportsRemaining) || 0,
      detailOpensUsed: Number(j.detailOpensUsed) || 0,
      detailOpensLimit: Number(j.detailOpensLimit) || FREE_FINANCE_TRIAL_DETAIL_OPEN_LIMIT,
      detailOpensRemaining: Number(j.detailOpensRemaining) || 0,
      error: null,
    };
  } catch {
    return emptyFinancialTrialStatus('Erro de conexão');
  }
};

export type ConsumeFinancialTrialResult = {
  ok: boolean;
  reason?: string;
  remaining?: number;
  error?: string | null;
};

/** Consome 1 uso do trial (`export` ou `detail_open`); usuários Premium não alteram contadores. */
export const consumeFinancialTrialAction = async (
  kind: FinancialTrialKind,
): Promise<ConsumeFinancialTrialResult> => {
  try {
    const { data, error } = await supabase.rpc('consume_financial_trial_action', {
      p_kind: kind,
    });
    if (error) {
      const msg = error.message || '';
      const code = (error as { code?: string }).code;
      if (
        code === 'PGRST202' ||
        code === '42883' ||
        msg.includes('consume_financial_trial_action') ||
        msg.includes('does not exist')
      ) {
        return { ok: false, error: 'rpc_missing' };
      }
      return { ok: false, error: error.message };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Resposta inválida' };
    }
    const j = data as Record<string, unknown>;
    return {
      ok: j.ok === true,
      reason: typeof j.reason === 'string' ? j.reason : undefined,
      remaining: typeof j.remaining === 'number' ? j.remaining : undefined,
      error: null,
    };
  } catch {
    return { ok: false, error: 'Erro de conexão' };
  }
};

/** Algum admin do artista com assinatura ativa em `user_subscriptions` libera time ilimitado. */
export const artistTeamHasPremiumQuota = async (
  artistId: string,
): Promise<{ premium: boolean; error: string | null }> => {
  try {
    const { data: leads, error } = await supabase
      .from('artist_members')
      .select('user_id')
      .eq('artist_id', artistId)
      .eq('role', 'admin');

    if (error) {
      return { premium: false, error: error.message };
    }
    if (!leads?.length) {
      return { premium: false, error: null };
    }

    const ids = [...new Set(leads.map((r) => r.user_id))];
    const { data, error: rpcError } = await supabase.rpc('any_users_have_active_subscription', {
      p_user_ids: ids,
    });

    if (rpcError) {
      return { premium: false, error: rpcError.message };
    }

    return { premium: data === true, error: null };
  } catch {
    return { premium: false, error: 'Erro de conexão' };
  }
};

export const getArtistMemberCount = async (
  artistId: string,
): Promise<{ count: number; error: string | null }> => {
  try {
    const { count, error } = await supabase
      .from('artist_members')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId);

    if (error) {
      return { count: 0, error: error.message };
    }
    return { count: count ?? 0, error: null };
  } catch {
    return { count: 0, error: 'Erro de conexão' };
  }
};

/** Convites pendentes que reservam vaga ao serem aceitos. */
export const countPendingArtistInvites = async (artistId: string): Promise<{ count: number; error: string | null }> => {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId)
      .eq('status', 'pending')
      .in('type', ['invite', 'collaborator_invite']);

    if (error) {
      return { count: 0, error: error.message };
    }

    // Convites por link (pra quem ainda não tem conta) também ocupam vaga no time.
    const { count: linkCount, error: linkError } = await supabase
      .from('pending_collaborator_invites')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId)
      .is('consumed_at', null);

    if (linkError) {
      return { count: 0, error: linkError.message };
    }

    return { count: (count ?? 0) + (linkCount ?? 0), error: null };
  } catch {
    return { count: 0, error: 'Erro de conexão' };
  }
};

export type ArtistTeamSlotMode = 'send_invite' | 'add_member';

/** Valida limite de time no plano gratuito para um artista. */
export const assertArtistTeamSlot = async (
  artistId: string,
  mode: ArtistTeamSlotMode,
): Promise<{ ok: boolean; userMessage: string | null; error: string | null }> => {
  try {
    const { premium, error: pErr } = await artistTeamHasPremiumQuota(artistId);
    if (pErr) {
      return { ok: false, userMessage: null, error: pErr };
    }
    if (premium) {
      return { ok: true, userMessage: null, error: null };
    }

    const { count: memberCount, error: mErr } = await getArtistMemberCount(artistId);
    if (mErr) {
      return { ok: false, userMessage: null, error: mErr };
    }

    if (mode === 'add_member') {
      if (memberCount >= FREE_PLAN_MAX_TEAM_MEMBERS_PER_ARTIST) {
        return { ok: false, userMessage: FREE_PLAN_TEAM_LIMIT_MESSAGE, error: null };
      }
      return { ok: true, userMessage: null, error: null };
    }

    const { count: pending, error: pendErr } = await countPendingArtistInvites(artistId);
    if (pendErr) {
      return { ok: false, userMessage: null, error: pendErr };
    }

    if (memberCount + pending >= FREE_PLAN_MAX_TEAM_MEMBERS_PER_ARTIST) {
      return { ok: false, userMessage: FREE_PLAN_TEAM_LIMIT_MESSAGE, error: null };
    }
    return { ok: true, userMessage: null, error: null };
  } catch {
    return { ok: false, userMessage: null, error: 'Erro de conexão' };
  }
};

export interface CanCreateArtistResult {
  canCreate: boolean;
  error: string | null;
  isPremium: boolean;
  ownedAsAdminCount: number;
}

// Verificar se o usuário pode criar mais perfis de artista (como dono/admin)
export const canCreateArtist = async (userId: string): Promise<CanCreateArtistResult> => {
  try {
    const { profile, error: profileError } = await getUserProfile(userId);
    const { isActive: isPremium, error: subErr } = await checkUserSubscriptionFromTable(userId);
    if (subErr) {
      console.warn('⚠️ [canCreateArtist] user_subscriptions:', subErr);
    }

    const { count, error: countError } = await supabase
      .from('artist_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'admin');

    if (countError) {
      console.error('❌ [canCreateArtist] Erro ao contar artistas:', countError);
      return {
        canCreate: false,
        error: countError.message,
        isPremium,
        ownedAsAdminCount: 0,
      };
    }

    const ownedAsAdminCount = count ?? 0;
    const canCreate = isPremium || ownedAsAdminCount < FREE_PLAN_MAX_OWNED_ARTIST_PROFILES;

    if (profileError && !profile) {
      console.warn('⚠️ [canCreateArtist] Perfil users ausente; limite free aplicado:', profileError);
    }

    return { canCreate, error: null, isPremium, ownedAsAdminCount };
  } catch (error) {
    console.error('❌ [canCreateArtist] Erro de conexão:', error);
    return { canCreate: false, error: 'Erro de conexão', isPremium: false, ownedAsAdminCount: 0 };
  }
};

// Premium ou ainda com exportações trial (RPC get_financial_trial_status)
export const canExportData = async (userId: string): Promise<{ canExport: boolean; error: string | null }> => {
  const { isActive, error: subErr } = await checkUserSubscriptionFromTable(userId);
  if (subErr) return { canExport: false, error: subErr };
  if (isActive) return { canExport: true, error: null };
  const trial = await getFinancialTrialStatus();
  if (trial.error && trial.error !== 'rpc_missing') {
    return { canExport: false, error: trial.error };
  }
  if (trial.error === 'rpc_missing') {
    return { canExport: false, error: 'Trial financeiro não configurado no servidor' };
  }
  return { canExport: trial.exportsRemaining > 0, error: null };
};

// Salvar ou atualizar token FCM do usuário
export const saveFCMToken = async (userId: string, token: string): Promise<{ success: boolean; error: string | null }> => {
  try {
    console.log('💾 [saveFCMToken] Salvando token FCM para usuário:', userId);
    
    const { error } = await supabase
      .from('users')
      .update({
        token_fcm: token,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      console.error('❌ [saveFCMToken] Erro ao salvar token:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ [saveFCMToken] Token FCM salvo com sucesso!');
    return { success: true, error: null };
  } catch (error) {
    console.error('❌ [saveFCMToken] Erro de conexão:', error);
    return { success: false, error: 'Erro de conexão' };
  }
};