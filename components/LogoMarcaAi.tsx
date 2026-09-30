import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import MeuShowWordmark from './MeuShowWordmark';

const TICKET_MARK = require('../assets/images/logo_ticket.png');

interface LogoMarcaAiProps {
  size?: 'small' | 'medium' | 'large';
  showTagline?: boolean;
  showIcon?: boolean;
  /** Só o ingresso (ex.: splash nativa azul) */
  iconOnly?: boolean;
  style?: any;
}

export default function LogoMarcaAi({
  size = 'medium',
  showTagline = true,
  iconOnly = false,
  style,
}: LogoMarcaAiProps) {
  const wordmarkSize = size === 'small' ? 'xs' : size === 'large' ? 'md' : 'sm';
  const ticketPx = size === 'small' ? 40 : size === 'large' ? 80 : 60;

  if (iconOnly) {
    return (
      <View style={[styles.container, style]}>
        <Image
          source={TICKET_MARK}
          style={{ width: ticketPx, height: ticketPx }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <MeuShowWordmark size={wordmarkSize} />
      {showTagline && (
        <Text style={styles.taglineCentered}>Agenda & Finanças</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  taglineCentered: {
    color: '#666666',
    fontFamily: 'System',
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
    fontSize: 13,
  },
});
