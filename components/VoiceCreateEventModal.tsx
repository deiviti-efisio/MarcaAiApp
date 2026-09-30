import { Ionicons } from "@expo/vector-icons";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../contexts/ThemeContext";
import { formatCurrencyBRLFromAmount } from "../utils/currencyBRLInput";
import {
  parseSpokenEvent,
  spokenDraftToRouteParams,
  type SpokenEventDraft,
} from "../utils/parseSpokenEvent";

type Props = {
  visible: boolean;
  fallbackDate: Date;
  onClose: () => void;
  onConfirm: (routeParams: Record<string, string>, draft: SpokenEventDraft) => void;
  confirmLabel?: string;
};

function mergeUtterance(base: string, piece: string): string {
  const a = base.trim();
  const b = piece.trim();
  if (!b) return a;
  if (!a) return b;
  if (b.startsWith(a) || b.includes(a)) return b;
  if (a.includes(b)) return a;
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

function formatIsoDateBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function VoiceCreateEventModal({
  visible,
  fallbackDate,
  onClose,
  onConfirm,
  confirmLabel = "Preencher",
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<SpokenEventDraft | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const committedRef = useRef("");
  const fallbackDateRef = useRef(fallbackDate);
  fallbackDateRef.current = fallbackDate;

  const applyText = useCallback((text: string) => {
    committedRef.current = text;
    setTranscript(text);
    if (text.trim()) {
      setDraft(parseSpokenEvent(text, fallbackDateRef.current));
    } else {
      setDraft(null);
    }
  }, []);

  const reset = useCallback(() => {
    committedRef.current = "";
    setListening(false);
    setBusy(false);
    setTranscript("");
    setDraft(null);
    setErrorText(null);
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* módulo ainda não ligado */
    }
  }, []);

  useSpeechRecognitionEvent("start", () => {
    setListening(true);
    setBusy(false);
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setBusy(false);
  });
  useSpeechRecognitionEvent("result", (event) => {
    const piece = event.results?.[0]?.transcript?.trim() ?? "";
    if (!piece) return;
    const next = mergeUtterance(committedRef.current, piece);
    if (event.isFinal) committedRef.current = next;
    setTranscript(next);
    setDraft(parseSpokenEvent(next, fallbackDateRef.current));
    setErrorText(null);
  });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    setBusy(false);
    if (event.error === "aborted") return;
    const msg =
      event.error === "not-allowed"
        ? "Permita o microfone nas configurações."
        : event.error === "no-speech"
          ? "Não ouvi. Toque no microfone e fale de novo."
          : event.message || "Não foi possível ouvir.";
    setErrorText(msg);
  });

  const startListening = useCallback(async () => {
    committedRef.current = "";
    setTranscript("");
    setDraft(null);
    setErrorText(null);
    setBusy(true);
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* ignore */
    }
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setBusy(false);
        Alert.alert("Microfone", "Permita o microfone para falar o evento.");
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: "pt-BR",
        interimResults: true,
        continuous: true,
        addsPunctuation: false,
        contextualStrings: [
          "evento",
          "show",
          "ensaio",
          "reunião",
          "valor",
          "cache",
          "edite",
          "altere o nome",
          "já pago",
          "pago antecipado",
          "adiantado",
          "a confirmar",
          "despesa",
          "transporte",
          "alimentação",
          "whatsapp",
        ],
      });
    } catch {
      setBusy(false);
      setListening(false);
      setErrorText("Sem áudio neste aparelho. Escreva na caixa.");
    }
  }, []);

  const stopListening = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setListening(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      reset();
      return;
    }
    const t = setTimeout(() => {
      void startListening();
    }, 350);
    return () => clearTimeout(t);
  }, [reset, startListening, visible]);

  const handleConfirm = () => {
    const source = transcript.trim();
    if (!source) {
      Alert.alert("Fale o evento", "Ex.: 10 de outubro, valor 2000, despesa transporte 150");
      return;
    }
    stopListening();
    const parsed = parseSpokenEvent(source, fallbackDateRef.current);
    onConfirm(spokenDraftToRouteParams(parsed), parsed);
  };

  const handleClose = () => {
    stopListening();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* ignore */
    }
    onClose();
  };

  const chips: string[] = [];
  if (draft?.nome && draft.nome !== "Show") chips.push(draft.nome);
  if (draft?.dateMentioned) chips.push(formatIsoDateBr(draft.dataISO));
  if (draft?.startHHmm) {
    chips.push(
      draft.endHHmm ? `${draft.startHHmm}–${draft.endHHmm}` : draft.startHHmm,
    );
  }
  if (draft?.cidade) chips.push(draft.cidade);
  if (draft?.estadoUf) chips.push(draft.estadoUf);
  if (draft?.valor != null) chips.push(formatCurrencyBRLFromAmount(draft.valor));
  if (draft?.valorPago != null) {
    chips.push(`Pago ${formatCurrencyBRLFromAmount(draft.valorPago)}`);
  }
  if (draft?.despesas?.length) {
    chips.push(
      `${draft.despesas.length} despesa${draft.despesas.length > 1 ? "s" : ""}`,
    );
  }
  if (draft?.tag === "ensaio") chips.push("Ensaio");
  if (draft?.tag === "reunião") chips.push("Reunião");
  if (draft && !draft.confirmed) chips.push("A confirmar");
  if (draft?.telefone) chips.push(draft.telefone);

  const canFill = transcript.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />

            <View style={styles.topRow}>
              <Text style={[styles.title, { color: colors.text }]}>Falar</Text>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Fechar"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={listening ? stopListening : () => void startListening()}
              disabled={busy && !listening}
              activeOpacity={0.85}
              accessibilityLabel={listening ? "Parar" : "Falar"}
              style={[
                styles.micCircle,
                { backgroundColor: listening ? "#e53e3e" : colors.primary },
              ]}
            >
              {busy && !listening ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <Ionicons name={listening ? "stop" : "mic"} size={36} color="#fff" />
              )}
            </TouchableOpacity>
            <Text style={[styles.micStatus, { color: colors.text }]}>
              {listening ? "Ouvindo… toque para parar" : "Toque e fale"}
            </Text>
            <Text style={[styles.micHint, { color: colors.textSecondary }]}>
              Cada toque limpa o texto. Diga o evento, ou: altere o nome para…
            </Text>

            <TextInput
              value={transcript}
              onChangeText={applyText}
              multiline
              placeholder="O que você falar aparece aqui. Pode editar."
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: listening ? colors.primary : colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

            {chips.length > 0 ? (
              <View style={styles.chips}>
                {chips.map((chip, i) => (
                  <View
                    key={`${chip}-${i}`}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: colors.text }]}>{chip}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.confirm,
                { backgroundColor: canFill ? colors.primary : colors.border },
              ]}
              onPress={handleConfirm}
              disabled={!canFill}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetWrap: {
    width: "100%",
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  micCircle: {
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  micStatus: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 16,
    fontWeight: "700",
  },
  micHint: {
    textAlign: "center",
    marginTop: 4,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 14,
    minHeight: 88,
    maxHeight: 140,
    padding: 14,
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 22,
  },
  error: {
    color: "#e53e3e",
    marginTop: 8,
    fontSize: 13,
    textAlign: "center",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  confirm: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  confirmText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
