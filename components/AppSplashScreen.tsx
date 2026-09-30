import React from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { useColorScheme } from '../hooks/use-color-scheme';

/** Alinhado à splash nativa (app.json) */
const LIGHT_BG = '#667eea';
const DARK_BG = '#4c51bf';
const ACCENT = '#ffffff';

const TICKET_WHITE = require('../assets/images/logo_ticket_white.png');

export default function AppSplashScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: isDark ? DARK_BG : LIGHT_BG }]}>
      <Image source={TICKET_WHITE} style={styles.logo} resizeMode="contain" />
      <ActivityIndicator
        style={styles.spinner}
        color={ACCENT}
        size="small"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  spinner: {
    marginTop: 36,
    transform: [{ scale: 1.15 }],
  },
});
