import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
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

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function FeedFuncaoPickerModal({
  visible,
  onClose,
  options,
  selectedFuncao,
  onSelect,
  title = 'Filtrar por função',
  searchPlaceholder = 'Buscar ou digitar função...',
  clearLabel = 'Todas funções',
  emptyLabel = 'Nenhuma função encontrada. Digite para filtrar por outro termo.',
}: {
  visible: boolean;
  onClose: () => void;
  options: string[];
  selectedFuncao: string;
  onSelect: (funcao: string) => void;
  title?: string;
  searchPlaceholder?: string;
  clearLabel?: string;
  emptyLabel?: string;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return options;
    return options.filter((item) => normalizeSearch(item).includes(q));
  }, [options, query]);

  const customQuery = query.trim();
  const showCustomOption =
    customQuery.length >= 2 &&
    !options.some((item) => normalizeSearch(item) === normalizeSearch(customQuery));

  const renderItem = ({ item }: { item: string }) => {
    const selected = item === selectedFuncao;
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: colors.border },
          selected && { backgroundColor: `${colors.primary}18` },
        ]}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
        activeOpacity={0.75}
      >
        <Text style={[styles.rowText, { color: colors.text }]}>{item}</Text>
        {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
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
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="sentences"
          />
          {selectedFuncao ? (
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.border }]}
              onPress={() => {
                onSelect('');
                onClose();
              }}
            >
              <Text style={{ color: colors.error, fontWeight: '600' }}>{clearLabel}</Text>
            </TouchableOpacity>
          ) : null}
          {showCustomOption ? (
            <TouchableOpacity
              style={[styles.customRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => {
                onSelect(customQuery);
                onClose();
              }}
              activeOpacity={0.75}
            >
              <Ionicons name="search" size={18} color={colors.primary} />
              <Text style={[styles.customRowText, { color: colors.text }]}>
                Filtrar por &quot;{customQuery}&quot;
              </Text>
            </TouchableOpacity>
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              showCustomOption
                ? null
                : (
                    <Text style={[styles.empty, { color: colors.textSecondary }]}>
                      {emptyLabel}
                    </Text>
                  )
            }
          />
        </View>
      </View>
    </Modal>
  );
}

export function FeedFuncaoFieldButton({
  selectedFuncao,
  onPress,
  colors,
  emptyLabel = 'Todas funções',
  icon = 'pricetag-outline',
}: {
  selectedFuncao: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  emptyLabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const label = selectedFuncao || emptyLabel;
  return (
    <TouchableOpacity
      style={[
        styles.fieldBtn,
        {
          backgroundColor: colors.surface,
          borderColor: selectedFuncao ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text
        style={[styles.fieldBtnText, { color: selectedFuncao ? colors.text : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
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
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
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
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  fieldBtnText: { flex: 1, fontSize: 14, fontWeight: '700' },
});
