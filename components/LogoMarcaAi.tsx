import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

const TICKET_MARK = require('../assets/images/logo_ticket.png');

interface LogoMarcaAiProps {
  size?: 'small' | 'medium' | 'large';
  showTagline?: boolean;
  showIcon?: boolean;
  /** Só o ingresso (ex.: tela de loading) */
  iconOnly?: boolean;
  style?: any;
}

export default function LogoMarcaAi({
  size = 'medium',
  showTagline = true,
  showIcon = true,
  iconOnly = false,
  style,
}: LogoMarcaAiProps) {
  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          containerSize: 40,
          titleFontSize: 16,
          taglineFontSize: 10,
        };
      case 'large':
        return {
          containerSize: 80,
          titleFontSize: 28,
          taglineFontSize: 14,
        };
      default:
        return {
          containerSize: 60,
          titleFontSize: 22,
          taglineFontSize: 12,
        };
    }
  };

  const config = getSizeConfig();
  const ticket = (
    <Image
      source={TICKET_MARK}
      style={{ width: config.containerSize, height: config.containerSize }}
      resizeMode="contain"
    />
  );

  if (iconOnly) {
    return <View style={[styles.container, style]}>{ticket}</View>;
  }

  return (
    <View style={[styles.container, style]}>
      {showIcon ? (
        <View style={styles.logoRow}>
          <View style={styles.iconWrap}>{ticket}</View>
          <View style={styles.textContainer}>
            <Text style={[styles.title, { fontSize: config.titleFontSize }]}>MeuShow</Text>
            {showTagline && (
              <Text style={[styles.tagline, { fontSize: config.taglineFontSize }]}>
                Agenda & Finanças
              </Text>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.textOnlyContainer}>
          <Text style={[styles.titleCentered, { fontSize: config.titleFontSize * 1.5 }]}>
            MeuShow
          </Text>
          {showTagline && (
            <Text style={[styles.taglineCentered, { fontSize: config.taglineFontSize * 1.2 }]}>
              Agenda & Finanças
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    marginRight: 12,
  },
  textContainer: {
    justifyContent: 'center',
    flexShrink: 1,
  },
  title: {
    color: '#333333',
    fontWeight: 'bold',
    fontFamily: 'System',
    marginBottom: 2,
  },
  tagline: {
    color: '#666666',
    fontFamily: 'System',
    fontWeight: '400',
  },
  textOnlyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCentered: {
    color: '#667eea',
    fontWeight: 'bold',
    fontFamily: 'System',
    textAlign: 'center',
    marginBottom: 8,
  },
  taglineCentered: {
    color: '#666666',
    fontFamily: 'System',
    fontWeight: '500',
    textAlign: 'center',
  },
});
