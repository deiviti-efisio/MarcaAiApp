import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

export interface ChipMultiSelectFieldProps {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (item: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onAddCustom: () => void;
  addSectionLabel: string;
  addPlaceholder: string;
  /** Mesma lista de sugestões do convite (ex.: `ARTIST_WORK_ROLE_PRESETS`): carrossel no topo; a grade mostra só o que for extra. */
  presetStrip?: readonly string[];
  /** Só carrossel horizontal + campo para digitar, sem grade. */
  horizontalOnly?: boolean;
}

export function ChipMultiSelectField({
  title,
  options,
  selected,
  onToggle,
  draft,
  onDraftChange,
  onAddCustom,
  addSectionLabel,
  addPlaceholder,
  presetStrip,
  horizontalOnly = false,
}: ChipMultiSelectFieldProps) {
  const { colors } = useTheme();

  const presetSet = presetStrip?.length ? new Set(presetStrip) : null;
  const gridOptions = horizontalOnly
    ? []
    : presetSet
      ? options.filter((o) => !presetSet.has(o))
      : options;
  const stripOptions = (() => {
    const base = presetStrip?.length ? [...presetStrip] : [];
    if (!horizontalOnly) return base;
    selected.forEach((item) => {
      if (!base.includes(item)) base.push(item);
    });
    return base;
  })();

  const subtitle =
    selected.length === 0
      ? horizontalOnly || presetStrip?.length
        ? 'Deslize na horizontal para escolher, ou digite outra função.'
        : 'Toque nos chips para selecionar — pode marcar várias opções'
      : `${selected.length} selecionado${selected.length !== 1 ? 's' : ''}`;

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>

      <View
        style={[
          styles.card,
          {
            borderColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        {stripOptions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetStripRow}
            keyboardShouldPersistTaps="handled"
          >
            {stripOptions.map((opt) => {
              const on = selected.includes(opt);
              return (
                <TouchableOpacity
                  key={`strip-${opt}`}
                  style={[
                    styles.presetChip,
                    {
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? `${colors.primary}18` : colors.surface,
                    },
                  ]}
                  onPress={() => onToggle(opt)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      { color: on ? colors.primary : colors.text, fontWeight: on ? '800' : '600' },
                    ]}
                    numberOfLines={1}
                  >
                    {opt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {gridOptions.length > 0 ? (
          <View
            style={[
              styles.chipWrap,
              presetStrip?.length
                ? [styles.chipWrapBelowStrip, { borderTopColor: colors.border }]
                : null,
            ]}
          >
            {gridOptions.map((opt) => {
              const on = selected.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.chip,
                    {
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary : colors.surface,
                    },
                  ]}
                  onPress={() => onToggle(opt)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, { color: on ? '#fff' : colors.text }]} numberOfLines={2}>
                    {opt}
                  </Text>
                  {on ? (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" style={styles.chipCheck} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <View style={[styles.addBlock, { borderTopColor: colors.border }]}>
          <Text style={[styles.addLabel, { color: colors.text }]}>{addSectionLabel}</Text>
          <View style={styles.addRow}>
            <TextInput
              style={[
                styles.addInput,
                { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text },
              ]}
              value={draft}
              onChangeText={onDraftChange}
              placeholder={addPlaceholder}
              placeholderTextColor={colors.textSecondary}
              onSubmitEditing={onAddCustom}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={onAddCustom}
            >
              <Text style={styles.addButtonText}>Adicionar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    overflow: 'hidden',
  },
  presetStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    paddingRight: 2,
  },
  presetChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  presetChipText: { fontSize: 12, maxWidth: 200 },
  chipWrapBelowStrip: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 8,
    width: '49%',
    minHeight: 42,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    flex: 1,
  },
  chipCheck: {
    marginLeft: 6,
  },
  addBlock: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
    marginRight: 10,
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
