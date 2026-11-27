const HIGH_SCORE_KEY = 'nmfc_penaltis_highscore';
const HIGH_SCORE_HOLDER_KEY = 'nmfc_penaltis_highscore_holder';
const SOUND_ENABLED_KEY = 'nmfc_penaltis_sound';
const GOALS_BY_CHAR_KEY = 'nmfc_penaltis_goals_by_char';
const UNLOCKED_CHARS_KEY = 'nmfc_penaltis_unlocked_chars';
const PLAYER_NICK_KEY = 'nmfc_penaltis_player_nick';
const LEADERBOARD_KEY = 'nmfc_penaltis_leaderboard';
const COPA_WINS_KEY = 'nmfc_penaltis_copa_wins';

export interface HighScoreRecord {
  score: number;
  playerName: string | null;
}

export interface LeaderboardEntry {
  nick: string;
  characterName: string;
  score: number;
  date: string;
}

export function getHighScoreRecord(): HighScoreRecord {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    const score = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const holder = window.localStorage.getItem(HIGH_SCORE_HOLDER_KEY)?.trim() || null;
    return {
      score,
      playerName: score > 0 ? holder : null,
    };
  } catch {
    return { score: 0, playerName: null };
  }
}

export function saveHighScoreRecord(score: number, playerName: string): HighScoreRecord {
  const current = getHighScoreRecord();
  const normalized = Math.max(0, Math.floor(score));

  if (normalized > current.score || (normalized > 0 && normalized === current.score && !current.playerName)) {
    const next: HighScoreRecord = {
      score: normalized,
      playerName: playerName.trim() || current.playerName,
    };
    try {
      window.localStorage.setItem(HIGH_SCORE_KEY, String(next.score));
      if (next.playerName) {
        window.localStorage.setItem(HIGH_SCORE_HOLDER_KEY, next.playerName);
      }
    } catch {
      // Ignora caso o navegador bloqueie storage em modo privado
    }
    return next;
  }

  return current;
}

export function getGoalsByCharacter(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(GOALS_BY_CHAR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        clean[k] = Math.floor(v);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function incrementCharacterGoals(characterId: string, amount = 1): number {
  const totals = getGoalsByCharacter();
  const next = (totals[characterId] ?? 0) + Math.max(1, Math.floor(amount));
  totals[characterId] = next;
  try {
    window.localStorage.setItem(GOALS_BY_CHAR_KEY, JSON.stringify(totals));
  } catch {
    // noop
  }
  return next;
}

export function getUnlockedCharacterIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(UNLOCKED_CHARS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === 'string'));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

export function unlockCharacter(characterId: string): boolean {
  const unlocked = getUnlockedCharacterIds();
  if (unlocked.has(characterId)) return false;
  unlocked.add(characterId);
  try {
    window.localStorage.setItem(UNLOCKED_CHARS_KEY, JSON.stringify(Array.from(unlocked)));
  } catch {
    // noop
  }
  return true;
}

export function hasCustomPlayerNick(): boolean {
  try {
    const raw = window.localStorage.getItem(PLAYER_NICK_KEY)?.trim();
    return Boolean(raw && raw.length > 0);
  } catch {
    return false;
  }
}

export function getPlayerNick(): string {
  try {
    return window.localStorage.getItem(PLAYER_NICK_KEY)?.trim() || 'Você';
  } catch {
    return 'Você';
  }
}

export function setPlayerNick(nick: string): string {
  const clean = nick.trim().slice(0, 18) || 'Você';
  try {
    window.localStorage.setItem(PLAYER_NICK_KEY, clean);
  } catch {
    // noop
  }
  return clean;
}

export function getLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is LeaderboardEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.nick === 'string' &&
          typeof e.characterName === 'string' &&
          typeof e.score === 'number' &&
          e.score > 0
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function addLeaderboardEntry(
  nick: string,
  characterName: string,
  score: number
): LeaderboardEntry[] {
  const normalized = Math.floor(score);
  const current = getLeaderboard();
  if (normalized <= 0) return current;

  const entry: LeaderboardEntry = {
    nick: nick.trim().slice(0, 18) || 'Você',
    characterName,
    score: normalized,
    date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  };

  const next = [...current, entry]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  try {
    window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(next));
  } catch {
    // noop
  }
  return next;
}

export function getCopaWins(): number {
  try {
    const raw = window.localStorage.getItem(COPA_WINS_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function incrementCopaWins(): number {
  const next = getCopaWins() + 1;
  try {
    window.localStorage.setItem(COPA_WINS_KEY, String(next));
  } catch {
    // noop
  }
  return next;
}

export function getSoundEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(SOUND_ENABLED_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  } catch {
    // noop
  }
}
