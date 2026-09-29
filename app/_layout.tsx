import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { AppState, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppSplashScreen from '../components/AppSplashScreen';
import AuthDeepLinkHandler from '../components/AuthDeepLinkHandler';
import ConnectionErrorModalHost from '../components/ConnectionErrorModalHost';
import SubscriptionReconcileBootstrap from '../components/SubscriptionReconcileBootstrap';
import IapPurchaseSyncHost from '../components/IapPurchaseSyncHost';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ActiveArtistProvider } from '../contexts/ActiveArtistContext';
import { PermissionsProvider } from '../contexts/PermissionsContext';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import './error-handler';
import './suppress-logs';
// Registrar handler de background para badge no Android (antes de qualquer componente)
import '../services/backgroundMessageHandler';

// Esconder a tela de splash (ícone) assim que o app carregar
SplashScreen.preventAutoHideAsync();

// Desabilitar LogBox para não mostrar logs na tela
LogBox.ignoreAllLogs(true);

// Iniciar sempre em `index` (gate de auth). Se o anchor for `(tabs)`, o Stack nativo
// monta a agenda por baixo do login e o botão Voltar do Android expõe telas protegidas.
export const unstable_settings = {
  anchor: 'index',
};

const SPLASH_VISIBLE_MS = 1200;

function NavigationAndStack() {
  const { isDarkMode } = useTheme();
  return (
    <NavigationThemeProvider value={isDarkMode ? DarkTheme : DefaultTheme}>
      <AuthDeepLinkHandler />
      <SubscriptionReconcileBootstrap />
      <IapPurchaseSyncHost />
      <RootLayoutContent />
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}

function RootLayoutContent() {
  const { colors } = useTheme();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    (async () => {
      await SplashScreen.hideAsync();
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), SPLASH_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  // Zerar badge ao abrir o app e sempre que voltar ao foreground (iOS e Android)
  // Inclui: ao abrir pelo ícone, ao trocar de app de volta, ao abrir por notificação
  useEffect(() => {
    const { setAppIconBadge } = require('../services/appIconBadge');
    const { Platform } = require('react-native');

    const zeroBadge = () => {
      setAppIconBadge(0).catch(() => {});
    };

    const setupBadge = async () => {
      if (Platform.OS === 'android') {
        try {
          const Notifications = await import('expo-notifications');
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Padrão',
            importance: Notifications.AndroidImportance.HIGH,
            showBadge: true,
          });
        } catch {
          // ignora se falhar
        }
      }
      await setAppIconBadge(0).catch(() => {});
    };

    setupBadge();
    zeroBadge();

    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        zeroBadge();
        if (delayTimer) clearTimeout(delayTimer);
        // iOS e Android: zerar de novo após um instante (sistema/launcher pode reaplicar o badge ao abrir por notificação)
        delayTimer = setTimeout(() => {
          zeroBadge();
          delayTimer = null;
        }, 400);
      }
    });
    return () => {
      if (delayTimer) clearTimeout(delayTimer);
      sub.remove();
    };
  }, []);

  return (
    <>
      {showSplash && <AppSplashScreen />}
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="login"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="register" options={{ headerShown: false }} />
        <Stack.Screen name="email-confirmation" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="cadastro-usuario" options={{ headerShown: false }} />
        <Stack.Screen name="cadastro-artista" options={{ headerShown: false }} />
        <Stack.Screen name="adicionar-evento" options={{ headerShown: false }} />
        <Stack.Screen name="publicar-feed" options={{ headerShown: false }} />
        <Stack.Screen name="negociar-feed" options={{ headerShown: false }} />
        <Stack.Screen name="feed" options={{ headerShown: false }} />
        <Stack.Screen name="feed/index" options={{ headerShown: false, title: 'Feed' }} />
        <Stack.Screen name="feed/publicar-midia" options={{ headerShown: false }} />
        <Stack.Screen name="editar-evento" options={{ headerShown: false }} />
        <Stack.Screen name="detalhes-evento" options={{ headerShown: false }} />
        <Stack.Screen name="adicionar-despesa" options={{ headerShown: false }} />
        <Stack.Screen name="adicionar-receita" options={{ headerShown: false }} />
        <Stack.Screen name="despesas-evento" options={{ headerShown: false }} />
        <Stack.Screen name="financeiro-detalhes" options={{ headerShown: false }} />
        <Stack.Screen name="financeiro-insights" options={{ headerShown: false }} />
        <Stack.Screen name="notificacoes" options={{ headerShown: false }} />
        <Stack.Screen name="editar-usuario" options={{ headerShown: false }} />
        <Stack.Screen name="editar-artista" options={{ headerShown: false }} />
        <Stack.Screen name="configuracoes-artista" options={{ headerShown: false }} />
        <Stack.Screen name="colaboradores-artista" options={{ headerShown: false }} />
        <Stack.Screen name="press-kit-artista" options={{ headerShown: false }} />
        <Stack.Screen name="convites-enviados" options={{ headerShown: false }} />
        <Stack.Screen name="convites-recebidos" options={{ headerShown: false }} />
        <Stack.Screen name="convites-participacao-evento" options={{ headerShown: false }} />
        <Stack.Screen name="parceiros-frequentes" options={{ headerShown: false }} />
        <Stack.Screen name="minhas-observacoes-privadas" options={{ headerShown: false }} />
        <Stack.Screen name="selecionar-artista" options={{ headerShown: false }} />
        <Stack.Screen name="sair-artista" options={{ headerShown: false }} />
        <Stack.Screen name="transferir-propriedade" options={{ headerShown: false }} />
        <Stack.Screen name="screens/profile/UserProfileScreen" options={{ headerShown: false }} />
        <Stack.Screen name="screens/profile/ArtistProfileScreen" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <ThemeProvider>
            <ActiveArtistProvider>
              <PermissionsProvider>
                <ConnectionErrorModalHost />
                <NavigationAndStack />
              </PermissionsProvider>
            </ActiveArtistProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
