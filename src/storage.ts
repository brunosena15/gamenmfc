const HIGH_SCORE_KEY = 'nmfc_penaltis_highscore';
const SOUND_ENABLED_KEY = 'nmfc_penaltis_sound';

export function getHighScore(): number {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(score: number): number {
  const current = getHighScore();
  const best = Math.max(current, Math.max(0, Math.floor(score)));
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(best));
  } catch {
    // Ignora caso o navegador bloqueie storage em modo privado
  }
  return best;
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
