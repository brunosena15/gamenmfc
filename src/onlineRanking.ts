import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface OnlineRankingEntry {
  id: number;
  nick: string;
  characterName: string;
  score: number;
  date: string;
  createdAt: string;
}

export type RealtimeStatus = 'unconfigured' | 'connecting' | 'live' | 'online' | 'offline';

interface RankingRow {
  id: number;
  nick: string;
  character_name: string;
  score: number;
  created_at: string;
}

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL?.trim() ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const TABLE_NAME = 'nmfc_ranking';

let client: SupabaseClient | null = null;

export function isOnlineRankingConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getClient(): SupabaseClient | null {
  if (!isOnlineRankingConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 4,
        },
      },
    });
  }
  return client;
}

function mapRow(row: RankingRow): OnlineRankingEntry {
  const dt = new Date(row.created_at);
  const date = Number.isNaN(dt.getTime())
    ? ''
    : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return {
    id: row.id,
    nick: row.nick,
    characterName: row.character_name,
    score: row.score,
    date,
    createdAt: row.created_at,
  };
}

export async function fetchGlobalRanking(limit = 15): Promise<OnlineRankingEntry[]> {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from(TABLE_NAME)
    .select('id, nick, character_name, score, created_at')
    .order('score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error || !data) {
    console.warn('[NMFC Ranking] Erro ao buscar ranking:', error);
    throw error ?? new Error('Falha ao buscar ranking online.');
  }

  return (data as RankingRow[]).map(mapRow);
}

export async function submitGlobalScore(
  nick: string,
  characterName: string,
  score: number
): Promise<OnlineRankingEntry | null> {
  const sb = getClient();
  const normalizedScore = Math.floor(score);
  if (!sb || normalizedScore <= 0 || normalizedScore > 500) return null;

  const cleanNick = nick.trim().slice(0, 18) || 'Jogador';
  const cleanChar = characterName.trim().slice(0, 24) || 'Atleta';

  const { data, error } = await sb
    .from(TABLE_NAME)
    .insert({
      nick: cleanNick,
      character_name: cleanChar,
      score: normalizedScore,
    })
    .select('id, nick, character_name, score, created_at')
    .single();

  if (error || !data) {
    console.warn('[NMFC Ranking] Erro ao enviar placar:', error);
    throw error ?? new Error('Falha ao enviar pontuação online.');
  }

  return mapRow(data as RankingRow);
}

export interface GlobalRankingSubscription {
  refresh: () => Promise<void>;
  unsubscribe: () => void;
}

export function subscribeGlobalRanking(
  onUpdate: (entries: OnlineRankingEntry[]) => void,
  onStatusChange?: (status: RealtimeStatus) => void
): GlobalRankingSubscription {
  const sb = getClient();
  if (!sb) {
    onStatusChange?.('unconfigured');
    return {
      refresh: async () => {},
      unsubscribe: () => {},
    };
  }

  let active = true;
  let wsConnected = false;
  let restHealthy = false;
  let pollTimer: number | null = null;

  const emitStatus = () => {
    if (!active) return;
    if (wsConnected) {
      onStatusChange?.('live');
    } else if (restHealthy) {
      onStatusChange?.('online');
    } else {
      onStatusChange?.('offline');
    }
  };

  onStatusChange?.('connecting');

  const refresh = async (): Promise<void> => {
    try {
      const entries = await fetchGlobalRanking(15);
      if (!active) return;
      restHealthy = true;
      onUpdate(entries);
      emitStatus();
    } catch {
      if (!active) return;
      restHealthy = false;
      emitStatus();
    }
  };

  void refresh();

  const channel: RealtimeChannel = sb
    .channel('nmfc-ranking-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: TABLE_NAME,
      },
      () => {
        void refresh();
      }
    )
    .subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        wsConnected = true;
        emitStatus();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Se o WebSocket cair em redes móveis/iOS, não marca offline se o REST HTTPS estiver funcionando!
        wsConnected = false;
        void refresh();
      }
    });

  // Fallback suave por polling a cada 15s caso o WebSocket não esteja ativo (ex: 4G restritivo)
  pollTimer = window.setInterval(() => {
    if (!active || document.hidden || wsConnected) return;
    void refresh();
  }, 15000);

  const handleResume = () => {
    if (!active || document.hidden) return;
    void refresh();
  };

  window.addEventListener('online', handleResume);
  document.addEventListener('visibilitychange', handleResume);

  return {
    refresh,
    unsubscribe: () => {
      active = false;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      window.removeEventListener('online', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
      void sb.removeChannel(channel);
    },
  };
}
