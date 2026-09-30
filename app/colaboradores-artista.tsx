import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OptimizedImage from '../components/OptimizedImage';
import { useTheme } from '../contexts/ThemeContext';
import { checkPendingInvite, createArtistInvite } from '../services/supabase/artistInviteService';
import { getCurrentUser } from '../services/supabase/authService';
import { addCollaborator, Collaborator, getCollaborators, removeCollaborator, searchUsersForCollaboratorInvite, updateCollaboratorRole } from '../services/supabase/collaboratorService';
import { createCollaboratorLinkInvite } from '../services/supabase/collaboratorLinkInviteService';
import { deletePendingInviteNotifications } from '../services/supabase/notificationService';
import { normalizeArtistMemberRole } from '../services/supabase/permissionsService';
import { useActiveArtist } from '../services/useActiveArtist';
import { APP_STORE_URL, PLAY_STORE_URL } from '../utils/storeLinks';

/** Aceita só o essencial: algo@algo.algo — suficiente pra decidir se vale oferecer convite por link. */
const isValidEmailForLinkInvite = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

type CollaboratorInviteRole = 'admin' | 'vendedor' | 'viewer';

/** Textos alinhados às regras reais (agenda, finanças, colaboradores, perfil). */
const COLLABORATOR_ROLES_CONFIG: {
  value: CollaboratorInviteRole;
  label: string;
  summary: string;
  powers: string[];
  limitations?: string[];
  modalIcon: React.ComponentProps<typeof Ionicons>['name'];
  modalColor: string;
}[] = [
  {
    value: 'admin',
    label: 'Administrador',
    summary: 'Acesso total ao artista: finanças, agenda, equipe e perfil.',
    powers: [
      'Ver, criar, editar e excluir eventos e despesas (com valores)',
      'Convidar colaboradores e mudar permissões',
      'Editar perfil do artista, excluir o artista e gerenciar convites',
    ],
    modalIcon: 'shield-checkmark',
    modalColor: '#FF6B35',
  },
  {
    value: 'vendedor',
    label: 'Vendedor',
    summary: 'Como o Visualizador, mas pode criar eventos e ver o valor dos que ele mesmo criou.',
    powers: [
      'Criar eventos',
      'Ver o valor (cachê) apenas dos eventos que ele mesmo criou',
    ],
    limitations: [
      'Não edita nem exclui eventos',
      'Não vê valores de eventos criados por outros nem o financeiro do artista',
      'Não convida/remove colaboradores nem edita perfil do artista',
    ],
    modalIcon: 'pricetag',
    modalColor: '#5B8DEF',
  },
  {
    value: 'viewer',
    label: 'Visualizador',
    summary: 'Só leitura: vê agenda e equipe, sem valores e sem editar.',
    powers: ['Ver eventos e dados do artista (sem valores em dinheiro)', 'Ver colaboradores e notificações'],
    limitations: ['Sem acesso a cachês/receitas/despesas', 'Não cria nem edita nada'],
    modalIcon: 'eye',
    modalColor: '#95A5A6',
  },
];

const COLLABORATOR_ROLES_FOR_PICKER = COLLABORATOR_ROLES_CONFIG;

/** Cidade/UF vindos do cadastro do usuário (`users`), quando a RPC os retorna. */
function formatBuscaColaboradorLocalizacao(u: { city?: string | null; state?: string | null }): string {
  const city = u.city?.trim() || '';
  const state = u.state?.trim() || '';
  if (!city && !state) return 'Local não informado';
  if (city && state) return `${city} — ${state}`;
  return city || state;
}

