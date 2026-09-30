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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';

export interface PremiumTrialUpsellModalProps {
  visible: boolean;
  onClose: () => void;
  onSubscribe: () => void;
  /** Texto principal explicando o limite do trial ou próximo passo */
  message: string;
  /** Título curto; padrão orientado a trial */
  title?: string;
}

/**
 * Upsell visual para quando o trial financeiro acaba ou recurso exige Premium.
 * Substitui Alert.alert por um cartão alinhado ao tema do app.
 */
export default function PremiumTrialUpsellModal({
  visible,
  onClose,
  onSubscribe,
  message,
  title = 'Seu teste gratuito acabou',
}: PremiumTrialUpsellModalProps) {
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const maxW = Math.min(Dimensions.get('window').width - 48, 360);

  const accentGold = '#D97706';
  const headerTint = isDarkMode ? `${colors.primary}35` : `${colors.primary}18`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              maxWidth: maxW,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={[styles.headerBand, { backgroundColor: headerTint }]}>
            <View
              style={[
                styles.iconRing,
                {
                  borderColor: `${accentGold}55`,
                  backgroundColor: isDarkMode ? 'rgba(217,119,6,0.12)' : '#FFFBEB',
                },
              ]}
            >
              <Ionicons name="diamond" size={36} color={accentGold} />
            </View>
            <View style={styles.sparkleRow}>
              <Ionicons name="sparkles" size={16} color={colors.primary} />
              <Text style={[styles.sparkleLabel, { color: colors.primary }]}>MeuShow Premium</Text>
              <Ionicons name="sparkles" size={16} color={colors.primary} />
            </View>
          </View>

          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

            <View style={[styles.perks, { backgroundColor: colors.background }]}>
              <View style={styles.perkRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.perkText, { color: colors.text }]}>Exportações ilimitadas</Text>
              </View>
              <View style={styles.perkRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.perkText, { color: colors.text }]}>Detalhes financeiros sem limite</Text>
              </View>
              <View style={styles.perkRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.perkText, { color: colors.text }]}>Mais artistas e time ampliado</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                onClose();
                onSubscribe();
              }}
              activeOpacity={0.88}
            >
              <Text style={styles.primaryBtnText}>Ver planos Premium</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} hitSlop={12}>
              <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>Agora não</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: Platform.OS === 'android' ? 6 : 0,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: Platform.OS === 'ios' ? 0.2 : 0,
    shadowRadius: 24,
  },
  headerBand: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sparkleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sparkleLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 22,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 18,
  },
  perks: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 10,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  perkText: {
    fontSize: 14,
    flex: 1,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
