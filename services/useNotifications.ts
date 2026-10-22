import { useIsFocused } from '@react-navigation/native';
import { useState, useEffect, useRef } from 'react';
import { setAppIconBadge } from './appIconBadge';
import { getUnreadNotificationCount } from './supabase/notificationService';
import { getCurrentUser } from './supabase/authService';
import { subscribeToNotifications, RealtimeSubscription } from './realtimeService';

export const useNotifications = () => {
  const isFocused = useIsFocused();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const subscriptionsRef = useRef<RealtimeSubscription[]>([]);

  const loadUnreadCount = async () => {
    if (!isFocused) return;
    try {
      setIsLoading(true);
      
      const { user, error: userError } = await getCurrentUser();
      if (!isFocused) return;
      
      if (userError || !user) {
        setUnreadCount(0);
        await setAppIconBadge(0);
        return;
      }

      const { count, error } = await getUnreadNotificationCount(user.id);
      if (!isFocused) return;
      
      if (error) {
        setUnreadCount(0);
        await setAppIconBadge(0);
      } else {
        setUnreadCount(count);
        await setAppIconBadge(count);
      }
    } catch (error) {
      if (!isFocused) return;
      setUnreadCount(0);
      await setAppIconBadge(0);
    } finally {
      if (isFocused) setIsLoading(false);
    }
  };

  const updateUnreadCount = (newCount: number) => {
    setUnreadCount(newCount);
  };

  const setupRealtimeSubscriptions = async () => {
    try {
      const { user, error: userError } = await getCurrentUser();
      
      if (userError || !user) {
        return;
      }

      subscriptionsRef.current.forEach(sub => sub.unsubscribe());
      subscriptionsRef.current = [];

      const notificationSubscription = subscribeToNotifications(
        user.id,
        () => {
          void loadUnreadCount();
        }
      );

      subscriptionsRef.current = [notificationSubscription];
      
    } catch (error) {
      // Erro ao configurar subscriptions em tempo real
    }
  };

  useEffect(() => {
    if (!isFocused) {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe());
      subscriptionsRef.current = [];
      return;
    }
    void loadUnreadCount();
    void setupRealtimeSubscriptions();

    return () => {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe());
      subscriptionsRef.current = [];
    };
  }, [isFocused]);

  return {
    unreadCount,
    isLoading,
    loadUnreadCount,
    updateUnreadCount,
    setupRealtimeSubscriptions
  };
};
