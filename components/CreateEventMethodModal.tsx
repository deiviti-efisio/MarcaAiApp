import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useTheme } from "../contexts/ThemeContext";

type Props = {
  visible: boolean;
  onClose: () => void;
  onChooseForm: () => void;
  onChooseVoice: () => void;
};

export default function CreateEventMethodModal({
  visible,
  onClose,
  onChooseForm,
  onChooseVoice,
}: Props) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>Novo evento</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Preencha o formulário ou fale os dados (data, valor, cidade). Você revisa
            antes de salvar.
          </Text>

          <TouchableOpacity
            style={[styles.option, { backgroundColor: colors.primary }]}
            onPress={onChooseForm}
            activeOpacity={0.85}
          >
            <Ionicons name="create-outline" size={22} color="#fff" />
            <Text style={styles.optionText}>Preencher formulário</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.option,
              styles.optionSecondary,
              { borderColor: colors.primary },
            ]}
            onPress={onChooseVoice}
            activeOpacity={0.85}
          >
            <Ionicons name="mic-outline" size={22} color={colors.primary} />
            <Text style={[styles.optionText, { color: colors.primary }]}>
              Criar com áudio
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.cancel}>
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
              Cancelar
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
    justifyContent: "center",
    alignItems: "center",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  card: {
    width: "88%",
    borderRadius: 16,
    padding: 20,
    zIndex: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
  },
  optionSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
  },
  optionText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 15,
  },
});
