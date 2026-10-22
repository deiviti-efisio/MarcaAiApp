import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

type Step = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
};

const STEPS: Step[] = [
  {
    icon: 'megaphone-outline',
    title: 'Oferecendo ou Procurando',
    text: 'Publique disponibilidade (artista, banda, serviço) ou anuncie um evento e receba candidatos.',
  },
  {
    icon: 'people-outline',
    title: 'Candidaturas em privado',
    text: 'Todo mundo vê quantas pessoas se interessaram. Só o dono da publicação vê nomes e fotos.',
  },
  {
    icon: 'calendar-outline',
    title: 'Ao aceitar',
    text: 'O evento entra na agenda dos dois artistas e o cachê vira despesa automaticamente.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Editar e encerrar',
    text: 'Com candidatos, o anúncio não pode mais ser editado. Dá para encerrar e publicar de novo, se precisar mudar a data.',
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function FeedComoFuncionaModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const maxH = Math.round(Dimensions.get('window').height * 0.82);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              maxHeight: maxH,
            },
          ]}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
          >
            <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
              <Ionicons name="newspaper-outline" size={30} color={colors.primary} />
            </View>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.text }]}>Como funciona o Feed</Text>
            </View>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Um mural para oferecer ou procurar artista, banda, músico e serviço. Na aba Artistas você vê quem está perto.
            </Text>

            {STEPS.map((step) => (
              <View key={step.title} style={styles.stepRow}>
                <View style={[styles.stepIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <Ionicons name={step.icon} size={18} color={colors.primary} />
                </View>
                <View style={styles.stepCopy}>
                  <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                  <Text style={[styles.stepText, { color: colors.textSecondary }]}>{step.text}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>Entendi</Text>
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
    maxWidth: 400,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.22,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  scroll: {
    paddingBottom: 8,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  betaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  betaBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 18,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepCopy: { flex: 1 },
  stepTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  stepText: {
    fontSize: 13,
    lineHeight: 18,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 6,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
});
