import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface PropostaEnviadaModalProps {
  visible: boolean;
  onClose: () => void;
  onVerConvites: () => void;
  onDesfazer?: () => void;
  isDemanda?: boolean;
  podeDesfazer?: boolean;
  desfazendo?: boolean;
}

export default function PropostaEnviadaModal({
  visible,
  onClose,
  onVerConvites,
  onDesfazer,
  isDemanda = false,
  podeDesfazer = false,
  desfazendo = false,
}: PropostaEnviadaModalProps) {
  const { colors } = useTheme();
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!visible) setConfirmando(false);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
            <Ionicons
              name={confirmando ? 'arrow-undo' : 'checkmark-circle'}
              size={36}
              color={colors.primary}
            />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>
            {confirmando ? 'Desfazer proposta?' : 'Proposta já enviada'}
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {confirmando
              ? 'Ela some para o anunciante e você pode enviar outra depois, se quiser.'
              : 'Você já enviou interesse nesta oportunidade. O anunciante pode aceitar, ou você acompanha em Convites. Enquanto estiver pendente, dá para desfazer.'}
          </Text>

          {confirmando ? (
            <>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.error, opacity: desfazendo ? 0.7 : 1 }]}
                onPress={onDesfazer}
                disabled={desfazendo}
                activeOpacity={0.85}
              >
                {desfazendo ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>Confirmar desfazer</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setConfirmando(false)}
                disabled={desfazendo}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>Manter proposta</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {isDemanda ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={onVerConvites}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryText}>Ver convites</Text>
                </TouchableOpacity>
              ) : null}
              {podeDesfazer && onDesfazer ? (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setConfirmando(true)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryText, { color: colors.error }]}>Desfazer proposta</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={
                  isDemanda
                    ? styles.secondaryBtn
                    : [styles.primaryBtn, { backgroundColor: colors.primary }]
                }
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text
                  style={
                    isDemanda
                      ? [styles.secondaryText, { color: colors.textSecondary }]
                      : styles.primaryText
                  }
                >
                  Entendi
                </Text>
              </TouchableOpacity>
            </>
          )}
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
    paddingBottom: 16,
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
