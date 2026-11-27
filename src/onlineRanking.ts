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

function normalizeSupabaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';

  // Se o usuário colou a URL do dashboard (https://supabase.com/dashboard/project/<ref>/...),
  // converte automaticamente para a Project API URL (https://<ref>.supabase.co)
  const dashMatch = url.match(/supabase\.com\/dashboard\/project\/([a-z0-9-]+)/i);
  if (dashMatch?.[1]) {
    return `https://${dashMatch[1]}.supabase.co`;
  }

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  // Remove qualquer subcaminho extra (ex: /rest/v1, /rest/v1/nmfc_ranking), mantendo só o origin
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL ?? '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const TABLE_NAME = 'nmfc_ranking';

let client: SupabaseClient | null = null;
let lastConnectionError: string | null = null;

export function getLastConnectionError(): string | null {
  return lastConnectionError;
}

export function isOnlineRankingConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function formatErrorMessage(err: unknown): string {
  if (!err) return 'Erro desconhecido';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as { code?: string; message?: string; details?: string; hint?: string; status?: number };
    const msg = obj.message || obj.details || '';
    if (obj.code === '42P01' || obj.code === 'PGRST205') {
      return 'Tabela nmfc_ranking não encontrada no Supabase (rode o supabase-setup.sql).';
    }
    if (obj.code === '42501') {
      return 'Sem permissão RLS na tabela nmfc_ranking (rode o supabase-setup.sql).';
    }
    if (/invalid api key|jwt|secret api key/i.test(msg)) {
      return `Chave inválida: use a chave pública "anon" ou "publishable" (${msg}).`;
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return `Falha de rede ao acessar ${SUPABASE_URL || 'Supabase'} (${msg}).`;
    }
    return [obj.code, msg].filter(Boolean).join(': ') || 'Erro ao conectar no Supabase.';
  }
  return 'Erro ao conectar no Supabase.';
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
    lastConnectionError = formatErrorMessage(error);
    console.warn('[NMFC Ranking] Erro ao buscar ranking:', error);
    throw error ?? new Error(lastConnectionError);
  }

  lastConnectionError = null;
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
    lastConnectionError = formatErrorMessage(error);
    console.warn('[NMFC Ranking] Erro ao enviar placar:', error);
    throw error ?? new Error(lastConnectionError);
  }

  lastConnectionError = null;
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
    } catch (err) {
      if (!active) return;
      lastConnectionError = formatErrorMessage(err);
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
        wsConnected = false;
        void refresh();
      }
    });

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
