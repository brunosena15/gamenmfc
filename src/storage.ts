const HIGH_SCORE_KEY = 'nmfc_penaltis_highscore';
const HIGH_SCORE_HOLDER_KEY = 'nmfc_penaltis_highscore_holder';
const SOUND_ENABLED_KEY = 'nmfc_penaltis_sound';

export interface HighScoreRecord {
  score: number;
  playerName: string | null;
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
