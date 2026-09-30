import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PermissionModal from "../components/PermissionModal";
import { useActiveArtistContext } from "../contexts/ActiveArtistContext";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { setAppIconBadge } from "../services/appIconBadge";
import {
    acceptArtistInvite,
    declineArtistInvite,
} from "../services/supabase/artistInviteService";
import { getArtists } from "../services/supabase/artistService";
import { getCurrentUser } from "../services/supabase/authService";
import { listarConvitesPendentesRecebidos } from "../services/supabase/conviteParticipacaoEventoService";
import { getEventById } from "../services/supabase/eventService";
import {
    deleteNotification,
    getUserNotifications,
    markAllNotificationsAsRead,
    markNotificationAsRead,
    Notification,
    updateNotificationStatus,
} from "../services/supabase/notificationService";
import { useNotifications } from "../services/useNotifications";

type NotificationWithInvite = Notification & {
  isInvitePending?: boolean;
};

/** Evento removido/cancelado na agenda — só informativo; não abrir detalhes (evento pode não existir). */
function isEventNotificationInformativeOnly(n: Notification): boolean {
  if (n.type !== "event") return false;
  const title = (n.title || "").toLowerCase();
  const msg = (n.message || "").toLowerCase();
  return (
    title.includes("deletad") ||
    title.includes("cancelad") ||
    msg.includes("foi deletad") ||
    msg.includes("cancelou a participação") ||
    msg.includes("convite cancelado")
  );
}

/** Notificação de participação recusada: só informativa, sem navegação. */
function isParticipationRejectedNotification(n: Notification): boolean {
  if (n.type !== "participacao_evento") return false;
  const title = (n.title || "").toLowerCase();
  const msg = (n.message || "").toLowerCase();
  return (
    title.includes("recusad") ||
    title.includes("recusa") ||
    msg.includes("recusad") ||
    msg.includes("recusa")
  );
}

/** Participação cancelada pelo convidado (aceita cancelada): só marca como lida; não abre a tela de convites. */
function isParticipationCanceledByGuestNotification(n: Notification): boolean {
  if (n.type !== "participacao_evento") return false;
  const title = (n.title || "").toLowerCase();
  const msg = (n.message || "").toLowerCase();
  return (
    title.includes("participação cancelada") ||
    title.includes("cancelada pelo convidado") ||
    msg.includes("cancelou a participação")
  );
}

/** Participação removida pelo organizador (lado do convidado): informativo; não abre a tela de convites. */
function isParticipationRemovedByHostNotification(n: Notification): boolean {
  if (n.type !== "participacao_evento") return false;
  const title = (n.title || "").toLowerCase();
  return title.includes("removida pelo organizador");
}

/** Convite pendente que virou histórico (cancelado, leilão, aceito): não abrir fluxo de aceite. */
function isParticipationInviteFinalizedNotification(n: Notification): boolean {
  if (n.type !== "participacao_evento") return false;
  const title = (n.title || "").toLowerCase();
  return (
    title.includes("convite de participação cancelado") ||
    title.includes("convite de participação encerrado") ||
    title.includes("convite de participação aceito")
  );
}

/** Nome do perfil (artista) em `artist_id`; compatível com retorno do PostgREST. */
function getNotificationArtistProfileName(
  notification: Notification,
): string | null {
  const a = notification.artist as
    | { id?: string; name?: string }
    | { id?: string; name?: string }[]
    | undefined;
  if (!a) return null;
  if (Array.isArray(a)) {
    const first = a[0];
    const n = first?.name?.trim();
    return n || null;
  }
  const n = typeof a.name === "string" ? a.name.trim() : "";
  return n || null;
}

/** Convites antigos sem texto "Perfil convidado:" na mensagem — mostra linha extra no app. */
function shouldShowParticipationProfileHint(
  notification: Notification,
): boolean {
  if (notification.type !== "participacao_evento") return false;
  if (!getNotificationArtistProfileName(notification)) return false;
  if ((notification.message || "").includes("Perfil convidado:")) return false;
  return true;
}

