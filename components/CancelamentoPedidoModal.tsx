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
  partnerName?: string | null;
  eventName?: string | null;
  onClose: () => void;
  onConversar?: () => void;
};

export default function CancelamentoPedidoModal({
  visible,
  partnerName,
  eventName,
  onClose,
  onConversar,
}: Props) {
  const { colors } = useTheme();
  const quem = partnerName?.trim() || 'a outra parte';
  const show = eventName?.trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
            <Ionicons name="paper-plane" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Pedido enviado</Text>
          <Text style={[styles.subtitle, { color: colors.primary }]}>Cancelamento em análise</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {show
              ? `${quem} foi avisado sobre o pedido de cancelamento de ${show}.`
              : `${quem} foi avisado sobre o pedido de cancelamento.`}{' '}
            A data permanece na agenda até aceitar ou contestar. Sem multa ou reembolso automático no app.
          </Text>

          {onConversar ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={onConversar}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>Conversar agora</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={onConversar ? styles.secondaryBtn : [styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text
              style={
                onConversar
                  ? [styles.secondaryText, { color: colors.textSecondary }]
                  : styles.primaryText
              }
            >
              Entendi
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
