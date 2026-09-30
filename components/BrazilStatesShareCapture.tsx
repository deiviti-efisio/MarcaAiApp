import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { LocationBucket } from '../services/eventInsightsService';
import { BrazilUfMap } from './BrazilUfMap';

/** Largura fixa para PNG legível em redes sociais / WhatsApp */
export const BRAZIL_STATES_SHARE_WIDTH = 360;

export type BrazilStatesShareCaptureProps = {
  periodLabel: string;
  artistName: string;
  states: LocationBucket[];
  activeUfs: string[];
  onMapLoadEnd?: () => void;
};

/**
 * Cartão off-screen para captura: mapa + lista de eventos por estado.
 * Estilo claro fixo para boa leitura na imagem compartilhada.
 */
export const BrazilStatesShareCapture = React.forwardRef<View, BrazilStatesShareCaptureProps>(
  function BrazilStatesShareCapture(
    { periodLabel, artistName, states, activeUfs, onMapLoadEnd },
    ref
  ) {
    const fillActive = '#2563eb';
    const fillInactive = '#e2e8f0';
    const strokeColor = '#94a3b8';

    return (
      <View ref={ref} collapsable={false} style={styles.root}>
        <View style={styles.brandRow}>
          <Image
            source={require('../assets/images/icone_512x512.png')}
            style={styles.brandLogo}
            accessibilityIgnoresInvertColors
          />
          <Text style={styles.brand}>MeuShow</Text>
        </View>
        <Text style={styles.artist} numberOfLines={2}>
          {artistName}
        </Text>
        <Text style={styles.period}>{periodLabel}</Text>
        <Text style={styles.sub}>Eventos por estado</Text>
        <View style={styles.mapWrap}>
          <BrazilUfMap
            activeUfs={activeUfs}
            fillActive={fillActive}
            fillInactive={fillInactive}
            strokeColor={strokeColor}
            htmlBackgroundColor="#ffffff"
            onLoadEnd={onMapLoadEnd}
          />
        </View>
        <View style={styles.list}>
          {states.map((s) => (
            <View key={s.key} style={styles.row}>
              <Text style={styles.uf}>{s.label}</Text>
              <Text style={styles.count}>
                {s.eventCount} {s.eventCount === 1 ? 'evento' : 'eventos'}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.footer}>Gerado no app MeuShow</Text>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  root: {
    width: BRAZIL_STATES_SHARE_WIDTH,
    backgroundColor: '#ffffff',
    padding: 16,
    paddingBottom: 20,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogo: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  brand: {
    fontSize: 21,
    fontWeight: '800',
    color: '#1e293b',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  artist: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginTop: 4,
  },
  period: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
  },
  sub: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 14,
    marginBottom: 6,
  },
  mapWrap: {
    width: '100%',
  },
  list: {
    marginTop: 12,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  uf: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  count: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  footer: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 14,
    textAlign: 'center',
  },
});