export default function ColaboradoresArtistaScreen() {
  const { colors } = useTheme();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [canAddCollaborators, setCanAddCollaborators] = useState(false);
  const [collaboratorPlanBlockedMessage, setCollaboratorPlanBlockedMessage] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const { activeArtist, loadActiveArtist } = useActiveArtist();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newCollaboratorRole, setNewCollaboratorRole] = useState<CollaboratorInviteRole>('viewer');
  const [isAdding, setIsAdding] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedCollaborator, setSelectedCollaborator] = useState<Collaborator | null>(null);
  const [selectedRole, setSelectedRole] = useState<CollaboratorInviteRole>('viewer');
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [showInviteSentModal, setShowInviteSentModal] = useState(false);
  const [inviteSentData, setInviteSentData] = useState<{
    userName: string;
    userEmail: string;
    userImage: string;
    role: CollaboratorInviteRole;
  } | null>(null);
  const [existingInviteIdToDelete, setExistingInviteIdToDelete] = useState<string | null>(null); // ID da notificação antiga para deletar ao reenviar
  const [showPendingInviteModal, setShowPendingInviteModal] = useState(false);
  const [pendingInviteData, setPendingInviteData] = useState<{
    userName: string;
    role: string;
    createdAt: string;
  } | null>(null);
  const [linkInviteRole, setLinkInviteRole] = useState<CollaboratorInviteRole>('viewer');
  const [isInvitingByLink, setIsInvitingByLink] = useState(false);

  useEffect(() => {
    loadActiveArtist();
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    const { user } = await getCurrentUser();
    if (user) {
      setCurrentUserId(user.id);
    }
  };

  useEffect(() => {
    if (activeArtist) {
      loadData();
    }
  }, [activeArtist]);


  const loadData = async () => {
    if (!activeArtist) return;
    
    try {
      setIsLoading(true);
      
      // Garantir que temos o currentUserId
      if (!currentUserId) {
        const { user } = await getCurrentUser();
        if (user) {
          setCurrentUserId(user.id);
        }
      }
      
      // Buscar colaboradores
      const {
        collaborators,
        userRole,
        canManage,
        canAddCollaborators,
        collaboratorPlanBlockedMessage: planMsg,
        error: collaboratorsError,
      } = await getCollaborators(activeArtist.id);
      
      console.log('📊 Dados carregados:', {
        userRole,
        canManage,
        canAddCollaborators,
        currentUserId,
        totalColaboradores: collaborators?.length || 0
      });
      
      if (collaboratorsError) {
        Alert.alert('Erro', 'Erro ao carregar colaboradores');
        return;
      }

      setCollaborators(collaborators || []);
      setUserRole(userRole);
      setCanManage(canManage);
      setCanAddCollaborators(canAddCollaborators);
      setCollaboratorPlanBlockedMessage(planMsg || null);
    } catch (error) {
      Alert.alert('Erro', 'Erro ao carregar dados');
    } finally {
      setIsLoading(false);
    }
  };

  /** Limpa busca e seleção ao abrir o modal ou ao cancelar/fechar sem convidar. */
  const resetBuscarColaboradorModal = () => {
    setSearchTerm('');
    setSearchResults([]);
    setSelectedUser(null);
    setIsSearching(false);
  };

  const closeBuscarColaboradorModal = () => {
    resetBuscarColaboradorModal();
    setShowAddModal(false);
  };

  const handleInviteByLink = async () => {
    if (!activeArtist || !currentUserId) {
      Alert.alert('Erro', 'Dados insuficientes');
      return;
    }
    const email = searchTerm.trim().toLowerCase();
    if (!isValidEmailForLinkInvite(email)) return;

    setIsInvitingByLink(true);
    try {
      const { success, error } = await createCollaboratorLinkInvite(
        activeArtist.id,
        email,
        linkInviteRole,
        currentUserId
      );

      if (!success) {
        Alert.alert('Erro', error || 'Erro ao criar convite por link');
        return;
      }

      const roleLabel = getRoleLabel(linkInviteRole);
      const storeUrl = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
      await Share.share({
        message:
          `Você foi convidado(a) para colaborar como ${roleLabel} no MeuShow, o app de gestão de agenda do artista "${activeArtist.name}".\n\n` +
          `1. Baixe o app: ${storeUrl}\n` +
          `2. Crie sua conta usando este email: ${email}\n\n` +
          `Assim que você criar a conta, já entra automaticamente na equipe.`,
      });

      resetBuscarColaboradorModal();
      setShowAddModal(false);
      Alert.alert(
        'Convite pronto',
        'Assim que essa pessoa criar conta no MeuShow usando o mesmo email, ela entra automaticamente na equipe.'
      );
    } catch {
      Alert.alert('Erro', 'Erro ao criar convite por link');
    } finally {
      setIsInvitingByLink(false);
    }
  };

  const handleSearchUsers = async (term: string) => {
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }

    if (!activeArtist?.id) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);
      const { users, error } = await searchUsersForCollaboratorInvite(term, activeArtist.id);

      if (error) {
        setSearchResults([]);
        Alert.alert('Erro na busca', error);
        return;
      }

      setSearchResults(users || []);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectUser = async (user: any) => {
    if (!activeArtist || !currentUserId) {
      Alert.alert('Erro', 'Dados insuficientes');
      return;
    }

    // ✅ VERIFICAR PRIMEIRO se já existe convite pendente ANTES de definir o usuário
    try {
      console.log('🔍 Verificando convite pendente para:', { artistId: activeArtist.id, userId: user.id });
      const { success: checkSuccess, invite: existingInvite } = await checkPendingInvite(
        activeArtist.id, 
        user.id
      );

      console.log('📋 Resultado da verificação:', { success: checkSuccess, hasInvite: !!existingInvite });

      if (existingInvite) {
        console.log('⚠️ Convite pendente encontrado! Bloqueando ação.');
        console.log('📋 Detalhes do convite pendente:', {
          id: existingInvite.id,
          artistId: existingInvite.artist_id,
          toUserId: existingInvite.to_user_id,
          role: existingInvite.role,
          status: existingInvite.status,
          createdAt: existingInvite.created_at
        });
        
        // Formatar data do convite
        const formatDate = (dateString: string) => {
          const date = new Date(dateString);
          return date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo'
          });
        };

        // Formatar role para exibição
        const formatRole = (role: string) => {
          const n = normalizeArtistMemberRole(role);
          const roles: Record<CollaboratorInviteRole, string> = {
            viewer: 'Visualizador',
            vendedor: 'Vendedor',
            admin: 'Administrador',
          };
          return roles[n];
        };

        // Fechar modal de busca primeiro
        setShowAddModal(false);
        setSearchResults([]);
        setSearchTerm('');
        
        // Mostrar modal customizado com informações do convite pendente
        setPendingInviteData({
          userName: user.name,
          role: formatRole(existingInvite.role || 'viewer'),
          createdAt: formatDate(existingInvite.created_at)
        });
        setSelectedUser(user);
        setExistingInviteIdToDelete(existingInvite.id);
        setNewCollaboratorRole(normalizeArtistMemberRole(existingInvite.role || 'viewer'));
        
        // Abrir modal de convite pendente
        console.log('🔔 Abrindo modal de convite pendente');
        setShowPendingInviteModal(true);
        
        // ✅ NÃO definir o usuário selecionado se já existe convite pendente (só se clicar em Reenviar)
        return;
      }

      // ✅ Só definir o usuário e abrir modal se NÃO existe convite pendente
      setSelectedUser(user);
      setSearchResults([]);
      setSearchTerm(user.name);
      setShowAddModal(false);
      
      setTimeout(() => {
        setShowInviteModal(true);
      }, 100);
    } catch (error) {
      // Em caso de erro na verificação, permitir prosseguir
      setSelectedUser(user);
      setSearchResults([]);
      setSearchTerm(user.name);
      setShowAddModal(false);
      
      setTimeout(() => {
        setShowInviteModal(true);
      }, 100);
    }
  };

  const handleInviteCollaborator = () => {
    if (!selectedUser) {
      Alert.alert('Erro', 'Selecione um usuário');
      return;
    }
    // Abrir modal de seleção de permissão
    setShowInviteModal(true);
  };

  const handleConfirmInvite = async () => {
    if (!selectedUser || !activeArtist || !currentUserId) return;

    try {
      setIsInviting(true);

      // Obter o usuário atual para ser o remetente
      const { user: currentUser, error: userError } = await getCurrentUser();
      
      if (userError || !currentUser) {
        Alert.alert('Erro', 'Erro ao obter dados do usuário atual');
        return;
      }

      // Se há uma notificação pendente para deletar (reenvio), deletar ela antes de criar a nova
      if (existingInviteIdToDelete) {
        console.log('🗑️ Deletando notificação pendente:', existingInviteIdToDelete);
        
        // Deletar a notificação pendente encontrada
        const { success: deleteSuccess, error: deleteError } = await deletePendingInviteNotifications(
          activeArtist.id,
          selectedUser.id
        );
        
        if (!deleteSuccess) {
          console.error('❌ Erro ao deletar notificação pendente:', deleteError);
          Alert.alert('Erro', deleteError || 'Erro ao remover convite antigo');
          setIsInviting(false);
          setExistingInviteIdToDelete(null);
          return;
        }
        
        console.log('✅ Notificação pendente deletada');
        setExistingInviteIdToDelete(null);
      }

      // Criar convite (primeira vez ou reenvio)
      const inviteRole = newCollaboratorRole;

      console.log('📝 Criando novo convite:', {
        artistId: activeArtist.id,
        toUserId: selectedUser.id,
        fromUserId: currentUser.id,
        role: inviteRole
      });
      
      const { success, error, invite } = await createArtistInvite({
        artistId: activeArtist.id,
        toUserId: selectedUser.id,
        fromUserId: currentUser.id,
        role: inviteRole
      });

      if (success) {
        // Salvar dados do convite para mostrar no modal
        setInviteSentData({
          userName: selectedUser.name,
          userEmail: selectedUser.email,
          userImage: selectedUser.profile_url || '',
          role: inviteRole
        });
        
        setShowInviteModal(false);
        setShowAddModal(false);
        setShowInviteSentModal(true);
                    setSearchTerm('');
                    setSearchResults([]);
                    setSelectedUser(null);
                    setNewCollaboratorRole('viewer');
                    setExistingInviteIdToDelete(null); // Limpar o ID da notificação antiga
      } else {
        Alert.alert('Erro', error || 'Erro ao enviar convite');
      }
    } catch (error) {
      Alert.alert('Erro', 'Erro ao enviar convite');
    } finally {
      setIsInviting(false);
    }
  };

  const handleAddCollaborator = async () => {
    if (!selectedUser) {
      Alert.alert('Erro', 'Selecione um usuário');
      return;
    }

    if (!activeArtist) return;

    try {
      setIsAdding(true);

      const { success, error } = await addCollaborator(activeArtist.id, {
        userId: selectedUser.id,
        role: newCollaboratorRole
      });

      if (success) {
        Alert.alert('Sucesso', 'Colaborador adicionado com sucesso!');
        setShowAddModal(false);
                    setSearchTerm('');
                    setSearchResults([]);
                    setSelectedUser(null);
                    setNewCollaboratorRole('viewer');
                    setExistingInviteIdToDelete(null); // Limpar o ID da notificação antiga
        loadData(); // Recarregar dados
      } else {
        Alert.alert('Erro', error || 'Erro ao adicionar colaborador');
      }
    } catch (error) {
      Alert.alert('Erro', 'Erro ao adicionar colaborador');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveCollaborator = (userId: string, userName: string) => {
    if (!activeArtist) return;

    // ✅ Ninguém pode se remover (deve usar "Sair do Artista")
    if (userId === currentUserId) {
      Alert.alert(
        'Ação Não Permitida',
        'Você não pode se remover desta forma. Use a opção "Sair do Artista" nas configurações.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Remover Colaborador',
      `Tem certeza que deseja remover ${userName}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            try {
              const { success, error } = await removeCollaborator(userId, activeArtist.id);
              
              if (success) {
                Alert.alert('Sucesso', 'Colaborador removido com sucesso!');
                loadData(); // Recarregar dados
              } else {
                Alert.alert('Erro', error || 'Erro ao remover colaborador');
              }
            } catch (error) {
              Alert.alert('Erro', 'Erro ao remover colaborador');
            }
          }
        }
      ]
    );
  };

  const handleUpdateRole = (userId: string, currentRole: string, userName: string) => {
    if (!activeArtist) return;
    
    // ✅ Ninguém pode alterar suas próprias permissões
    if (userId === currentUserId) {
      Alert.alert(
        'Ação Não Permitida',
        'Você não pode alterar suas próprias permissões.',
        [{ text: 'OK' }]
      );
      return;
    }

    const collaborator = collaborators.find(c => c.user_id === userId);
    if (!collaborator) return;
    
    setSelectedCollaborator(collaborator);
    setSelectedRole(currentRole as any);
    setShowRoleModal(true);
  };
  
  const handleConfirmRoleUpdate = async () => {
    if (!selectedCollaborator || !activeArtist) return;
    
    try {
      setIsUpdatingRole(true);
      
      const { success, error } = await updateCollaboratorRole(
        selectedCollaborator.user_id, 
        activeArtist.id, 
        selectedRole
      );
      
      if (success) {
        Alert.alert('Sucesso', 'Permissão alterada com sucesso!');
        setShowRoleModal(false);
        setSelectedCollaborator(null);
        loadData(); // Recarregar dados
      } else {
        Alert.alert('Erro', error || 'Erro ao alterar permissão');
      }
    } catch (error) {
      Alert.alert('Erro', 'Erro ao alterar permissão');
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return 'shield-checkmark';
      case 'vendedor':
        return 'pricetag';
      case 'viewer':
        return 'eye';
      default:
        return 'person';
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return '#FF6B35'; // Laranja - mantém fixo
      case 'vendedor':
        return '#5B8DEF'; // Azul
      case 'viewer':
        return colors.textSecondary; // Cinza
      default:
        return colors.primary;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Administrador';
      case 'vendedor':
        return 'Vendedor';
      case 'viewer':
        return 'Visualizador';
      default:
        return role;
    }
  };

  const renderCollaborator = ({ item }: { item: Collaborator }) => {
    const isCurrentUser = item.user_id === currentUserId;
    
    // Apenas administradores alteram/removem outros colaboradores
    let canChangeThisRole = false;
    let canRemoveThis = false;
    
    console.log('👥 Renderizando colaborador:', {
      nome: item.user.name,
      colaboradorRole: item.role,
      meuRole: userRole,
      isCurrentUser,
      currentUserId,
      itemUserId: item.user_id
    });
    
    if (!isCurrentUser) {
      if (userRole === 'admin') {
        canChangeThisRole = true;
        canRemoveThis = true;
        console.log('✅ EU SOU ADMIN - posso alterar:', item.user.name, 'que é', item.role);
      } else {
        console.log('⚠️ Meu role não é admin:', userRole);
      }
    } else {
      console.log('❌ Não pode alterar:', { 
        motivo: 'É você mesmo'
      });
    }
    
    console.log('🔧 Resultado final dos botões:', { 
      colaborador: item.user.name,
      canChangeThisRole, 
      canRemoveThis,
      meuRole: userRole,
      colaboradorRole: item.role
    });
    
    return (
      <View style={[styles.collaboratorCard, { backgroundColor: colors.surface }]}>
        <View style={styles.collaboratorInfo}>
          <OptimizedImage
            imageUrl={item.user.profile_url || ''}
            style={styles.collaboratorAvatar}
            cacheKey={`collaborator_${item.user_id}`}
            fallbackText={item.user.name || 'Usuário'}
            fallbackIcon="person"
            fallbackIconSize={24}
            fallbackIconColor="#FFFFFF"
          />
          <View style={styles.collaboratorDetails}>
            <View style={styles.nameRow}>
              <Text style={[styles.collaboratorName, { color: colors.text }]}>{item.user.name}</Text>
              {isCurrentUser && (
                <View style={[styles.youBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.youBadgeText}>VOCÊ</Text>
                </View>
              )}
            </View>
            <Text style={[styles.collaboratorEmail, { color: colors.textSecondary }]}>{item.user.email}</Text>
            <View style={styles.roleContainer}>
              <Ionicons 
                name={getRoleIcon(item.role) as any} 
                size={16} 
                color={getRoleColor(item.role)} 
              />
              <Text style={[styles.roleText, { color: getRoleColor(item.role) }]}>
                {getRoleLabel(item.role)}
              </Text>
            </View>
          </View>
        </View>
        
        {(canChangeThisRole || canRemoveThis) && (
          <View style={styles.collaboratorActions}>
            {canChangeThisRole && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleUpdateRole(item.user_id, item.role, item.user.name)}
              >
                <Ionicons name="swap-horizontal" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
            {canRemoveThis && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleRemoveCollaborator(item.user_id, item.user.name)}
              >
                <Ionicons name="trash" size={20} color={colors.error} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Colaboradores</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Carregando colaboradores...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Colaboradores</Text>
        <View style={styles.headerActions}>
          {canManage && (
            <>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => router.push('/convites-enviados')}
              >
                <Ionicons name="mail" size={24} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => router.push('/selecionar-artista')}
              >
                <Ionicons name="swap-horizontal" size={24} color={colors.primary} />
              </TouchableOpacity>
            </>
          )}
          {canAddCollaborators && (
            <TouchableOpacity 
              style={styles.addButton}
              onPress={() => {
                if (!currentUserId) {
                  Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
                  return;
                }
                resetBuscarColaboradorModal();
                setShowAddModal(true);
              }}
            >
              <Ionicons name="add" size={24} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.content}>
        {canManage && collaboratorPlanBlockedMessage ? (
          <View
            style={[
              styles.planLimitBanner,
              { backgroundColor: `${colors.warning}22`, borderColor: colors.warning },
            ]}
          >
            <Text style={[styles.planLimitBannerText, { color: colors.text }]}>{collaboratorPlanBlockedMessage}</Text>
            <TouchableOpacity onPress={() => router.push('/assine-premium')} style={styles.planLimitBannerBtn}>
              <Text style={[styles.planLimitBannerBtnText, { color: colors.primary }]}>Ver Premium</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {/* Informações do artista */}
        {activeArtist && (
          <View style={[styles.artistInfo, { backgroundColor: colors.surface }]}>
            <Text style={[styles.artistName, { color: colors.text }]}>{activeArtist.name}</Text>
            <Text style={[styles.collaboratorCount, { color: colors.textSecondary }]}>
              {collaborators.length} colaborador{collaborators.length !== 1 ? 'es' : ''}
            </Text>
          </View>
        )}

        {/* Lista de colaboradores */}
        {collaborators.length > 0 ? (
          <FlatList
            data={collaborators}
            renderItem={renderCollaborator}
            keyExtractor={(item) => `${item.user_id}-${item.artist_id}`}
            scrollEnabled={false}
            style={styles.collaboratorsList}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>
              Nenhum colaborador encontrado
            </Text>
            {canAddCollaborators && (
              <Text style={styles.emptySubtext}>
                Toque no botão + para adicionar colaboradores
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal para adicionar colaborador */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeBuscarColaboradorModal}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity 
              onPress={closeBuscarColaboradorModal}
              style={styles.modalCloseButton}
            >
              <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>Cancelar</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Buscar Usuário</Text>
            <TouchableOpacity 
              onPress={handleInviteCollaborator}
              style={[styles.modalSaveButton, !selectedUser && styles.disabledButton]}
              disabled={!selectedUser}
            >
              <Text style={[styles.modalSaveText, !selectedUser && styles.disabledButtonText]}>
                Convidar {selectedUser ? '(Ativo)' : '(Inativo)'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Buscar usuário</Text>
              <Text style={[styles.collaboratorSearchHint, { color: colors.textSecondary }]}>
                Só aparecem contas que já têm perfil de artista no app e ainda não são colaboradoras deste artista. Busca pelo nome (início de cada palavra). Nome e localização (cidade/UF) quando existir.
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={searchTerm}
                onChangeText={(text) => {
                  setSearchTerm(text);
                  handleSearchUsers(text);
                }}
                placeholder="Nome"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
              />
              
              {searchResults.length > 0 && (
                <View style={styles.collaboratorSearchResultsList}>
                  {searchResults.map((user) => (
                    <TouchableOpacity
                      key={user.id}
                      activeOpacity={0.75}
                      style={[
                        styles.collaboratorInviteCard,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                      onPress={() => handleSelectUser(user)}
                    >
                      <View style={styles.collaboratorInviteCardHeader}>
                        <OptimizedImage
                          imageUrl={user.profile_url || ''}
                          style={styles.collaboratorInviteCardAvatar}
                          cacheKey={`user_search_${user.id}`}
                          fallbackText={user.name || 'Usuário'}
                          fallbackIcon="person"
                          fallbackIconSize={22}
                          fallbackIconColor="#667eea"
                        />
                        <View style={styles.collaboratorInviteCardHeaderText}>
                          <Text style={[styles.collaboratorInviteCardName, { color: colors.text }]} numberOfLines={1}>
                            {user.name}
                          </Text>
                          <View style={styles.collaboratorInviteLocationRow}>
                            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                            <Text style={[styles.collaboratorInviteCardEmail, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>
                              {formatBuscaColaboradorLocalizacao(user)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              
              {isSearching && (
                <View style={styles.searchLoading}>
                  <ActivityIndicator size="small" color="#667eea" />
                  <Text style={[styles.searchLoadingText, { color: colors.textSecondary }]}>Buscando usuários...</Text>
                </View>
              )}
              
              {searchTerm.length >= 2 && searchResults.length === 0 && !isSearching && (
                <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>Nenhum usuário encontrado</Text>
              )}

              {searchTerm.length >= 2 && searchResults.length === 0 && !isSearching && isValidEmailForLinkInvite(searchTerm) && (
                <View style={[styles.linkInviteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.linkInviteTitle, { color: colors.text }]}>
                    Esse email ainda não tem conta no MeuShow
                  </Text>
                  <Text style={[styles.linkInviteSubtitle, { color: colors.textSecondary }]}>
                    Escolha a permissão e envie um convite por link. Quando a pessoa criar a conta com esse email, ela entra na equipe automaticamente.
                  </Text>

                  <View style={styles.linkInviteRoleRow}>
                    {COLLABORATOR_ROLES_FOR_PICKER.map((role) => {
                      const isSel = linkInviteRole === role.value;
                      return (
                        <TouchableOpacity
                          key={role.value}
                          style={[
                            styles.linkInviteRoleChip,
                            { borderColor: colors.border },
                            isSel && { backgroundColor: colors.primary + '15', borderColor: colors.primary },
                          ]}
                          onPress={() => setLinkInviteRole(role.value)}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={[
                              styles.linkInviteRoleChipText,
                              { color: colors.text },
                              isSel && { color: colors.primary, fontWeight: '700' },
                            ]}
                          >
                            {role.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={[styles.linkInviteButton, { backgroundColor: colors.primary }]}
                    onPress={handleInviteByLink}
                    disabled={isInvitingByLink}
                    activeOpacity={0.85}
                  >
                    {isInvitingByLink ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="link-outline" size={18} color="#fff" />
                        <Text style={styles.linkInviteButtonText}>Convidar por link</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal de confirmação de convite */}
      <Modal
        visible={showInviteModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }] }>
          <View style={[styles.modalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }] }>
            <TouchableOpacity 
              onPress={() => setShowInviteModal(false)}
              style={styles.modalCloseButton}
            >
              <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>Cancelar</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Enviar Convite</Text>
            <TouchableOpacity 
              onPress={handleConfirmInvite}
              style={styles.modalSaveButton}
              disabled={isInviting}
            >
              {isInviting ? (
                <ActivityIndicator size="small" color="#667eea" />
              ) : (
                <Text style={[styles.modalSaveText, { color: colors.primary }]}>Enviar</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={[styles.modalContent, { backgroundColor: colors.background }] }>
            <View style={styles.permissionSelection}>
              <Text style={[styles.permissionTitle, { color: colors.text }]}>Enviar Convite de Colaboração</Text>
              
              <Text style={[styles.permissionDescription, { color: colors.textSecondary }] }>
                Toque para escolher. Os detalhes de permissões aparecem só na opção selecionada.
              </Text>
              
              {selectedUser && (
                <View style={[styles.permissionUserCard, { backgroundColor: colors.surface, borderColor: colors.border }] }>
                  <OptimizedImage
                    imageUrl={selectedUser.profile_url || ''}
                    style={styles.permissionUserAvatar}
                    cacheKey={`permission_${selectedUser.id}`}
                    fallbackText={selectedUser.name || 'Usuário'}
                    fallbackIcon="person"
                    fallbackIconSize={24}
                    fallbackIconColor="#FFFFFF"
                  />
                  <View style={styles.permissionUserInfo}>
                    <Text style={[styles.permissionUserName, { color: colors.text }]}>{selectedUser.name}</Text>
                    <View style={styles.permissionUserLocationRow}>
                      <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.permissionUserEmail, { color: colors.textSecondary, flex: 1 }]}>
                        {formatBuscaColaboradorLocalizacao(selectedUser)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
              
              <Text style={[styles.permissionDetails, { color: colors.textSecondary }]}>
                <Text style={[styles.permissionDetailsLabel, { color: colors.primary }]}>Artista:</Text> {activeArtist?.name}
              </Text>
              
              <View style={styles.permissionOptions}>
                {COLLABORATOR_ROLES_FOR_PICKER.map((role) => {
                  const isSel = newCollaboratorRole === role.value;
                  return (
                    <TouchableOpacity
                      key={role.value}
                      style={[
                        styles.permissionOption,
                        isSel ? styles.permissionOptionExpanded : styles.permissionOptionCollapsed,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                        isSel && [styles.permissionOptionSelected, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]
                      ]}
                      onPress={() => setNewCollaboratorRole(role.value)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.permissionOptionContent}>
                        <Text style={[
                          styles.permissionOptionLabel,
                          { color: colors.text },
                          isSel && [styles.permissionOptionLabelSelected, { color: colors.primary }]
                        ]}>
                          {role.label}
                        </Text>
                        <Text
                          style={[
                            styles.permissionOptionDescription,
                            { color: colors.textSecondary },
                            isSel && styles.permissionOptionDescriptionSelected,
                            !isSel && styles.permissionOptionDescriptionOneLine,
                          ]}
                          numberOfLines={isSel ? undefined : 2}
                        >
                          {role.summary}
                        </Text>
                        {isSel ? (
                          <>
                            <Text style={[styles.permissionPowersHeading, { color: colors.textSecondary }]}>
                              Pode
                            </Text>
                            {role.powers.map((line) => (
                              <View key={line} style={styles.permissionPowerRow}>
                                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                                <Text style={[styles.permissionPowerText, { color: colors.text }]}>{line}</Text>
                              </View>
                            ))}
                            {role.limitations?.length ? (
                              <>
                                <Text style={[styles.permissionPowersHeading, { color: colors.textSecondary, marginTop: 6 }]}>
                                  Não pode
                                </Text>
                                {role.limitations.map((line) => (
                                  <View key={line} style={styles.permissionPowerRow}>
                                    <Ionicons name="close-circle" size={14} color={colors.warning ?? '#f59e0b'} />
                                    <Text style={[styles.permissionPowerText, { color: colors.textSecondary }]}>{line}</Text>
                                  </View>
                                ))}
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </View>
                      <View style={[
                        styles.permissionRadio,
                        { borderColor: colors.border },
                        isSel && [styles.permissionRadioSelected, { borderColor: colors.primary }]
                      ]}>
                        {isSel && (
                          <View style={[styles.permissionRadioInner, { backgroundColor: colors.primary }]} />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              
              <View style={[styles.permissionWarning, { backgroundColor: colors.secondary, borderColor: colors.border }] }>
                <Ionicons name="information-circle" size={18} color="#ff9800" />
                <Text style={[styles.permissionWarningText, { color: colors.textSecondary }] }>
                  A pessoa recebe uma notificação e pode aceitar ou recusar.
                </Text>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal de Alteração de Permissão */}
      <Modal
        visible={showRoleModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRoleModal(false)}
      >
        <SafeAreaView style={[styles.roleModalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.roleModalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShowRoleModal(false)}
              style={styles.modalCloseButton}
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.roleModalTitle, { color: colors.text }]}>Alterar Permissão</Text>
            <TouchableOpacity
              onPress={handleConfirmRoleUpdate}
              style={styles.modalSaveButton}
              disabled={isUpdatingRole}
            >
              {isUpdatingRole ? (
                <ActivityIndicator size="small" color="#667eea" />
              ) : (
                <Ionicons name="checkmark" size={24} color="#667eea" />
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={[styles.roleModalContent, { backgroundColor: colors.background }]}>
            {/* Card do Colaborador */}
            {selectedCollaborator && (
              <View style={[styles.selectedCollaboratorCard, { backgroundColor: colors.surface }]}>
                <View style={styles.selectedCollaboratorHeader}>
                  <OptimizedImage
                    imageUrl={selectedCollaborator.user.profile_url || ''}
                    style={styles.selectedCollaboratorAvatar}
                    cacheKey={`selected_${selectedCollaborator.user_id}`}
                    fallbackText={selectedCollaborator.user.name || 'Usuário'}
                    fallbackIcon="person"
                    fallbackIconSize={28}
                    fallbackIconColor="#FFFFFF"
                  />
                  <View style={styles.selectedCollaboratorInfo}>
                    <Text style={[styles.selectedCollaboratorName, { color: colors.text }]}>
                      {selectedCollaborator.user.name}
                    </Text>
                    <Text style={[styles.selectedCollaboratorEmail, { color: colors.textSecondary }]}>
                      {selectedCollaborator.user.email}
                    </Text>
                  </View>
                </View>

                <View style={[styles.currentRoleBadge, { backgroundColor: colors.background }]}>
                  <Ionicons
                    name={getRoleIcon(selectedCollaborator.role) as any}
                    size={16}
                    color={getRoleColor(selectedCollaborator.role)}
                  />
                  <Text style={[styles.currentRoleText, { color: getRoleColor(selectedCollaborator.role) }]}>
                    Atual: {getRoleLabel(selectedCollaborator.role)}
                  </Text>
                </View>
              </View>
            )}

            {/* Título de Seleção */}
            <View style={[styles.roleSelectionHeader, { borderBottomColor: colors.border }]}>
              <Ionicons name="shield-checkmark" size={24} color="#667eea" />
              <Text style={[styles.roleSelectionTitle, { color: colors.text }]}>Nova permissão</Text>
            </View>

            {/* Opções de Role */}
            <View style={styles.roleOptionsContainer}>
              {COLLABORATOR_ROLES_FOR_PICKER.map((role) => {
                const roleSel = selectedRole === role.value;
                return (
                  <TouchableOpacity
                    key={role.value}
                    style={[
                      styles.roleOptionCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                      roleSel ? styles.roleOptionCardExpanded : styles.roleOptionCardCollapsed,
                      roleSel && styles.roleOptionCardSelected,
                      roleSel && { backgroundColor: role.modalColor + '15', borderColor: role.modalColor }
                    ]}
                    onPress={() => setSelectedRole(role.value)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.roleOptionHeader, !roleSel && styles.roleOptionHeaderCompact]}>
                      <View style={[styles.roleIconCircle, { backgroundColor: role.modalColor + '20' }, roleSel ? null : styles.roleIconCircleSmall]}>
                        <Ionicons name={role.modalIcon} size={roleSel ? 22 : 18} color={role.modalColor} />
                      </View>
                      <View style={styles.roleLabelContainer}>
                        <Text style={[
                          styles.roleOptionLabel,
                          { color: colors.text },
                          roleSel && styles.roleOptionLabelSelected
                        ]}>
                          {role.label}
                        </Text>
                        <Text
                          style={[
                            styles.roleOptionDescription,
                            { color: colors.textSecondary },
                            roleSel && styles.roleOptionDescriptionSelected,
                          ]}
                          numberOfLines={roleSel ? undefined : 2}
                        >
                          {role.summary}
                        </Text>
                      </View>
                      <View style={[
                        styles.roleRadio,
                        { borderColor: colors.border },
                        roleSel && styles.roleRadioSelected
                      ]}>
                        {roleSel && (
                          <View style={[styles.roleRadioInner, { backgroundColor: role.modalColor }]} />
                        )}
                      </View>
                    </View>

                    {roleSel ? (
                      <>
                        <Text style={[styles.rolePowersSectionTitle, { color: colors.textSecondary }]}>Pode</Text>
                        <View style={styles.roleFeaturesList}>
                          {role.powers.map((feature) => (
                            <View key={feature} style={styles.roleFeatureItem}>
                              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                              <Text style={[
                                styles.roleFeatureText,
                                { color: role.modalColor }
                              ]}>
                                {feature}
                              </Text>
                            </View>
                          ))}
                        </View>
                        {role.limitations?.length ? (
                          <>
                            <Text style={[styles.rolePowersSectionTitle, { color: colors.textSecondary, marginTop: 6 }]}>Não pode</Text>
                            <View style={styles.roleFeaturesList}>
                              {role.limitations.map((line) => (
                                <View key={line} style={styles.roleFeatureItem}>
                                  <Ionicons name="close-circle" size={14} color="#F59E0B" />
                                  <Text style={[styles.roleFeatureText, { color: colors.textSecondary }]}>
                                    {line}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Warning */}
            <View style={styles.roleWarning}>
              <Ionicons name="warning" size={20} color="#F59E0B" />
              <Text style={styles.roleWarningText}>
                A alteração vale na hora; a pessoa é avisada.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal de Convite Pendente */}
      <Modal
        visible={showPendingInviteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPendingInviteModal(false)}
      >
        <View style={styles.inviteSentOverlay}>
          <View style={[styles.inviteSentContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Header */}
            <View style={styles.inviteSentHeader}>
              <Ionicons name="time" size={48} color={colors.warning} />
              <Text style={[styles.inviteSentTitle, { color: colors.text }]}>Convite Já Enviado</Text>
            </View>

            {/* Informações do convite */}
            {pendingInviteData && (
              <View style={styles.pendingInviteContent}>
                <Text style={[styles.pendingInviteUserName, { color: colors.text }]}>
                  {pendingInviteData.userName}
                </Text>
                
                <View style={[styles.pendingInviteInfoRow, { borderBottomColor: colors.border }]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
                  <Text style={[styles.pendingInviteLabel, { color: colors.textSecondary }]}>Permissão: </Text>
                  <Text style={[styles.pendingInviteValue, { color: colors.text }]}>{pendingInviteData.role}</Text>
                </View>

                <View style={styles.pendingInviteInfoRow}>
                  <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                  <Text style={[styles.pendingInviteLabel, { color: colors.textSecondary }]}>Enviado em: </Text>
                  <Text style={[styles.pendingInviteValue, { color: colors.text }]}>{pendingInviteData.createdAt}</Text>
                </View>
              </View>
            )}

            {/* Botões */}
            <View style={styles.pendingInviteActions}>
              <TouchableOpacity
                style={[styles.pendingInviteCancelButton, { borderColor: colors.border }]}
                onPress={() => {
                  setShowPendingInviteModal(false);
                  setPendingInviteData(null);
                  setSelectedUser(null);
                  setExistingInviteIdToDelete(null);
                }}
              >
                <Text style={[styles.pendingInviteCancelText, { color: colors.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pendingInviteResendButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setShowPendingInviteModal(false);
                  setSearchResults([]);
                  setSearchTerm(pendingInviteData?.userName || '');
                  setShowAddModal(false);
                  setTimeout(() => {
                    setShowInviteModal(true);
                  }, 100);
                }}
              >
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.pendingInviteResendText}>Reenviar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de Convite Enviado (layout simples) */}
      <Modal
        visible={showInviteSentModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteSentModal(false)}
      >
        <View style={styles.inviteSentOverlay}>
          <View
            style={[
              styles.inviteSentContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.inviteSentIconWrap, { backgroundColor: colors.primary + '22' }]}>
              <Ionicons name="checkmark" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.inviteSentTitle, { color: colors.text }]}>Convite enviado</Text>
            <Text style={[styles.inviteSentSubtitle, { color: colors.textSecondary }]}>
              A pessoa recebe um aviso no app e pode aceitar ou recusar.
            </Text>

            {inviteSentData && (
              <View
                style={[
                  styles.inviteSentUserRow,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <OptimizedImage
                  imageUrl={inviteSentData.userImage}
                  style={[styles.inviteSentAvatar, { borderColor: colors.border }]}
                  cacheKey={`invited_${inviteSentData.userEmail}`}
                  fallbackText={inviteSentData.userName || 'Usuário'}
                  fallbackIcon="person"
                  fallbackIconSize={26}
                  fallbackIconColor={colors.primary}
                />
                <View style={styles.inviteSentUserMeta}>
                  <Text style={[styles.inviteSentUserName, { color: colors.text }]} numberOfLines={1}>
                    {inviteSentData.userName}
                  </Text>
                  <Text style={[styles.inviteSentUserEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                    {inviteSentData.userEmail}
                  </Text>
                  <View
                    style={[
                      styles.inviteSentRolePill,
                      { backgroundColor: getRoleColor(inviteSentData.role) + '18' },
                    ]}
                  >
                    <Ionicons
                      name={getRoleIcon(inviteSentData.role) as any}
                      size={14}
                      color={getRoleColor(inviteSentData.role)}
                    />
                    <Text style={[styles.inviteSentRoleText, { color: getRoleColor(inviteSentData.role) }]}>
                      {getRoleLabel(inviteSentData.role)}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.inviteSentButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowInviteSentModal(false)}
            >
              <Text style={styles.inviteSentButtonText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginRight: 8,
  },
  addButton: {
    padding: 8,
  },
  placeholder: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  content: {
    flex: 1,
  },
  artistInfo: {
    backgroundColor: '#fff',
    margin: 20,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  artistName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  collaboratorCount: {
    fontSize: 14,
    color: '#666',
  },
  collaboratorsList: {
    paddingHorizontal: 20,
  },
  collaboratorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  collaboratorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  collaboratorAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  collaboratorDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  collaboratorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  youBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  youBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  collaboratorEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  collaboratorActions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  modalHeader: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 70,
  },
  modalCloseButton: {
    padding: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalHeaderSpacer: {
    width: 60, // Espaço para manter o layout centralizado
  },
  disabledButtonText: {
    color: '#ccc',
  },
  disabledButton: {
    opacity: 0.5,
  },
  modalSaveButton: {
    padding: 8,
  },
  modalCloseText: {
    fontSize: 16,
    color: '#666',
  },
  modalSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#667eea',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  collaboratorSearchHint: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
    marginTop: 2,
  },
  collaboratorSearchResultsList: {
    marginTop: 12,
    gap: 12,
  },
  collaboratorInviteCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  collaboratorInviteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  collaboratorInviteLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 2,
  },
  collaboratorInviteCardAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    overflow: 'hidden',
  },
  collaboratorInviteCardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  collaboratorInviteCardName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  collaboratorInviteCardEmail: {
    fontSize: 13,
  },
  collaboratorInviteArtistTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  collaboratorInviteRolesBlock: {
    marginBottom: 8,
  },
  collaboratorInviteSectionLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  collaboratorInviteChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  collaboratorInviteChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: '100%',
  },
  collaboratorInviteChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  collaboratorInviteMuted: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  collaboratorInviteMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
  },
  collaboratorInviteMetaText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    overflow: 'hidden',
  },
  userAvatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 14,
    color: '#666',
  },
  searchLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  searchLoadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#666',
  },
  noResultsText: {
    textAlign: 'center',
    padding: 16,
    fontSize: 14,
    color: '#999',
  },
  linkInviteCard: {
    marginTop: 8,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  linkInviteTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  linkInviteSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  linkInviteRoleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  linkInviteRoleChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkInviteRoleChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  linkInviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
  },
  linkInviteButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  roleOptions: {
    gap: 12,
  },
  roleOption: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleOptionSelected: {
    borderColor: '#667eea',
    backgroundColor: '#f8f9ff',
  },
  roleOptionContent: {
    flex: 1,
  },
  roleOptionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  roleOptionLabelSelected: {
    color: '#667eea',
  },
  roleOptionDescription: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },
  roleOptionDescriptionSelected: {
    color: '#667eea',
  },
  roleRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  roleRadioSelected: {
    borderColor: '#667eea',
  },
  roleRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#667eea',
  },
  inviteConfirmation: {
    alignItems: 'center',
    padding: 20,
  },
  inviteIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  inviteTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  inviteDescription: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  inviteUserCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
    width: '100%',
  },
  inviteUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  inviteUserAvatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  inviteUserInfo: {
    flex: 1,
  },
  inviteUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  inviteUserEmail: {
    fontSize: 14,
    color: '#666',
  },
  inviteDetails: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    alignSelf: 'flex-start',
    width: '100%',
  },
  inviteDetailsLabel: {
    fontWeight: '600',
    color: '#667eea',
  },
  inviteMessage: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 16,
    marginTop: 20,
    width: '100%',
  },
  inviteMessageTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  inviteMessageText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  inviteWarning: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
  },
  inviteWarningText: {
    fontSize: 14,
    color: '#856404',
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  permissionSelection: {
    alignItems: 'center',
    padding: 20,
  },
  permissionIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
    textAlign: 'left',
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  permissionUserCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
    width: '100%',
  },
  permissionUserAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  permissionUserAvatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  permissionUserInfo: {
    flex: 1,
  },
  permissionUserName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  permissionUserEmail: {
    fontSize: 13,
    color: '#666',
  },
  permissionUserLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  permissionDetails: {
    fontSize: 13,
    color: '#333',
    marginBottom: 10,
    alignSelf: 'flex-start',
    width: '100%',
  },
  permissionDetailsLabel: {
    fontWeight: '600',
    color: '#667eea',
  },
  permissionOptions: {
    width: '100%',
    gap: 8,
    marginBottom: 14,
  },
  permissionOption: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e9ecef',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  permissionOptionCollapsed: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  permissionOptionExpanded: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
  },
  permissionOptionSelected: {
    borderColor: '#667eea',
    backgroundColor: '#f8f9ff',
  },
  permissionOptionContent: {
    flex: 1,
    minWidth: 0,
  },
  permissionOptionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  permissionOptionLabelSelected: {
    color: '#667eea',
  },
  permissionOptionDescription: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
    marginBottom: 0,
  },
  permissionOptionDescriptionOneLine: {
    marginBottom: 0,
  },
  permissionOptionDescriptionSelected: {
    color: '#667eea',
  },
  permissionPowersHeading: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 3,
    letterSpacing: 0.2,
  },
  permissionPowerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 3,
    paddingRight: 2,
  },
  permissionPowerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  permissionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    alignSelf: 'center',
  },
  permissionRadioSelected: {
    borderColor: '#667eea',
  },
  permissionRadioInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  permissionWarning: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  permissionWarningText: {
    fontSize: 12,
    color: '#856404',
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  roleModalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  roleModalHeader: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  roleModalContent: {
    flex: 1,
    padding: 20,
  },
  selectedCollaboratorCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  selectedCollaboratorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  selectedCollaboratorAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    overflow: 'hidden',
  },
  selectedCollaboratorAvatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  selectedCollaboratorInfo: {
    flex: 1,
  },
  selectedCollaboratorName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  selectedCollaboratorEmail: {
    fontSize: 14,
    color: '#666',
  },
  currentRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  currentRoleText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  roleSelectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#e9ecef',
  },
  roleSelectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 12,
    flex: 1,
  },
  roleOptionsContainer: {
    gap: 8,
    marginBottom: 16,
  },
  roleOptionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.04,
    shadowRadius: Platform.OS === 'android' ? 0 : 4,
    elevation: Platform.OS === 'android' ? 0 : 2,
  },
  roleOptionCardCollapsed: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  roleOptionCardExpanded: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  roleOptionCardSelected: {
    borderColor: '#667eea',
    borderWidth: 2,
    backgroundColor: '#f8f9ff',
    shadowColor: '#667eea',
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.12,
  },
  roleOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  roleOptionHeaderCompact: {
    marginBottom: 0,
  },
  roleIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  roleIconCircleSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  roleLabelContainer: {
    flex: 1,
  },
  rolePowersSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 4,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  roleFeaturesList: {
    gap: 4,
    paddingLeft: 4,
  },
  roleFeatureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  roleFeatureText: {
    fontSize: 12,
    color: '#666',
    flex: 1,
    lineHeight: 16,
  },
  roleWarning: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  roleWarningText: {
    fontSize: 14,
    color: '#92400E',
    marginLeft: 12,
    flex: 1,
    lineHeight: 20,
  },
  // Modal de Convite Enviado (simplificado)
  inviteSentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inviteSentContainer: {
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
    }),
  },
  inviteSentIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  inviteSentTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  inviteSentSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  inviteSentUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 18,
    gap: 12,
  },
  inviteSentAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
  },
  inviteSentUserMeta: {
    flex: 1,
    minWidth: 0,
  },
  inviteSentUserName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  inviteSentUserEmail: {
    fontSize: 13,
    marginBottom: 8,
  },
  inviteSentRolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  inviteSentRoleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pendingInviteActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  pendingInviteCancelButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingInviteCancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pendingInviteResendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  pendingInviteResendText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  pendingInviteContent: {
    marginVertical: 20,
  },
  pendingInviteUserName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  pendingInviteInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  pendingInviteLabel: {
    fontSize: 14,
  },
  pendingInviteValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  inviteSentButton: {
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  inviteSentButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  planLimitBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  planLimitBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
  planLimitBannerBtn: {
    alignSelf: 'flex-start',
  },
  planLimitBannerBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
