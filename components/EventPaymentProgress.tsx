import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { extractNumericValueString } from '../utils/currencyBRLInput';

export function parseOptionalPaidAmount(formatted: string): number | null {
  const raw = extractNumericValueString(formatted);
  if (!raw) return null;
  const amount = parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function getEventPaymentProgress(
  eventValue: unknown,
  paidAmount: unknown,
): { percent: number; paid: number; total: number } | null {
  const paid = typeof paidAmount === 'string' ? parseFloat(paidAmount) : Number(paidAmount);
  const total = typeof eventValue === 'string' ? parseFloat(eventValue) : Number(eventValue);
  if (!Number.isFinite(paid) || paid <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const percent = Math.min(100, Math.max(0, Math.round((paid / total) * 100)));
  return { percent, paid, total };
}

export function getUnpaidRemainder(
  eventValue: unknown,
  paidAmount: unknown,
): number | null {
  const progress = getEventPaymentProgress(eventValue, paidAmount);
  if (!progress) return null;
  const rest = Math.round((progress.total - progress.paid) * 100) / 100;
  if (rest <= 0) return null;
  return rest;
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export default function EventPaymentProgress({
  eventValue,
  paidAmount,
  barColor,
  trackColor,
  textColor,
  compact = false,
}: {
  eventValue?: unknown;
  paidAmount?: unknown;
  barColor: string;
  trackColor: string;
  textColor: string;
  compact?: boolean;
}) {
  const progress = getEventPaymentProgress(eventValue, paidAmount);
  if (!progress) return null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: barColor,
              width: `${progress.percent}%`,
            },
          ]}
        />
      </View>
      <Text style={[styles.label, { color: textColor }]}>
        Você já recebeu {progress.percent}% - {formatBRL(progress.paid)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    marginBottom: 18,
    width: '100%',
  },
  wrapCompact: {
    marginTop: 8,
    marginBottom: 10,
  },
  track: {
    height: 8,
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 99,
  },
  label: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
});
