import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import {
  contarMensagensNaoLidas,
  subscribeConversasRealtime,
} from './supabase/conversaArtistaService';

export function useUnreadConversas() {
  const isFocused = useIsFocused();
  const { activeArtist } = useActiveArtistContext();
  const [unreadChats, setUnreadChats] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshUnreadChats = useCallback(async () => {
    if (!isFocused || !activeArtist?.id) {
      if (!activeArtist?.id) setUnreadChats(0);
      return;
    }
    const count = await contarMensagensNaoLidas(activeArtist.id);
    setUnreadChats(count);
  }, [activeArtist?.id, isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    void refreshUnreadChats();
    if (!activeArtist?.id) return;

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void refreshUnreadChats();
      }, 250);
    };

    const unsubscribe = subscribeConversasRealtime({
      meuArtistaId: activeArtist.id,
      onChange: schedule,
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsubscribe();
    };
  }, [activeArtist?.id, isFocused, refreshUnreadChats]);

  return { unreadChats, refreshUnreadChats };
}
