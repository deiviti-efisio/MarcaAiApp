import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

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
  /** Lista vertical com busca (melhor para muitas funções). */
  filteredList?: boolean;
  openListLabel?: string;
  searchPlaceholder?: string;
  emptyListLabel?: string;
  emptyFieldLabel?: string;
  fieldIcon?: React.ComponentProps<typeof Ionicons>['name'];
  hint?: string;
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
  filteredList = false,
  openListLabel = 'Buscar e marcar',
  searchPlaceholder = 'Filtrar...',
  emptyListLabel = 'Nada encontrado. Digite para incluir outra opção.',
  emptyFieldLabel = 'Selecione',
  fieldIcon = 'list-outline',
  hint,
}: ChipMultiSelectFieldProps) {
  const { colors } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const presetSet = presetStrip?.length ? new Set(presetStrip) : null;
  const gridOptions = horizontalOnly || filteredList
    ? []
    : presetSet
      ? options.filter((o) => !presetSet.has(o))
      : options;
  const stripOptions = (() => {
    if (filteredList) return [];
    const base = presetStrip?.length ? [...presetStrip] : [];
    if (!horizontalOnly) return base;
    selected.forEach((item) => {
      if (!base.includes(item)) base.push(item);
    });
    return base;
  })();

  const listOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    [...options, ...selected].forEach((item) => {
      if (!item || seen.has(item)) return;
      seen.add(item);
      out.push(item);
    });
    return out;
  }, [options, selected]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return listOptions;
    return listOptions.filter((item) => normalizeSearch(item).includes(q));
  }, [listOptions, query]);

  const customQuery = query.trim();
  const showCustomOption =
    customQuery.length >= 2 &&
    !listOptions.some((item) => normalizeSearch(item) === normalizeSearch(customQuery));

  const subtitle = selected.length === 0
    ? filteredList
      ? 'Toque para abrir a lista e filtrar pelo nome.'
      : horizontalOnly || presetStrip?.length
        ? 'Deslize na horizontal para escolher, ou digite outra função.'
        : 'Toque nos chips para selecionar — pode marcar várias opções'
    : `${selected.length} selecionado${selected.length !== 1 ? 's' : ''}`;

  const addCustomFromQuery = () => {
    if (!showCustomOption) return;
    onToggle(customQuery);
    setQuery('');
  };

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {hint && !filteredList ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
      ) : null}
      {!filteredList ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      ) : null}

      {filteredList ? (
        <TouchableOpacity
          style={[
            styles.styleField,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
          onPress={() => {
            setQuery('');
            setPickerOpen(true);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name={fieldIcon} size={20} color={colors.textSecondary} style={styles.fieldIcon} />
          <Text
            style={[
              styles.fieldValue,
              { color: selected.length ? colors.text : colors.textSecondary },
            ]}
            numberOfLines={1}
          >
            {selected.length ? selected.join(', ') : emptyFieldLabel}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
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
      )}

      <Modal
        visible={filteredList && pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={12} accessibilityLabel="Fechar">
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.search,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              autoCorrect={false}
              autoCapitalize="sentences"
            />
            {showCustomOption ? (
              <TouchableOpacity
                style={[styles.customRow, { backgroundColor: colors.background }]}
                onPress={addCustomFromQuery}
                activeOpacity={0.75}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={[styles.customRowText, { color: colors.text }]}>
                  Incluir &quot;{customQuery}&quot;
                </Text>
              </TouchableOpacity>
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => {
                const on = selected.includes(item);
                return (
                  <TouchableOpacity
                    style={[
                      styles.row,
                      { borderBottomColor: colors.border },
                      on && { backgroundColor: `${colors.primary}18` },
                    ]}
                    onPress={() => onToggle(item)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.rowText, { color: colors.text }]}>{item}</Text>
                    {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                showCustomOption ? null : (
                  <Text style={[styles.empty, { color: colors.textSecondary }]}>
                    {emptyListLabel}
                  </Text>
                )
              }
            />
            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: colors.primary }]}
              onPress={() => setPickerOpen(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.doneBtnText}>
                {selected.length ? `Pronto (${selected.length})` : 'Pronto'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  hint: {
    fontSize: 13,
    lineHeight: 18,
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
  styleField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    height: 56,
  },
  fieldIcon: {
    marginRight: 12,
  },
  fieldValue: {
    flex: 1,
    fontSize: 16,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '85%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  search: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  customRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontSize: 16, flex: 1, paddingRight: 8 },
  empty: { textAlign: 'center', padding: 24, fontSize: 15 },
  doneBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
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
