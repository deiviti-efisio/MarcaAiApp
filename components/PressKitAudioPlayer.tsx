import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

type Colors = {
  text: string;
  textSecondary: string;
  primary: string;
  surface: string;
  border: string;
  background: string;
};

function audioPage(uri: string): string {
  const src = uri.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html,body{margin:0;padding:0;background:transparent;height:100%;}
  body{display:flex;align-items:center;justify-content:center;}
  audio{width:100%;}
</style></head>
<body><audio src="${src}" controls autoplay playsinline></audio></body></html>`;
}

export default function PressKitAudioPlayer({
  visible,
  uri,
  title,
  artistName,
  colors,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  title: string;
  artistName?: string;
  colors: Colors;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.head}>
            <Text style={[styles.kicker, { color: colors.textSecondary }]}>Música</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {title}
          </Text>
          {artistName ? (
            <Text style={[styles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
              {artistName}
            </Text>
          ) : null}
          {visible && uri ? (
            <WebView
              source={{ html: audioPage(uri) }}
              style={styles.web}
              scrollEnabled={false}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              originWhitelist={['*']}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontSize: 17, fontWeight: '800' },
  artist: { fontSize: 14, marginTop: 4, marginBottom: 12 },
  web: { height: 56, backgroundColor: 'transparent', marginTop: 8 },
});