export default function NotificacoesScreen() {
  const { colors, isDarkMode } = useTheme();
  const { loadUnreadCount } = useNotifications(); // ✅ Hook para atualizar badge
  const { activeArtist, setActiveArtist } = useActiveArtistContext(); // ✅ Context para atualizar artista ativo
  const [notifications, setNotifications] = useState<NotificationWithInvite[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPendingParticipationInvite, setHasPendingParticipationInvite] =
    useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showAcceptedModal, setShowAcceptedModal] = useState(false);
  const [acceptedInviteData, setAcceptedInviteData] = useState<{
    artistName: string;
    role: string;
    isFirstArtist: boolean;
  } | null>(null);

  useEffect(() => {
    loadNotifications();
    setupRealtimeSubscription();

    return () => {
      cleanupSubscription();
    };
  }, [activeArtist?.id]);

  // Subscription em tempo real para notificações
  const subscriptionRef = React.useRef<any>(null);
  const participationSubscriptionRef = React.useRef<any>(null);

  const setupRealtimeSubscription = async () => {
    try {
      const { user } = await getCurrentUser();
      if (!user) return;

      // Limpar subscription anterior se existir
      if (subscriptionRef.current) {
        await supabase.removeChannel(subscriptionRef.current);
      }

      // Criar subscription para mudanças nas notificações (centralizado na tabela notifications)
      const channel = supabase
        .channel("notifications-realtime")
        .on(
          "postgres_changes",
          {
            event: "*", // INSERT, UPDATE, DELETE
            schema: "public",
            table: "notifications",
            filter: `to_user_id=eq.${user.id}`,
          },
          () => {
            loadNotifications();
            loadUnreadCount();
          },
        )
        .subscribe();

      subscriptionRef.current = channel;

      if (participationSubscriptionRef.current) {
        await supabase.removeChannel(participationSubscriptionRef.current);
      }

      if (activeArtist?.id) {
        const participationChannel = supabase
          .channel(`convite-participacao-notifications:${activeArtist.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "convite_participacao_evento",
              filter: `artista_convidado_id=eq.${activeArtist.id}`,
            },
            () => {
              loadNotifications();
            },
          )
          .subscribe();

        participationSubscriptionRef.current = participationChannel;
      }
    } catch (error) {
      // Erro ao configurar realtime
    }
  };

  const cleanupSubscription = async () => {
    if (subscriptionRef.current) {
      await supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }
    if (participationSubscriptionRef.current) {
      await supabase.removeChannel(participationSubscriptionRef.current);
      participationSubscriptionRef.current = null;
    }
  };

  const loadNotifications = async () => {
    try {
      setIsLoading(true);

      const { user, error: userError } = await getCurrentUser();

      if (userError || !user) {
        Alert.alert("Erro", "Usuário não encontrado. Faça login novamente.");
        return;
      }

      setCurrentUserId(user.id);

      // Carregar notificações
      const { notifications: fetchedNotifications, error } =
        await getUserNotifications(user.id);

      if (error) {
        Alert.alert("Erro", "Erro ao carregar notificações");
        return;
      }

      // Tudo está centralizado na tabela notifications agora
      // Notificações do tipo 'invite' com status == 'pending' são consideradas pendentes
      let enhancedNotifications: NotificationWithInvite[] = (
        fetchedNotifications || []
      ).map((notification) => {
        if (
          notification.type === "invite" &&
          notification.status === "pending"
        ) {
          return { ...notification, isInvitePending: true };
        }
        return notification;
      });

      let syntheticParticipationCard: NotificationWithInvite | null = null;
      if (activeArtist?.id) {
        const { convites: pendingParticipationInvites } =
          await listarConvitesPendentesRecebidos(activeArtist.id);
        const hasPending = (pendingParticipationInvites?.length || 0) > 0;
        setHasPendingParticipationInvite(hasPending);

        const hasRealUnreadParticipationNotification =
          enhancedNotifications.some(
            (n) =>
              n.type === "participacao_evento" &&
              !n.read &&
              n.to_user_id === user.id,
          );

        if (hasPending && !hasRealUnreadParticipationNotification) {
          const newest = pendingParticipationInvites?.[0];
          syntheticParticipationCard = {
            id: `convite_participacao_pendente_${activeArtist.id}`,
            to_user_id: user.id,
            from_user_id: undefined,
            artist_id: activeArtist.id,
            event_id: undefined,
            title: "Convite de participação em evento",
            message: `Convite pendente para o perfil "${activeArtist.name}". Toque para revisar e responder.`,
            type: "participacao_evento",
            read: false,
            created_at: newest?.criado_em || new Date().toISOString(),
            artist: { id: activeArtist.id, name: activeArtist.name },
          } as NotificationWithInvite;
        }
      } else {
        setHasPendingParticipationInvite(false);
      }

      if (syntheticParticipationCard) {
        enhancedNotifications = [
          syntheticParticipationCard,
          ...enhancedNotifications,
        ];
      }

      setNotifications(enhancedNotifications);

      // Contar notificações não lidas e somar +1 para o card sintético de participação
      const unreadNotifications = (enhancedNotifications || []).filter(
        (n) => !n.read && n.to_user_id === user.id,
      ).length;
      setUnreadCount(unreadNotifications);
      await setAppIconBadge(unreadNotifications);
    } catch (error) {
      Alert.alert("Erro", "Erro ao carregar notificações");
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  };

  const handleNotificationPress = async (notification: Notification) => {
    const isSyntheticParticipationCard = notification.id.startsWith(
      "convite_participacao_pendente_",
    );

    if (isSyntheticParticipationCard) {
      setHasPendingParticipationInvite(false);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await loadUnreadCount();
      router.push("/convites-participacao-evento");
      return;
    }

    // Marcar como lida se não estiver lida
    if (!notification.read) {
      const { success } = await markNotificationAsRead(notification.id);

      if (success) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, read: true } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        await loadUnreadCount();
      }
    }

    // Convite de participação: abrir tela de convites só para convite propriamente (ex.: "Convite de participação em evento").
    // Avisos informativos (recusa, cancelamento pelo convidado): apenas marcar como lida acima.
    if (notification.type === "participacao_evento") {
      if (
        !isParticipationRejectedNotification(notification) &&
        !isParticipationCanceledByGuestNotification(notification) &&
        !isParticipationRemovedByHostNotification(notification) &&
        !isParticipationInviteFinalizedNotification(notification)
      ) {
        router.push("/convites-participacao-evento");
      }
      return;
    }

    // Evento deletado/cancelado ou aviso de cancelamento: só informativo
    if (isEventNotificationInformativeOnly(notification)) {
      return;
    }

    try {
      switch (notification.type) {
        case "basic":
          return;
        case "invite":
          router.push("/convites-recebidos");
          break;
        case "update":
        case "delete":
          router.push("/colaboradores-artista");
          break;
        case "event":
          if (notification.event_id) {
            await handleEventNotificationPress(notification.event_id);
          } else {
            router.push("/(tabs)/agenda");
          }
          break;
        default:
          router.push("/(tabs)/agenda");
          break;
      }
    } catch {
      Alert.alert("Erro", "Erro ao abrir notificação. Tente novamente.");
    }
  };

  const handleEventNotificationPress = async (eventId: string) => {
    try {
      // Se não temos usuário logado, navegar para agenda
      if (!currentUserId) {
        router.push("/(tabs)/agenda");
        return;
      }

      // Buscar o evento para obter o artist_id
      const eventResult = await getEventById(eventId);

      if (!eventResult.success || !eventResult.event) {
        Alert.alert("Erro", "Evento não encontrado");
        return;
      }

      // Admin vê qualquer evento; vendedor vê apenas o que criou.
      const { data: membership } = await supabase
        .from("artist_members")
        .select("role")
        .eq("user_id", currentUserId)
        .eq("artist_id", eventResult.event.artist_id)
        .maybeSingle();
      const canViewDetails =
        membership?.role === "admin" ||
        (membership?.role === "vendedor" &&
          eventResult.event.created_by === currentUserId);

      if (!canViewDetails) {
        setShowPermissionModal(true);
        return;
      }

      // Se tem permissão, navegar para os detalhes do evento
      router.push({
        pathname: "/detalhes-evento",
        params: { eventId: eventId },
      });
    } catch (error) {
      Alert.alert(
        "Erro",
        "Erro ao verificar permissões. Redirecionando para a agenda.",
      );
      router.push("/(tabs)/agenda");
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const { user } = await getCurrentUser();
      if (!user) return;

      // Marcar todas as notificações como lidas
      const { success, error } = await markAllNotificationsAsRead(user.id);

      if (success) {
        // Atualizar estado local APENAS se teve sucesso no banco
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

        setUnreadCount(0);

        // ✅ Atualizar badge de notificações
        await loadUnreadCount();
      } else {
        Alert.alert("Erro", error || "Erro ao marcar notificações como lidas");
      }
    } catch (error) {
      Alert.alert("Erro", "Erro inesperado ao marcar notificações");
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    Alert.alert(
      "Deletar Notificação",
      "Tem certeza que deseja deletar esta notificação?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Deletar",
          style: "destructive",
          onPress: async () => {
            try {
              const { success, error } =
                await deleteNotification(notificationId);

              if (success) {
                // Verificar se a notificação deletada era não lida
                const deletedNotification = notifications.find(
                  (n) => n.id === notificationId,
                );
                const wasUnread =
                  deletedNotification && !deletedNotification.read;

                setNotifications((prev) =>
                  prev.filter((n) => n.id !== notificationId),
                );

                // Decrementar contador apenas se a notificação era não lida
                if (wasUnread) {
                  setUnreadCount((prev) => Math.max(0, prev - 1));
                  // ✅ Atualizar badge de notificações
                  await loadUnreadCount();
                }
              } else {
                Alert.alert("Erro", "Erro ao deletar notificação");
              }
            } catch (error) {
              // Erro ao deletar notificação
            }
          },
        },
      ],
    );
  };

  const handleAcceptInviteFromNotification = async (
    artistId: string,
    artistName: string,
    notificationId: string,
    notificationRole?: string,
  ) => {
    if (!currentUserId) return;

    try {
      // Buscar a notificação para verificar se ainda está pendente (status == 'pending')
      const { data: notification, error: notificationError } = await supabase
        .from("notifications")
        .select("id, read, role, status")
        .eq("id", notificationId)
        .eq("to_user_id", currentUserId)
        .eq("type", "invite")
        .eq("artist_id", artistId)
        .single();

      if (
        notificationError ||
        !notification ||
        notification.status !== "pending"
      ) {
        Alert.alert("Erro", "Convite não encontrado ou já foi processado");
        await loadNotifications(); // Recarregar para atualizar
        return;
      }

      const inviteRole = notificationRole || notification.role || "viewer"; // ✅ Role vem da notificação

      // Verificar ANTES de aceitar se o usuário já tem artistas
      const { artists: artistsBefore } = await getArtists(currentUserId);
      const isFirstArtist = !artistsBefore || artistsBefore.length === 0;

      // Aceitar convite diretamente usando a notificação (sem buscar em artist_invites)
      // O backend deve processar isso através da notificação
      const { success, error } = await acceptArtistInvite(
        notificationId,
        currentUserId,
      );

      if (success) {
        // Atualizar notificação: read = true e status = 'accepted'
        await updateNotificationStatus(notificationId, "accepted");

        // Recarregar notificações
        await loadNotifications();

        // ✅ Atualizar badge de notificações
        await loadUnreadCount();

        if (isFirstArtist) {
          // Se é o primeiro artista, setar automaticamente como ativo (Context API)
          await setActiveArtist({
            id: artistId,
            name: artistName,
            role: inviteRole, // ✅ Role do convite
          });

          // Mostrar alerta simples e redirecionar
          Alert.alert(
            "✅ Convite Aceito!",
            `Você agora faz parte do artista "${artistName}" e este foi definido como seu artista ativo.`,
            [
              {
                text: "OK",
                onPress: () => {
                  // Redirecionar para agenda
                  router.replace("/(tabs)/agenda");
                },
              },
            ],
          );
        } else {
          // Apenas mostrar alerta
          Alert.alert(
            "✅ Convite Aceito!",
            `Você foi adicionado ao artista "${artistName}". Para trabalhar com ele, troque nas Configurações → Selecionar Artista.`,
            [{ text: "OK" }],
          );
        }
      } else {
        Alert.alert("Erro", error || "Erro ao aceitar convite");
      }
    } catch (error) {
      Alert.alert("Erro", "Erro ao aceitar convite");
    }
  };

  const handleDeclineInviteFromNotification = async (
    artistId: string,
    notificationId: string,
  ) => {
    if (!currentUserId) return;

    try {
      // Buscar a notificação para verificar se ainda está pendente (status == 'pending')
      const { data: notification, error: notificationError } = await supabase
        .from("notifications")
        .select("id, read, status")
        .eq("id", notificationId)
        .eq("to_user_id", currentUserId)
        .eq("type", "invite")
        .eq("artist_id", artistId)
        .single();

      if (
        notificationError ||
        !notification ||
        notification.status !== "pending"
      ) {
        Alert.alert("Erro", "Convite não encontrado ou já foi processado");
        await loadNotifications(); // Recarregar para atualizar
        return;
      }

      // Recusar convite diretamente usando a notificação (sem buscar em artist_invites)
      // O backend deve processar isso através da notificação
      const { success, error } = await declineArtistInvite(
        notificationId,
        currentUserId,
      );

      if (success) {
        // Atualizar notificação: read = true e status = 'rejected'
        await updateNotificationStatus(notificationId, "rejected");

        // Recarregar notificações
        await loadNotifications();

        // ✅ Atualizar badge de notificações
        await loadUnreadCount();
      } else {
        Alert.alert("Erro", error || "Erro ao recusar convite");
      }
    } catch (error) {
      Alert.alert("Erro", "Erro ao recusar convite");
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "invite":
        return "mail";
      case "basic":
        return "information-circle-outline";
      case "update":
        return "person-add";
      case "delete":
        return "person-remove";
      case "event":
        return "calendar";
      case "participacao_evento":
        return "people";
      default:
        return "notifications";
    }
  };

  const formatNotificationTitle = (title: string, type: string) => {
    if (type === "event" && title.includes("adicionado")) {
      return title.replace("adicionado", "").trim();
    }
    return title;
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case "invite":
        return "#3B82F6";
      case "basic":
        return "#6B7280";
      case "update":
        return "#10B981";
      case "delete":
        return "#EF4444";
      case "event":
        return "#F59E0B";
      case "participacao_evento":
        return "#8B5CF6";
      default:
        return "#6B7280";
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60),
    );

    if (diffInMinutes < 1) return "Agora";
    if (diffInMinutes < 60) return `${diffInMinutes}m`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d`;

    return date.toLocaleDateString("pt-BR");
  };

  const getInviteStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "#F59E0B";
      case "accepted":
        return "#10B981";
      case "declined":
        return "#EF4444";
      default:
        return "#6B7280";
    }
  };

  const getInviteStatusText = (status: string) => {
    switch (status) {
      case "pending":
        return "Pendente";
      case "accepted":
        return "Aceito";
      case "declined":
        return "Recusado";
      default:
        return "Desconhecido";
    }
  };

  const isNotificationSentByUser = (notification: Notification) => {
    return currentUserId && notification.from_user_id === currentUserId;
  };

  const dynamicStyles = createDynamicStyles(isDarkMode, colors);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
        <SafeAreaView style={dynamicStyles.container}>
          <View style={dynamicStyles.header}>
            <TouchableOpacity
              style={dynamicStyles.backButton}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={dynamicStyles.headerTitle}>Notificações</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={dynamicStyles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={dynamicStyles.loadingText}>
              Carregando notificações...
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <SafeAreaView style={dynamicStyles.container}>
        <View style={dynamicStyles.header}>
          <TouchableOpacity
            style={dynamicStyles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={dynamicStyles.headerTitle}>Notificações</Text>
          {unreadCount > 0 && (
            <TouchableOpacity
              style={dynamicStyles.markAllButton}
              onPress={handleMarkAllAsRead}
            >
              <Text style={dynamicStyles.markAllText}>Marcar todas</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          style={[dynamicStyles.content, { paddingHorizontal: 0 }]}
          contentContainerStyle={{
            paddingBottom: Platform.OS === "ios" ? 20 : 10,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {notifications.length === 0 ? (
            <View style={dynamicStyles.emptyState}>
              <Ionicons
                name="notifications-outline"
                size={64}
                color={colors.textSecondary}
              />
              <Text style={dynamicStyles.emptyTitle}>Nenhuma notificação</Text>
              <Text style={dynamicStyles.emptySubtitle}>
                Você não possui notificações no momento.
              </Text>
            </View>
          ) : (
            <View style={dynamicStyles.content}>
              {notifications.map((notification) => {
                const isInvite = notification.type === "invite";
                // basic e demais: clicável (basic só marca como lida; outros navegam)
                const isClickable = !isInvite;
                const CardWrapper = isClickable ? TouchableOpacity : View;
                const cardWrapperProps = isClickable
                  ? {
                      style: styles.notificationContent,
                      onPress: () => handleNotificationPress(notification),
                      activeOpacity: 0.7,
                    }
                  : { style: styles.notificationContent };
                return (
                  <View
                    key={notification.id}
                    style={[
                      dynamicStyles.notificationCard,
                      !notification.read && dynamicStyles.unreadNotification,
                    ]}
                  >
                    <CardWrapper {...cardWrapperProps}>
                      <View style={styles.notificationLeft}>
                        {/* Mensagem do sistema: avatar MeuShow */}
                        {notification.type === "basic" ? (
                          <View style={styles.userAvatarContainer}>
                            <View style={styles.userAvatarWithIcon}>
                              <View
                                style={[
                                  styles.marcaAiSystemAvatar,
                                  {
                                    backgroundColor: colors.primary,
                                    shadowColor: colors.primary,
                                  },
                                ]}
                              >
                                <Image
                                  source={require("../assets/images/logo_ticket_white.png")}
                                  style={styles.marcaAiSystemAvatarTicket}
                                  resizeMode="contain"
                                />
                              </View>
                            </View>
                          </View>
                        ) : null}
                        {/* Convite sintético de participação (sem from_user): avatar de sistema */}
                        {notification.type === "participacao_evento" &&
                        !notification.from_user ? (
                          <View style={styles.userAvatarContainer}>
                            <View style={styles.userAvatarWithIcon}>
                              <View
                                style={[
                                  styles.marcaAiSystemAvatar,
                                  {
                                    backgroundColor: "#8B5CF6",
                                    shadowColor: "#8B5CF6",
                                  },
                                ]}
                              >
                                <Ionicons
                                  name="people"
                                  size={20}
                                  color="#FFFFFF"
                                />
                              </View>
                              <View
                                style={[
                                  styles.notificationIconBadge,
                                  {
                                    backgroundColor: getNotificationColor(
                                      notification.type,
                                    ),
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={getNotificationIcon(notification.type)}
                                  size={12}
                                  color="#FFFFFF"
                                />
                              </View>
                            </View>
                          </View>
                        ) : null}
                        {/* Imagem do usuário com ícone de notificação */}
                        {notification.type !== "basic" &&
                          notification.from_user && (
                            <View style={styles.userAvatarContainer}>
                              {notification.from_user.profile_url &&
                              notification.from_user.profile_url.trim() !==
                                "" ? (
                                <View style={styles.userAvatarWithIcon}>
                                  <Image
                                    source={{
                                      uri: `${notification.from_user.profile_url}${notification.from_user.profile_url.includes("?") ? "&" : "?"}t=${Date.now()}`,
                                      cache: "reload",
                                    }}
                                    style={styles.userAvatar}
                                    resizeMode="cover"
                                    onError={() => {
                                      // Fallback para placeholder em caso de erro
                                    }}
                                  />
                                  <View
                                    style={[
                                      styles.notificationIconBadge,
                                      {
                                        backgroundColor: getNotificationColor(
                                          notification.type,
                                        ),
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name={getNotificationIcon(
                                        notification.type,
                                      )}
                                      size={12}
                                      color="#FFFFFF"
                                    />
                                  </View>
                                </View>
                              ) : (
                                <View style={styles.userAvatarPlaceholder}>
                                  <Ionicons
                                    name="person"
                                    size={18}
                                    color="#667eea"
                                  />
                                  <View
                                    style={[
                                      styles.notificationIconBadge,
                                      {
                                        backgroundColor: getNotificationColor(
                                          notification.type,
                                        ),
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name={getNotificationIcon(
                                        notification.type,
                                      )}
                                      size={12}
                                      color="#FFFFFF"
                                    />
                                  </View>
                                </View>
                              )}
                            </View>
                          )}

                        <View style={styles.notificationDetails}>
                          <View style={styles.notificationHeader}>
                            <Text
                              style={[
                                dynamicStyles.notificationTitle,
                                !notification.read && dynamicStyles.unreadTitle,
                              ]}
                            >
                              {formatNotificationTitle(
                                notification.title,
                                notification.type,
                              )}
                            </Text>
                          </View>

                          <Text style={dynamicStyles.notificationMessage}>
                            {notification.message}
                          </Text>
                          {shouldShowParticipationProfileHint(notification) ? (
                            <Text
                              style={[
                                dynamicStyles.notificationMessage,
                                {
                                  marginTop: 6,
                                  fontSize: 13,
                                  color: colors.textSecondary,
                                },
                              ]}
                            >
                              Perfil convidado:{" "}
                              {getNotificationArtistProfileName(notification)}
                            </Text>
                          ) : null}

                          <View style={styles.notificationFooter}>
                            <View style={styles.footerLeft}>
                              <Text style={dynamicStyles.notificationTime}>
                                {formatTimeAgo(notification.created_at)}
                              </Text>
                            </View>

                            {notification.type === "basic" ? (
                              <View style={styles.footerRight}>
                                <Text
                                  style={[
                                    styles.userName,
                                    { color: colors.textSecondary },
                                  ]}
                                >
                                  MeuShow
                                </Text>
                              </View>
                            ) : notification.from_user ? (
                              <View style={styles.footerRight}>
                                <Text style={styles.footerLabel}>por</Text>
                                <Text style={styles.userName}>
                                  {notification.from_user.name}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          {/* Botões de Aceitar/Recusar para convites (type == 'invite' e status == 'pending') */}
                          {notification.type === "invite" &&
                            notification.artist_id && (
                              <>
                                {notification.status === "pending" ? (
                                  <View style={dynamicStyles.inviteActions}>
                                    <TouchableOpacity
                                      style={dynamicStyles.acceptButton}
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        handleAcceptInviteFromNotification(
                                          notification.artist_id!,
                                          notification.message.split('"')[1] ||
                                            "Artista",
                                          notification.id,
                                          notification.role, // ✅ Passar role da notificação
                                        );
                                      }}
                                    >
                                      <Ionicons
                                        name="checkmark-circle"
                                        size={16}
                                        color="#FFFFFF"
                                      />
                                      <Text
                                        style={dynamicStyles.acceptButtonText}
                                      >
                                        Aceitar
                                      </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                      style={dynamicStyles.declineButton}
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        handleDeclineInviteFromNotification(
                                          notification.artist_id!,
                                          notification.id,
                                        );
                                      }}
                                    >
                                      <Ionicons
                                        name="close-circle"
                                        size={16}
                                        color={colors.textSecondary}
                                      />
                                      <Text
                                        style={dynamicStyles.declineButtonText}
                                      >
                                        Recusar
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : (
                                  <View
                                    style={dynamicStyles.inviteProcessedBadge}
                                  >
                                    <Ionicons
                                      name="checkmark-done"
                                      size={14}
                                      color={colors.success}
                                    />
                                    <Text
                                      style={dynamicStyles.inviteProcessedText}
                                    >
                                      Convite processado
                                    </Text>
                                  </View>
                                )}
                              </>
                            )}
                        </View>
                      </View>

                      <View style={styles.notificationRight}>
                        {!notification.read && (
                          <View style={dynamicStyles.unreadDot} />
                        )}
                        {/* Esconder botão de deletar para convites - será deletado ao aceitar/recusar */}
                        {notification.type !== "invite" && (
                          <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={() =>
                              handleDeleteNotification(notification.id)
                            }
                          >
                            <Ionicons
                              name="trash-outline"
                              size={16}
                              color={colors.textSecondary}
                            />
                          </TouchableOpacity>
                        )}
                      </View>
                    </CardWrapper>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Modal de Permissão */}
        <PermissionModal
          visible={showPermissionModal}
          onClose={() => setShowPermissionModal(false)}
          title="Sem Permissão"
          message="Você não tem permissão para visualizar detalhes deste evento. Apenas colaboradores com permissão de edição podem acessar os detalhes."
          icon="lock-closed"
        />

        {/* Modal de Sucesso */}
        {showSuccessModal && (
          <View style={dynamicStyles.modalOverlay}>
            <View style={dynamicStyles.modalContainer}>
              <View style={dynamicStyles.modalHeader}>
                <Ionicons name="checkmark-circle" size={48} color="#10B981" />
                <Text style={dynamicStyles.modalTitle}>Convite Aceito!</Text>
              </View>

              <Text style={dynamicStyles.modalMessage}>{successMessage}</Text>

              <View style={dynamicStyles.modalPermissions}>
                <Text style={dynamicStyles.permissionsTitle}>
                  Suas permissões:
                </Text>
                <View style={dynamicStyles.permissionItem}>
                  <Ionicons name="eye" size={16} color={colors.textSecondary} />
                  <Text style={dynamicStyles.permissionText}>
                    Visualizar informações do artista
                  </Text>
                </View>
                <View style={dynamicStyles.permissionItem}>
                  <Ionicons
                    name="calendar"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text style={dynamicStyles.permissionText}>
                    Ver agenda e eventos
                  </Text>
                </View>
                <View style={dynamicStyles.permissionItem}>
                  <Ionicons
                    name="people"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text style={dynamicStyles.permissionText}>
                    Ver outros colaboradores
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={dynamicStyles.modalButton}
                onPress={() => setShowSuccessModal(false)}
              >
                <Text style={dynamicStyles.modalButtonText}>Entendi</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Modal de Convite Aceito */}
        {showAcceptedModal && acceptedInviteData && (
          <View style={dynamicStyles.modalOverlay}>
            <View
              style={[
                styles.acceptedModalContainer,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderWidth: 1,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              {/* Header */}
              <View style={styles.acceptedModalHeader}>
                <View
                  style={[
                    styles.successIconCircle,
                    {
                      backgroundColor: colors.primary + "20",
                      borderColor: colors.primary + "40",
                      borderWidth: 1,
                      borderRadius: 40,
                      padding: 8,
                    },
                  ]}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={64}
                    color={colors.primary}
                  />
                </View>
                <Text
                  style={[styles.acceptedModalTitle, { color: colors.primary }]}
                >
                  {acceptedInviteData.isFirstArtist
                    ? "Bem-vindo!"
                    : "Convite Aceito!"}
                </Text>
                <Text
                  style={[
                    styles.acceptedModalSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {acceptedInviteData.isFirstArtist
                    ? "Você agora faz parte do time"
                    : "Você foi adicionado ao artista"}
                </Text>
              </View>

              {/* Info Card */}
              <View
                style={[
                  styles.acceptedInfoCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.acceptedInfoRow}>
                  <Ionicons
                    name="musical-notes"
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.acceptedInfoLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Artista:
                  </Text>
                </View>
                <Text
                  style={[styles.acceptedInfoValue, { color: colors.text }]}
                >
                  {acceptedInviteData.artistName}
                </Text>

                <View style={[styles.acceptedInfoRow, { marginTop: 16 }]}>
                  <Ionicons
                    name="shield-checkmark"
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.acceptedInfoLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Cargo:
                  </Text>
                </View>
                <View
                  style={[
                    styles.acceptedRoleBadge,
                    {
                      backgroundColor: colors.primary + "15",
                      borderColor: colors.primary + "30",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      acceptedInviteData.role === "Administrador"
                        ? "shield-checkmark"
                        : acceptedInviteData.role === "Vendedor"
                          ? "pricetag"
                          : "eye"
                    }
                    size={16}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.acceptedRoleText, { color: colors.primary }]}
                  >
                    {acceptedInviteData.role}
                  </Text>
                </View>
              </View>

              {/* Permissions */}
              <View
                style={[
                  styles.acceptedPermissionsBox,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.acceptedPermissionsTitle,
                    { color: colors.text },
                  ]}
                >
                  📋 Suas Permissões:
                </Text>
                <View style={styles.acceptedPermissionsList}>
                  {/* Permissões básicas para todos */}
                  <View style={styles.acceptedPermissionItem}>
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.acceptedPermissionText,
                        { color: colors.text },
                      ]}
                    >
                      Visualizar eventos e agenda
                    </Text>
                  </View>
                  <View style={styles.acceptedPermissionItem}>
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.acceptedPermissionText,
                        { color: colors.text },
                      ]}
                    >
                      Ver dados do artista
                    </Text>
                  </View>

                  {/* Permissões para Vendedor */}
                  {acceptedInviteData.role === "Vendedor" && (
                    <>
                      <View style={styles.acceptedPermissionItem}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.acceptedPermissionText,
                            { color: colors.text },
                          ]}
                        >
                          Criar eventos
                        </Text>
                      </View>
                      <View style={styles.acceptedPermissionItem}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.acceptedPermissionText,
                            { color: colors.text },
                          ]}
                        >
                          Ver o valor apenas dos eventos que você criar
                        </Text>
                      </View>
                    </>
                  )}

                  {/* Permissões apenas para Admin */}
                  {acceptedInviteData.role === "Administrador" && (
                    <>
                      <View style={styles.acceptedPermissionItem}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.acceptedPermissionText,
                            { color: colors.text },
                          ]}
                        >
                          Criar, editar e excluir eventos
                        </Text>
                      </View>
                      <View style={styles.acceptedPermissionItem}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.acceptedPermissionText,
                            { color: colors.text },
                          ]}
                        >
                          Visualizar valores financeiros
                        </Text>
                      </View>
                    </>
                  )}

                  {acceptedInviteData.role === "Administrador" && (
                    <>
                      <View style={styles.acceptedPermissionItem}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.acceptedPermissionText,
                            { color: colors.text },
                          ]}
                        >
                          Gerenciar colaboradores
                        </Text>
                      </View>
                      <View style={styles.acceptedPermissionItem}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.acceptedPermissionText,
                            { color: colors.text },
                          ]}
                        >
                          Deletar eventos e artista
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>

              {/* Status */}
              {acceptedInviteData.isFirstArtist && (
                <View
                  style={[
                    styles.acceptedStatusBox,
                    {
                      backgroundColor: colors.primary + "20",
                      borderColor: colors.primary + "40",
                    },
                  ]}
                >
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.acceptedStatusText,
                      { color: colors.primary },
                    ]}
                  >
                    Este artista foi definido como seu artista ativo. Você pode
                    acessar a agenda, eventos e configurações agora mesmo!
                  </Text>
                </View>
              )}

              {!acceptedInviteData.isFirstArtist && (
                <View
                  style={[
                    styles.acceptedStatusBox,
                    {
                      backgroundColor: colors.primary + "20",
                      borderColor: colors.primary + "40",
                    },
                  ]}
                >
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.acceptedStatusText,
                      { color: colors.primary },
                    ]}
                  >
                    Para trabalhar com este artista, troque para ele nas
                    Configurações → Selecionar Artista.
                  </Text>
                </View>
              )}

              {/* Button */}
              <TouchableOpacity
                style={[
                  styles.acceptedModalButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => setShowAcceptedModal(false)}
              >
                <Text style={styles.acceptedModalButtonText}>Entendi</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

// Função para criar estilos dinâmicos baseados no modo escuro
const createDynamicStyles = (isDark: boolean, colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.secondary,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "bold",
      color: colors.text,
      flex: 1,
      textAlign: "center",
      marginHorizontal: 16,
    },
    markAllButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    markAllText: {
      color: "#fff",
      fontSize: 14,
      fontWeight: "600",
    },
    content: {
      flex: 1,
      paddingHorizontal: 20,
    },
    notificationCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginVertical: 6,
      shadowColor: colors.shadow,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: Platform.OS === "android" ? 0 : isDark ? 0.3 : 0.1,
      shadowRadius: Platform.OS === "android" ? 0 : 3.84,
      elevation: Platform.OS === "android" ? 0 : 5,
    },
    unreadNotification: {
      backgroundColor: isDark ? "#353535" : "#F9FAFB",
      borderColor: isDark ? colors.border : "#E5E7EB",
    },
    notificationHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    notificationIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.secondary,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 12,
    },
    notificationTitle: {
      fontSize: 16,
      fontWeight: "bold",
      color: colors.text,
      flex: 1,
    },
    unreadTitle: {
      fontWeight: "700",
      color: isDark ? colors.text : "#111827",
    },
    notificationTime: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    notificationMessage: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    notificationActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
    },
    actionButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: colors.secondary,
    },
    actionButtonText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.text,
    },
    deleteButton: {
      backgroundColor: colors.error,
    },
    deleteButtonText: {
      color: "#fff",
    },
    inviteCard: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    inviteContent: {
      padding: 12,
    },
    inviteHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    inviteTitle: {
      fontSize: 16,
      fontWeight: "bold",
      color: colors.text,
      marginLeft: 8,
      flex: 1,
    },
    inviteMessage: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    inviteTime: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    inviteActions: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    acceptButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.success,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 6,
    },
    acceptButtonText: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "600",
    },
    declineButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? colors.background : colors.secondary,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    declineButtonText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: "600",
    },
    inviteProcessedBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: `${colors.success}20`,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      gap: 6,
      marginTop: 12,
      borderWidth: 1,
      borderColor: `${colors.success}40`,
    },
    inviteProcessedText: {
      fontSize: 13,
      color: colors.success,
      fontWeight: "600",
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
      marginLeft: 8,
    },
    emptyState: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 40,
    },
    emptyIcon: {
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "bold",
      color: colors.text,
      marginBottom: 8,
    },
    emptySubtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: "center",
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 40,
    },
    loadingText: {
      fontSize: 16,
      color: colors.textSecondary,
      marginTop: 12,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    modalContainer: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      margin: 20,
      maxWidth: "90%",
      shadowColor: colors.shadow,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: Platform.OS === "android" ? 0 : 0.25,
      shadowRadius: Platform.OS === "android" ? 0 : 3.84,
      elevation: Platform.OS === "android" ? 0 : 5,
    },
    modalHeader: {
      alignItems: "center",
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "bold",
      color: colors.text,
      marginBottom: 8,
    },
    modalMessage: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: "center",
      marginBottom: 16,
    },
    modalPermissions: {
      backgroundColor: colors.secondary,
      borderRadius: 8,
      padding: 12,
      marginBottom: 16,
    },
    permissionsTitle: {
      fontSize: 14,
      fontWeight: "bold",
      color: colors.text,
      marginBottom: 8,
    },
    permissionItem: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
    },
    permissionText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginLeft: 8,
    },
    modalButton: {
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      alignItems: "center",
    },
    modalButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
  });

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  placeholder: {
    width: 40,
  },
  markAllButton: {
    padding: 8,
  },
  markAllText: {
    fontSize: 14,
    color: "#667eea",
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginTop: 16,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  notificationsList: {
    paddingHorizontal: 0,
    paddingTop: 20,
  },
  notificationCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  unreadNotification: {
    backgroundColor: "#F9FAFB",
  },
  notificationContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
  },
  notificationLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
  },
  notificationRight: {
    alignItems: "center",
    justifyContent: "space-between",
    height: 40,
  },
  userAvatarContainer: {
    marginRight: 12,
  },
  userAvatarWithIcon: {
    position: "relative",
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  userAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    position: "relative",
  },
  marcaAiSystemAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === "android" ? 0 : 0.22,
    shadowRadius: 3,
    elevation: Platform.OS === "android" ? 2 : 0,
  },
  marcaAiSystemAvatarTicket: {
    width: 26,
    height: 26,
  },
  notificationIconBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  notificationDetails: {
    flex: 1,
  },
  notificationHeader: {
    marginBottom: 4,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    lineHeight: 20,
  },
  unreadTitle: {
    fontWeight: "700",
    color: "#111827",
  },
  notificationMessage: {
    fontSize: 14,
    color: "#6B7280",
    lineHeight: 19,
    marginBottom: 8,
    marginTop: 4,
  },
  notificationFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  footerLeft: {
    flex: 1,
  },
  footerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  notificationTime: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  footerLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "400",
    marginRight: 4,
  },
  userName: {
    fontSize: 12,
    color: "#667eea",
    fontWeight: "600",
  },
  deleteButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#667eea",
    marginBottom: 8,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 20,
    marginHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 12,
    marginTop: 4,
    marginHorizontal: 16,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#FFFFFF",
  },
  inviteActions: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  acceptButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10B981",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  acceptButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  declineButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  declineButtonText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "600",
  },
  inviteCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  inviteContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
  },
  inviteLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
  },
  inviteIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  inviteRight: {
    alignItems: "center",
    justifyContent: "center",
    height: 40,
  },
  inviteDetails: {
    flex: 1,
  },
  inviteTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 4,
    lineHeight: 20,
  },
  inviteMessage: {
    fontSize: 14,
    color: "#6B7280",
    lineHeight: 19,
    marginBottom: 4,
  },
  inviteTime: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    margin: 20,
    maxWidth: 400,
    width: "90%",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: Platform.OS === "android" ? 0 : 0.25,
    shadowRadius: Platform.OS === "android" ? 0 : 3.84,
    elevation: Platform.OS === "android" ? 0 : 5,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1F2937",
    marginTop: 8,
  },
  modalMessage: {
    fontSize: 16,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 20,
  },
  modalPermissions: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  permissionsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 14,
    color: "#6B7280",
    marginLeft: 8,
    flex: 1,
  },
  modalButton: {
    backgroundColor: "#3B82F6",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Estilos do Modal de Convite Aceito
  acceptedModalContainer: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    margin: 20,
    maxWidth: 420,
    width: "90%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: Platform.OS === "android" ? 0 : 0.3,
    shadowRadius: Platform.OS === "android" ? 0 : 20,
    elevation: Platform.OS === "android" ? 0 : 10,
  },
  acceptedModalHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  successIconCircle: {
    marginBottom: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  acceptedModalTitle: {
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  acceptedModalSubtitle: {
    fontSize: 15,
    textAlign: "center",
  },
  acceptedInfoCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
  },
  acceptedInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  acceptedInfoLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  acceptedInfoValue: {
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 28,
  },
  acceptedRoleBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
    marginLeft: 28,
    borderWidth: 1,
  },
  acceptedRoleText: {
    fontSize: 14,
    fontWeight: "600",
  },
  acceptedPermissionsBox: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  acceptedPermissionsTitle: {
    fontSize: 15,
    fontWeight: "bold",
    marginBottom: 12,
  },
  acceptedPermissionsList: {
    gap: 10,
  },
  acceptedPermissionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  acceptedPermissionText: {
    fontSize: 14,
    flex: 1,
  },
  acceptedStatusBox: {
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
  },
  acceptedStatusText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  acceptedModalButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  acceptedModalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Badge de convite processado
  inviteProcessedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  inviteProcessedText: {
    fontSize: 13,
    color: "#065F46",
    fontWeight: "600",
  },
});
