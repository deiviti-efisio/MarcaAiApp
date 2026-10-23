import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { getActiveArtist, setActiveArtist as saveToStorage, clearActiveArtist } from '../services/artistContext';
import { getArtistById, getArtists } from '../services/supabase/artistService';
import { getCurrentUser } from '../services/supabase/authService';
import { normalizeArtistMemberRole } from '../services/supabase/permissionsService';
import { isLikelyNetworkFailure } from '../utils/isLikelyNetworkFailure';

export interface ActiveArtist {
  id: string;
  name: string;
  role: string;
  profile_url?: string;
  musical_style?: string;
  created_at?: string;
}

interface ActiveArtistContextData {
  activeArtist: ActiveArtist | null;
  isLoading: boolean;
  setActiveArtist: (artist: ActiveArtist) => Promise<void>;
  refreshActiveArtist: () => Promise<void>;
  clearArtist: () => Promise<void>;
}

const ActiveArtistContext = createContext<ActiveArtistContextData>({} as ActiveArtistContextData);

async function resolveMembershipRole(artistId: string, fallback?: string): Promise<string> {
  try {
    const { user } = await getCurrentUser();
    if (!user) return fallback || 'viewer';
    const { data } = await supabase
      .from('artist_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('artist_id', artistId)
      .maybeSingle();
    if (data?.role) return normalizeArtistMemberRole(String(data.role));
  } catch {
    /* mantém fallback */
  }
  return fallback ? normalizeArtistMemberRole(String(fallback)) : 'viewer';
}

export const ActiveArtistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeArtist, setActiveArtistState] = useState<ActiveArtist | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef<any>(null);
  const artistIdRef = useRef<string | null>(null);

  // Carregar artista do AsyncStorage na inicialização
  useEffect(() => {
    loadArtistFromStorage();
  }, []);

  // Configurar realtime quando artista mudar
  useEffect(() => {
    if (activeArtist) {
      artistIdRef.current = activeArtist.id;
      setupRealtime();
    } else {
      artistIdRef.current = null;
      cleanupRealtime();
    }

    return () => {
      cleanupRealtime();
    };
  }, [activeArtist?.id]);

  const loadArtistFromStorage = async () => {
    setIsLoading(true);
    try {
      const saved = await getActiveArtist();

      if (!saved) {
        setActiveArtistState(null);
        return;
      }

      const membershipRole = await resolveMembershipRole(saved.id, saved.role);
      const fromStorage: ActiveArtist = {
        id: saved.id,
        name: saved.name,
        role: membershipRole,
        profile_url: saved.profile_url,
        musical_style: saved.musical_style,
        created_at: saved.created_at,
      };
      setActiveArtistState(fromStorage);
      setIsLoading(false);

      const { artist, error } = await getArtistById(saved.id);

      if (!error && artist) {
        const normalizedArtist: ActiveArtist = {
          id: artist.id,
          name: artist.name,
          role: membershipRole,
          profile_url: artist.profile_url || saved.profile_url,
          musical_style: artist.musical_style || saved.musical_style,
          created_at: artist.created_at || saved.created_at,
        };
        await saveToStorage(normalizedArtist);
        setActiveArtistState(normalizedArtist);
      } else if (error && isLikelyNetworkFailure(null, error)) {
        // Sem rede: mantém o que já veio do storage
      } else {
        await clearActiveArtist();
        setActiveArtistState(null);
      }
    } catch {
      setActiveArtistState(null);
    } finally {
      setIsLoading(false);
    }
  };

  const setActiveArtist = async (artist: ActiveArtist) => {
    try {
      // 1. Salvar no AsyncStorage
      await saveToStorage(artist);
      
      // 2. Atualizar estado imediatamente
      setActiveArtistState(artist);
      artistIdRef.current = artist.id;
    } catch (error) {
      // Erro ao definir artista
    }
  };

  const refreshActiveArtist = async () => {
    try {
      const saved = await getActiveArtist();
      if (!saved) return;

      // Buscar dados atualizados do banco
      const { artist, error } = await getArtistById(saved.id);

      if (!error && artist) {
        // Atualizar apenas se o ID for o mesmo (garantir que não troca)
        if (artistIdRef.current === artist.id) {
          const membershipRole = await resolveMembershipRole(artist.id, saved.role);
          const updatedArtist: ActiveArtist = {
            id: artist.id,
            name: artist.name,
            role: membershipRole,
            profile_url: artist.profile_url,
              musical_style: artist.musical_style || saved.musical_style,
              created_at: artist.created_at || saved.created_at,
          };
          
          await saveToStorage(updatedArtist);
          setActiveArtistState(updatedArtist);
          artistIdRef.current = updatedArtist.id;
        }
      }
    } catch (error) {
      // Erro ao atualizar
    }
  };

  const clearArtist = async () => {
    try {
      await clearActiveArtist();
      setActiveArtistState(null);
      artistIdRef.current = null;
    } catch (error) {
      // Erro ao limpar
    }
  };

  /**
   * Quando o usuário é removido do artista atual (linha em artist_members deletada),
   * tentamos automaticamente:
   * 1) Encontrar outro artista vinculado a esse usuário e alternar para ele
   * 2) Se não houver mais artistas, limpar estado e avisar que ele precisa criar um novo
   */
  const handleArtistMemberRemoved = async (removedArtistId: string) => {
    try {
      const { user, error: userError } = await getCurrentUser();
      if (userError || !user) {
        await clearArtist();
        return;
      }

      const { artists, error: artistsError } = await getArtists(user.id);
      const allArtists = artists || [];

      // Nenhum outro artista vinculado
      if (artistsError || allArtists.length === 0) {
        await clearArtist();
        Alert.alert(
          'Você foi removido deste artista',
          'Parece que você foi removido como colaborador e não está vinculado a nenhum outro artista. Crie um novo perfil para continuar.'
        );
        return;
      }

      // Procurar outro artista diferente do removido
      const alternativeArtist = allArtists.find(a => a.id !== removedArtistId) || null;

      if (!alternativeArtist) {
        // Só havia o artista removido
        await clearArtist();
        Alert.alert(
          'Você foi removido deste artista',
          'Parece que você foi removido como colaborador e não está vinculado a nenhum outro artista. Crie um novo perfil para continuar.'
        );
        return;
      }

      // Alternar automaticamente para outro artista disponível
      const nextActiveArtist: ActiveArtist = {
        id: alternativeArtist.id,
        name: alternativeArtist.name,
        role: alternativeArtist.role || 'viewer',
        profile_url: alternativeArtist.profile_url,
        musical_style: alternativeArtist.musical_style,
        created_at: alternativeArtist.created_at,
      };

      await saveToStorage(nextActiveArtist);
      setActiveArtistState(nextActiveArtist);
      artistIdRef.current = nextActiveArtist.id;

      Alert.alert(
        'Você foi removido deste artista',
        'Você foi removido como colaborador deste artista. Alteramos automaticamente para outro artista em que você ainda é colaborador.'
      );
    } catch (error) {
      await clearArtist();
    }
  };

  const setupRealtime = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !activeArtist) return;

      // Limpar canal anterior
      if (channelRef.current) {
        await supabase.removeChannel(channelRef.current);
      }

      const channelName = `artist-updates-${user.id}-${activeArtist.id}-${Date.now()}`;

      channelRef.current = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'artists',
            filter: `id=eq.${activeArtist.id}`,
          },
          async (payload) => {
            const updated = payload.new as any;
            
            // Apenas atualizar se for o mesmo artista ativo
            if (artistIdRef.current === updated.id) {
              const saved = await getActiveArtist();
              if (saved && saved.id === updated.id) {
                const updatedArtist: ActiveArtist = {
                  id: updated.id,
                  name: updated.name,
                  role: saved.role,
                  profile_url: updated.profile_url,
                  musical_style: updated.musical_style || saved.musical_style,
                  created_at: updated.created_at || saved.created_at,
                };
                
                await saveToStorage(updatedArtist);
                setActiveArtistState(updatedArtist);
              }
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'artist_members',
            filter: `user_id=eq.${user.id}`,
          },
          async (payload) => {
            const updated = payload.new as any;
            
            // Atualizar role se mudou
            if (artistIdRef.current === updated.artist_id) {
              const saved = await getActiveArtist();
              if (saved && saved.id === updated.artist_id) {
                const updatedArtist: ActiveArtist = {
                  ...saved,
                  role: updated.role
                };
                
                await saveToStorage(updatedArtist);
                setActiveArtistState(updatedArtist);
              }
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'artist_members',
            filter: `user_id=eq.${user.id}`,
          },
          async (payload) => {
            const deleted = payload.old as any;
            
            // Se removido do artista atual, tratar fluxo de remoção
            if (artistIdRef.current === deleted.artist_id) {
              await handleArtistMemberRemoved(deleted.artist_id);
            }
          }
        )
        .subscribe();
    } catch (error) {
      // Erro ao configurar realtime
    }
  };

  const cleanupRealtime = async () => {
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  };

  return (
    <ActiveArtistContext.Provider
      value={{
        activeArtist,
        isLoading,
        setActiveArtist,
        refreshActiveArtist,
        clearArtist,
      }}
    >
      {children}
    </ActiveArtistContext.Provider>
  );
};

export const useActiveArtistContext = () => {
  const context = useContext(ActiveArtistContext);
  
  if (!context) {
    throw new Error('useActiveArtistContext deve ser usado dentro de ActiveArtistProvider');
  }
  
  return context;
};

