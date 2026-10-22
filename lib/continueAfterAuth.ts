import { router } from 'expo-router';
import {
  checkArtistsAndRedirect,
  getCurrentUser,
  type ActiveArtistForRedirect,
} from '../services/supabase/authService';
import { getUserProfile } from '../services/supabase/userService';

type AfterAuthHref = '/cadastro-usuario' | '/selecionar-artista' | '/(tabs)/agenda';

export async function resolveAfterAuthRoute(userId?: string): Promise<{
  href: AfterAuthHref;
  artist?: ActiveArtistForRedirect;
}> {
  let id = userId;
  if (!id) {
    const { user } = await getCurrentUser();
    id = user?.id;
  }
  if (!id) return { href: '/cadastro-usuario' };

  const { profile } = await getUserProfile(id);
  if (!profile?.city?.trim() || !profile?.state?.trim()) {
    return { href: '/cadastro-usuario' };
  }

  const { shouldRedirectToSelection, activeArtist } = await checkArtistsAndRedirect(id);
  if (shouldRedirectToSelection) {
    return { href: '/selecionar-artista', artist: activeArtist };
  }
  return { href: '/(tabs)/agenda', artist: activeArtist };
}

export async function navigateAfterAuth(
  setActiveArtist?: (artist: ActiveArtistForRedirect) => Promise<void> | void,
  userId?: string,
  isNewUser?: boolean
): Promise<void> {
  if (isNewUser) {
    router.replace('/cadastro-usuario');
    return;
  }
  const dest = await resolveAfterAuthRoute(userId);
  if (dest.artist && setActiveArtist) {
    await setActiveArtist(dest.artist);
  }
  router.replace(dest.href);
}
