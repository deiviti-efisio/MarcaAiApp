import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import { dispatchResetToLogin } from '../lib/resetToLoginStack';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MeuShowWordmark from '../components/MeuShowWordmark';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { setAppIconBadge } from '../services/appIconBadge';
import { setupPushNotificationHandlers } from '../services/pushNotificationHandler';
import { checkArtistsAndRedirect } from '../services/supabase/authService';
import { checkUserExists } from '../services/supabase/userService';
import { isLikelyNetworkFailure } from '../utils/isLikelyNetworkFailure';

const LOADING_TIMEOUT_MS = 8000;

export default function Index() {
  const { colors, isDarkMode } = useTheme();
  const navigation = useNavigation();
  const hasNavigated = useRef(false);
  /** Evita corrida: timer/modal "sem conexão" abriu mas checkAuth ainda chama goToLogin/navigateTo. */
  const authNavigationBlockedRef = useRef(false);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const openOfflineModal = useCallback(() => {
    if (hasNavigated.current) return;
    clearSafetyTimer();
    authNavigationBlockedRef.current = true;
    setShowOfflineModal(true);
  }, [clearSafetyTimer]);

  const scheduleSafetyTimer = useCallback(() => {
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(() => {
      if (!hasNavigated.current) {
        openOfflineModal();
      }
    }, LOADING_TIMEOUT_MS);
  }, [clearSafetyTimer, openOfflineModal]);

  const navigateTo = useCallback(
    (route: string) => {
      if (hasNavigated.current || authNavigationBlockedRef.current) return;
      hasNavigated.current = true;
      clearSafetyTimer();
      setShowOfflineModal(false);
      router.replace(route as any);
    },
    [clearSafetyTimer]
  );

  const goToLogin = useCallback(() => {
    if (hasNavigated.current || authNavigationBlockedRef.current) return;
    hasNavigated.current = true;
    clearSafetyTimer();
    setShowOfflineModal(false);
    dispatchResetToLogin(navigation);
  }, [clearSafetyTimer, navigation]);

  const applyArtistRedirect = useCallback(
    (artistRedirect: Awaited<ReturnType<typeof checkArtistsAndRedirect>>) => {
      setAppIconBadge(0);
      if (artistRedirect.shouldRedirectToSelection) {
        navigateTo('/selecionar-artista');
      } else {
        navigateTo('/(tabs)/agenda');
      }
    },
    [navigateTo]
  );

  const checkAuthStatus = useCallback(async () => {
    let session: Session | null = null;
    try {
      const {
        data: { session: s },
        error: sessionError,
      } = await supabase.auth.getSession();
      session = s;

      if (sessionError) {
        if (isLikelyNetworkFailure(sessionError, sessionError.message)) {
          openOfflineModal();
          return;
        }
        goToLogin();
        return;
      }

      if (!session?.user) {
        goToLogin();
        return;
      }

      if (!session.user.email_confirmed_at) {
        navigateTo('/email-confirmation');
        return;
      }

      const userId = session.user.id;

      const [userCheck, artistRedirect] = await Promise.all([
        checkUserExists(userId),
        checkArtistsAndRedirect(userId),
      ]);

      if (userCheck.error) {
        if (isLikelyNetworkFailure(null, userCheck.error)) {
          openOfflineModal();
          return;
        }
        goToLogin();
        return;
      }

      if (!userCheck.exists) {
        goToLogin();
        return;
      }

      applyArtistRedirect(artistRedirect);
    } catch (e) {
      if (isLikelyNetworkFailure(e)) {
        openOfflineModal();
        return;
      }
      goToLogin();
    }
  }, [applyArtistRedirect, goToLogin, navigateTo, openOfflineModal]);

  const checkAuthRef = useRef(checkAuthStatus);
  checkAuthRef.current = checkAuthStatus;

  const handleRetryConnection = useCallback(async () => {
    if (isRetrying || hasNavigated.current) return;
    setIsRetrying(true);
    try {
      authNavigationBlockedRef.current = false;
      hasNavigated.current = false;
      setShowOfflineModal(false);
      scheduleSafetyTimer();
      await checkAuthRef.current();
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying, scheduleSafetyTimer]);

  useEffect(() => {
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      setupPushNotificationHandlers();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {});

    scheduleSafetyTimer();
    void checkAuthRef.current();

    return () => {
      interactionTask.cancel?.();
      clearSafetyTimer();
      subscription.unsubscribe();
    };
  }, [clearSafetyTimer, scheduleSafetyTimer]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <MeuShowWordmark size="sm" style={styles.logoBlock} />

      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>

      <Modal
        visible={showOfflineModal}
        transparent
        animationType="fade"
        onRequestClose={() => void handleRetryConnection()}
      >
        <View style={styles.offlineOverlay}>
          <View style={styles.offlineCard}>
            <View style={styles.offlineIconWrap}>
              <Ionicons name="cloud-offline-outline" size={22} color="#667eea" />
            </View>
            <Text style={styles.offlineTitle}>Sem conexão</Text>
            <Text style={styles.offlineMessage}>
              Confira sua internet e tente de novo.
            </Text>
            <TouchableOpacity
              style={styles.offlineButton}
              onPress={() => void handleRetryConnection()}
              disabled={isRetrying}
              activeOpacity={0.85}
            >
              {isRetrying ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.offlineButtonText}>Tentar novamente</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logoBlock: {
    marginBottom: 36,
    alignSelf: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
  },
  offlineOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  offlineCard: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(102, 126, 234, 0.12)',
    shadowColor: '#1a1a2e',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.12,
    shadowRadius: 24,
    elevation: Platform.OS === 'android' ? 6 : 0,
  },
  offlineIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(102, 126, 234, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  offlineTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a2e',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  offlineMessage: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  offlineButton: {
    backgroundColor: '#667eea',
    width: '100%',
    minHeight: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
