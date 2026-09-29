import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Sobrevive ao remount das tabs (criar evento sai do provider). */
let rememberedViewedMonth = startOfMonth(new Date());
const viewedMonthListeners = new Set<(date: Date) => void>();

export function persistViewedMonth(date: Date): void {
  rememberedViewedMonth = startOfMonth(date);
  viewedMonthListeners.forEach((listener) => listener(rememberedViewedMonth));
}

export interface SharedTabMonthContextValue {
  /** Mês/ano exibidos na Agenda e no Financeiro (sempre dia 1). */
  viewedMonthDate: Date;
  setViewedMonthDate: (date: Date) => void;
  navigateMonth: (direction: 'prev' | 'next') => void;
}

const SharedTabMonthContext = createContext<SharedTabMonthContextValue | null>(
  null
);

export const SharedTabMonthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [viewedMonthDate, setViewedMonthDateState] = useState(
    () => rememberedViewedMonth,
  );

  useEffect(() => {
    const onRemembered = (date: Date) => {
      setViewedMonthDateState(date);
    };
    viewedMonthListeners.add(onRemembered);
    setViewedMonthDateState(rememberedViewedMonth);
    return () => {
      viewedMonthListeners.delete(onRemembered);
    };
  }, []);

  const setViewedMonthDate = useCallback((date: Date) => {
    persistViewedMonth(date);
  }, []);

  const navigateMonth = useCallback((direction: 'prev' | 'next') => {
    const y = rememberedViewedMonth.getFullYear();
    const m = rememberedViewedMonth.getMonth();
    const next = new Date(y, m, 1);
    if (direction === 'prev') {
      next.setMonth(m - 1);
    } else {
      next.setMonth(m + 1);
    }
    persistViewedMonth(next);
  }, []);

  const value = useMemo(
    () => ({
      viewedMonthDate,
      setViewedMonthDate,
      navigateMonth,
    }),
    [viewedMonthDate, setViewedMonthDate, navigateMonth]
  );

  return (
    <SharedTabMonthContext.Provider value={value}>
      {children}
    </SharedTabMonthContext.Provider>
  );
};

export function useSharedTabMonth(): SharedTabMonthContextValue {
  const ctx = useContext(SharedTabMonthContext);
  if (!ctx) {
    throw new Error(
      'useSharedTabMonth deve ser usado dentro de SharedTabMonthProvider'
    );
  }
  return ctx;
}
