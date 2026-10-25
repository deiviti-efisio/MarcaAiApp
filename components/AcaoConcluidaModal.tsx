import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

type Props = {
  visible: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string | null;
  message: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  closeLabel?: string;
  onClose: () => void;
};

export default function AcaoConcluidaModal({
  visible,
  icon = 'checkmark-circle',
  title,
  subtitle,
  message,
  primaryLabel,
  onPrimary,
  closeLabel = 'Entendi',
  onClose,
}: Props) {
  const { colors } = useTheme();
  const hasPrimary = !!onPrimary && !!primaryLabel;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
            <Ionicons name={icon} size={34} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.primary }]}>{subtitle}</Text>
          ) : null}
          <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

          {hasPrimary ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={onPrimary}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>{primaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={hasPrimary ? styles.secondaryBtn : [styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text
              style={hasPrimary ? [styles.secondaryText, { color: colors.textSecondary }] : styles.primaryText}
            >
              {closeLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: Dimensions.get('window').width - 40,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.22,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
