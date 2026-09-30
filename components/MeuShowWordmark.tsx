import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

const SOURCE = require('../assets/images/logo_meushow_escrita_v2.png');

const SIZES = {
  xs: { width: 110, height: 78 },
  sm: { width: 140, height: 100 },
  md: { width: 180, height: 128 },
  lg: { width: 220, height: 156 },
} as const;

type Props = {
  size?: keyof typeof SIZES;
  style?: StyleProp<ImageStyle>;
};

export default function MeuShowWordmark({ size = 'md', style }: Props) {
  return (
    <Image
      source={SOURCE}
      style={[SIZES[size], style]}
      resizeMode="contain"
      accessibilityLabel="MeuShow"
    />
  );
}
