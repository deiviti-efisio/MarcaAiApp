import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { BRAZIL_STATES, formatBrazilStateChoice, type BrazilState } from '../lib/brazilGeo';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

export default function BrazilStatePickerModal({
  visible,
  onClose,
  selectedUf,
  onSelect,
  todosLabel,
}: {
  visible: boolean;
  onClose: () => void;
  selectedUf: string;
  /** `null` = limpar seleção */
  onSelect: (uf: string | null) => void;
  todosLabel?: string;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BRAZIL_STATES;
    return BRAZIL_STATES.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.uf.toLowerCase().includes(q)
    );
  }, [query]);

  const renderItem = ({ item }: { item: BrazilState }) => {
    const selected = item.uf === selectedUf;
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: colors.border },
          selected && { backgroundColor: colors.primary + '18' },
        ]}
        onPress={() => {
          onSelect(item.uf);
          setQuery('');
          onClose();
        }}
        activeOpacity={0.75}
      >
        <Text style={[styles.rowText, { color: colors.text }]}>
          {item.name} ({item.uf})
        </Text>
        {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Estado (UF)</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Fechar">
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
            placeholder="Buscar por nome ou sigla..."
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {todosLabel || selectedUf ? (
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.border }]}
              onPress={() => {
                onSelect(null);
                setQuery('');
                onClose();
              }}
            >
              <Text style={{ color: colors.primary, fontWeight: '700' }}>
                {todosLabel || 'Limpar estado'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.uf}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textSecondary }]}>Nenhum estado encontrado.</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

export function BrazilStateFieldButton({
  selectedUf,
  onPress,
  colors,
}: {
  selectedUf: string;
  onPress: () => void;
  colors: ThemeColors;
}) {
  const label = selectedUf ? formatBrazilStateChoice(selectedUf) : 'Toque para escolher (opcional)';
  return (
    <TouchableOpacity
      style={[styles.fieldBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Ionicons name="location-outline" size={20} color={colors.primary} />
      <Text style={[styles.fieldBtnText, { color: selectedUf ? colors.text : colors.textSecondary }]}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={18} color={colors.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700' },
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
  clearBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  list: { flexGrow: 0 },
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
  fieldBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldBtnText: { flex: 1, fontSize: 16 },
});
