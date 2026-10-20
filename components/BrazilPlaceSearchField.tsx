import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { searchBrazilPlaces, type BrazilPlace } from '../services/brazilPlacesService';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSelectPlace: (place: BrazilPlace) => void;
  placeholder?: string;
  compact?: boolean;
  editable?: boolean;
};

export default function BrazilPlaceSearchField({
  value,
  onChangeText,
  onSelectPlace,
  placeholder = 'Buscar cidade, rua ou CEP',
  compact = false,
  editable = true,
}: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BrazilPlace[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runSearch = (text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      const req = ++requestRef.current;
      void searchBrazilPlaces(q).then((places) => {
        if (req !== requestRef.current) return;
        setResults(places);
        setOpen(places.length > 0);
        setLoading(false);
      });
    }, 280);
  };

  const kindIcon = (kind: BrazilPlace['kind']) => {
    if (kind === 'street' || kind === 'cep') return 'navigate-outline' as const;
    if (kind === 'venue') return 'business-outline' as const;
    return 'location-outline' as const;
  };

  return (
    <View style={styles.wrap}>
      <View
        style={[
          compact ? styles.compactBox : styles.box,
          {
            backgroundColor: colors.surface,
            borderColor: value.trim() ? colors.primary : colors.border,
            opacity: editable ? 1 : 0.8,
          },
        ]}
      >
        <Ionicons
          name="location-outline"
          size={compact ? 15 : 18}
          color={colors.textSecondary}
        />
        <TextInput
          value={value}
          editable={editable}
          onChangeText={(text) => {
            onChangeText(text);
            if (editable) runSearch(text);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[compact ? styles.compactInput : styles.input, { color: colors.text }]}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
        />
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        {!loading && value.trim() && editable ? (
          <TouchableOpacity
            onPress={() => {
              onChangeText('');
              setResults([]);
              setOpen(false);
            }}
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={compact ? 15 : 18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {open && editable ? (
        <View
          style={[
            styles.dropdown,
            compact ? styles.dropdownCompact : null,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {results.map((place) => (
            <TouchableOpacity
              key={place.id}
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => {
                onSelectPlace(place);
                onChangeText(place.city);
                setOpen(false);
                setResults([]);
              }}
              activeOpacity={0.75}
            >
              <Ionicons name={kindIcon(place.kind)} size={16} color={colors.primary} />
              <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={2}>
                {place.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 4 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compactBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  compactInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  dropdown: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  dropdownCompact: {
    position: 'absolute',
    top: 36,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, fontSize: 14, lineHeight: 18 },
});
