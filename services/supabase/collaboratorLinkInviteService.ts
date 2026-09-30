import { supabase } from '../../lib/supabase';
import { assertArtistTeamSlot } from './userService';

export type CollaboratorLinkInviteRole = 'admin' | 'vendedor' | 'viewer';

/**
 * Convite de colaborador por email, para quem ainda não tem conta no MeuShow.
 * Fica pendente em `pending_collaborator_invites`; um trigger no banco adiciona a pessoa
 * automaticamente em `artist_members` quando ela criar conta com esse mesmo email
 * (ver database/ADD_COLLABORATOR_LINK_INVITE.sql).
 */
export const createCollaboratorLinkInvite = async (
  artistId: string,
  email: string,
  role: CollaboratorLinkInviteRole,
  invitedBy: string
): Promise<{ success: boolean; error: string | null }> => {
  try {
    const slot = await assertArtistTeamSlot(artistId, 'send_invite');
    if (slot.error) {
      return { success: false, error: slot.error };
    }
    if (!slot.ok) {
      return { success: false, error: slot.userMessage || 'Limite do plano gratuito atingido para este artista.' };
    }

    const { error } = await supabase.from('pending_collaborator_invites').insert({
      artist_id: artistId,
      email: email.trim().toLowerCase(),
      role,
      invited_by: invitedBy,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch {
    return { success: false, error: 'Erro ao criar convite por link' };
  }
};
