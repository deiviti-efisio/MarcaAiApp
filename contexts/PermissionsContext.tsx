import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useActiveArtistContext } from './ActiveArtistContext';
import {
  clearPermissionsCache,
  getUserPermissions,
  isArtistAdminRole,
  UserPermission,
} from '../services/supabase/permissionsService';

interface PermissionsContextData {
  userPermissions: UserPermission | null;
  permissionsLoaded: boolean;
  canCreateEvents: boolean;
  canEditEvents: boolean;
  canDeleteEvents: boolean;
  canViewFinancials: boolean;
  canManageMembers: boolean;
  canManageArtist: boolean;
  canDeleteArtist: boolean;
  /** Vendedor: vê o valor (cachê) apenas dos eventos que ele mesmo criou. */
  canViewOwnEventValue: boolean;
  isViewer: boolean;
  isAdmin: boolean;
  isVendedor: boolean;
  reloadPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextData>({} as PermissionsContextData);

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userPermissions, setUserPermissions] = useState<UserPermission | null>(null);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const { activeArtist } = useActiveArtistContext();

  const loadPermissions = async (forceNetwork = false) => {
    if (!activeArtist) {
      console.log('🔒 Permissões: Nenhum artista ativo');
      setUserPermissions(null);
      setPermissionsLoaded(true);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('🔒 Permissões: Nenhum usuário logado');
        setUserPermissions(null);
        setPermissionsLoaded(true);
        return;
      }

      if (forceNetwork) {
        clearPermissionsCache(user.id, activeArtist.id);
      }

      const permissions = await getUserPermissions(user.id, activeArtist.id, {
        skipCache: forceNetwork,
      });

      if (permissions) {
        console.log('✅ Permissões carregadas:', {
          role: permissions.role,
          canViewFinancials: permissions.permissions.canViewFinancials
        });
      } else {
        console.log('⚠️ Permissões: Nenhuma permissão encontrada na tabela artist_members');
      }

      setUserPermissions(permissions);
      setPermissionsLoaded(true);
    } catch (error) {
      console.error('❌ Permissões: Erro ao carregar:', error);
      setUserPermissions(null);
      setPermissionsLoaded(true);
    }
  };

  useEffect(() => {
    setUserPermissions(null);
    setPermissionsLoaded(false);
    void loadPermissions(true);
  }, [activeArtist?.id]);

  useEffect(() => {
    if (!activeArtist?.id) return;
    void loadPermissions(true);
  }, [activeArtist?.role]);

  const loadPermissionsRef = useRef(loadPermissions);
  loadPermissionsRef.current = loadPermissions;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void loadPermissionsRef.current(true);
      }
    });
    return () => sub.remove();
  }, []);

  // 🔥 ESCUTAR MUDANÇAS EM TEMPO REAL
  useEffect(() => {
    if (!activeArtist) return;

    const setupRealtimeListener = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = supabase
        .channel(`global-permissions:${user.id}:${activeArtist.id}`)
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'artist_members',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            // Recarregar permissões quando houver mudança
            if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
              const newData = payload.new as any;
              if (newData.artist_id === activeArtist.id) {
                void loadPermissions(true);
              }
            } else if (payload.eventType === 'DELETE') {
              const oldData = payload.old as any;
              if (oldData.artist_id === activeArtist.id) {
                setUserPermissions(null);
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    const cleanup = setupRealtimeListener();

    return () => {
      cleanup.then(cleanupFn => cleanupFn && cleanupFn());
    };
  }, [activeArtist]);

  // Helpers para verificar permissões facilmente
  // ⚠️ IMPORTANTE: Se userPermissions for null, NEGAR acesso (sem permissões)
  // Só libera se explicitamente tiver permissão
  const canCreateEvents = userPermissions?.permissions.canCreateEvents ?? false;
  const canEditEvents = userPermissions?.permissions.canEditEvents ?? false;
  const canDeleteEvents = userPermissions?.permissions.canDeleteEvents ?? false;
  const canViewFinancials = userPermissions?.permissions.canViewFinancials ?? false;
  const canManageMembers = userPermissions?.permissions.canManageMembers ?? false;
  const canManageArtist = userPermissions?.permissions.canManageArtist ?? false;
  const canDeleteArtist = userPermissions?.permissions.canDeleteArtist ?? false;
  const canViewOwnEventValue = userPermissions?.permissions.canViewOwnEventValue ?? false;

  const isViewer = userPermissions?.role === 'viewer';
  const isAdmin =
    userPermissions?.role === 'admin' && isArtistAdminRole(activeArtist?.role);
  const isVendedor = userPermissions?.role === 'vendedor';

  return (
    <PermissionsContext.Provider
      value={{
        userPermissions,
        permissionsLoaded,
        canCreateEvents,
        canEditEvents,
        canDeleteEvents,
        canViewFinancials,
        canManageMembers,
        canManageArtist,
        canDeleteArtist,
        canViewOwnEventValue,
        isViewer,
        isAdmin,
        isVendedor,
        reloadPermissions: () => loadPermissions(true),
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = () => {
  const context = useContext(PermissionsContext);
  
  if (!context) {
    throw new Error('usePermissions deve ser usado dentro de PermissionsProvider');
  }
  
  return context;
};

