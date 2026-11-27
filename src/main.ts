import './styles.css';
import { soundEngine } from './audio';
import { CHARACTERS, GOALKEEPER_IMAGE_URL, type CharacterDef } from './characters';
import { PenaltyGame, type CopaSnapshot, type GameMode, type GameOverInfo } from './game';
import {
  isOnlineRankingConfigured,
  submitGlobalScore,
  subscribeGlobalRanking,
  type GlobalRankingSubscription,
  type OnlineRankingEntry,
  type RealtimeStatus,
} from './onlineRanking';
import {
  getCharacterSprites,
  getGoalkeeperSprites,
  type CharacterSprites,
} from './spriteExtractor';
import {
  addLeaderboardEntry,
  getCopaWins,
  getGoalsByCharacter,
  getHighScoreRecord,
  getLeaderboard,
  getPlayerNick,
  getUnlockedCharacterIds,
  incrementCharacterGoals,
  incrementCopaWins,
  saveHighScoreRecord,
  setPlayerNick,
  unlockCharacter,
  type HighScoreRecord,
} from './storage';

const GAME_SHARE_URL = 'https://brunosena15.github.io/gamenmfc/';

const screenSelect = document.getElementById('screen-select') as HTMLElement;
const screenGame = document.getElementById('screen-game') as HTMLElement;
const characterGrid = document.getElementById('character-grid') as HTMLElement;

const selectHighScoreEl = document.getElementById('select-highscore') as HTMLElement;
const selectHighScoreHolderEl = document.getElementById('select-highscore-holder') as HTMLElement;
const btnModeInfinite = document.getElementById('btn-mode-infinite') as HTMLButtonElement;
const btnModeCopa = document.getElementById('btn-mode-copa') as HTMLButtonElement;
const btnStartGame = document.getElementById('btn-start-game') as HTMLButtonElement;
const btnSoundSelect = document.getElementById('btn-sound-select') as HTMLButtonElement;
const btnSoundGame = document.getElementById('btn-sound-game') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;

// Ranking modal
const btnRanking = document.getElementById('btn-ranking') as HTMLButtonElement;
const overlayRanking = document.getElementById('overlay-ranking') as HTMLElement;
const btnRefreshRanking = document.getElementById('btn-refresh-ranking') as HTMLButtonElement;
const btnCloseRanking = document.getElementById('btn-close-ranking') as HTMLButtonElement;
const rankingLiveBadge = document.getElementById('ranking-live-badge') as HTMLElement;
const tabRankingGlobal = document.getElementById('tab-ranking-global') as HTMLButtonElement;
const tabRankingLocal = document.getElementById('tab-ranking-local') as HTMLButtonElement;
const inputNick = document.getElementById('input-nick') as HTMLInputElement;
const rankingCopaWinsEl = document.getElementById('ranking-copa-wins') as HTMLElement;
const rankingListEl = document.getElementById('ranking-list') as HTMLOListElement;
const rankingEmptyEl = document.getElementById('ranking-empty') as HTMLElement;

// HUD
const hudScoreboardInfinite = document.getElementById('hud-scoreboard-infinite') as HTMLElement;
const hudScoreboardCopa = document.getElementById('hud-scoreboard-copa') as HTMLElement;
const copaDotsPlayerEl = document.getElementById('copa-dots-player') as HTMLElement;
const copaDotsCpuEl = document.getElementById('copa-dots-cpu') as HTMLElement;
const copaScorePlayerEl = document.getElementById('copa-score-player') as HTMLElement;
const copaScoreCpuEl = document.getElementById('copa-score-cpu') as HTMLElement;

const hudScoreEl = document.getElementById('hud-score') as HTMLElement;
const hudHighScoreEl = document.getElementById('hud-highscore') as HTMLElement;
const hudHighScoreHolderEl = document.getElementById('hud-highscore-holder') as HTMLElement;
const hudPlayerRoleEl = document.getElementById('hud-player-role') as HTMLElement;
const hudPlayerNameEl = document.getElementById('hud-player-name') as HTMLElement;
const hudAvatarCanvas = document.getElementById('hud-avatar-canvas') as HTMLCanvasElement;
const badgeOnFire = document.getElementById('badge-onfire') as HTMLElement;
const badgeShield = document.getElementById('badge-shield') as HTMLElement;
const badgeParedao = document.getElementById('badge-paredao') as HTMLElement;
const controlsHint = document.getElementById('controls-hint') as HTMLElement;
const unlockToast = document.getElementById('unlock-toast') as HTMLElement;
const unlockToastName = document.getElementById('unlock-toast-name') as HTMLElement;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;

// Game Over
const overlayGameOver = document.getElementById('overlay-gameover') as HTMLElement;
const gameOverBadge = document.getElementById('gameover-badge') as HTMLElement;
const gameOverTitle = document.getElementById('gameover-title') as HTMLElement;
const gameOverSubtitle = document.getElementById('gameover-subtitle') as HTMLElement;
const gameOverLeftLabel = document.getElementById('gameover-left-label') as HTMLElement;
const gameOverRightLabel = document.getElementById('gameover-right-label') as HTMLElement;
const gameOverScore = document.getElementById('gameover-score') as HTMLElement;
const gameOverScorePlayer = document.getElementById('gameover-score-player') as HTMLElement;
const gameOverHighScore = document.getElementById('gameover-highscore') as HTMLElement;
const gameOverHighScoreHolder = document.getElementById('gameover-highscore-holder') as HTMLElement;
const gameOverNewRecord = document.getElementById('gameover-new-record') as HTMLElement;
const gameOverOnlineStatus = document.getElementById('gameover-online-status') as HTMLElement;
const btnShareWhatsapp = document.getElementById('btn-share-whatsapp') as HTMLButtonElement;
const btnRetry = document.getElementById('btn-retry') as HTMLButtonElement;
const btnChangePlayer = document.getElementById('btn-change-player') as HTMLButtonElement;

const SAVE_MESSAGES = [
  'O goleiro adivinhou o canto!',
  'Que defesaça do paredão!',
  'Não passou nem vento por ali!',
  'O goleiro leu seu movimento!',
];

const CAUS_RESENHA_MESSAGES = [
  'O goleiro já conhecia esse chute de cor, Caus!',
  'Nem na gaveta entra com o Caus hoje! 😂',
  'O goleiro leu até a alma do Caus!',
  'Defesaça impossível! Tente outro batedor... 👀',
];

let selectedMode: GameMode = 'infinite';
let selectedCharacter: CharacterDef | null = null;
let highScoreRecord: HighScoreRecord = getHighScoreRecord();
let goalsByCharacter: Record<string, number> = getGoalsByCharacter();
let unlockedCharacterIds: Set<string> = getUnlockedCharacterIds();
let unlockToastTimer: number | null = null;
let lastShareText = '';
let activeRankingTab: 'global' | 'local' = isOnlineRankingConfigured() ? 'global' : 'local';
let globalRankingEntries: OnlineRankingEntry[] = [];
let realtimeStatus: RealtimeStatus = isOnlineRankingConfigured() ? 'connecting' : 'unconfigured';
let lastSubmittedOnlineId: number | null = null;
let globalRankingSub: GlobalRankingSubscription | null = null;

const loadedSprites = new Map<string, CharacterSprites>();
let goalkeeperSpritesCache: CharacterSprites | null = null;

function isCharacterUnlocked(char: CharacterDef): boolean {
  if (!char.unlockRule) return true;
  if (unlockedCharacterIds.has(char.id)) return true;
  const progress = goalsByCharacter[char.unlockRule.requiredCharacterId] ?? 0;
  return progress >= char.unlockRule.requiredGoals;
}

function showUnlockToast(char: CharacterDef): void {
  unlockToastName.textContent = char.name;
  unlockToast.hidden = false;

  if (unlockToastTimer !== null) {
    window.clearTimeout(unlockToastTimer);
  }
  unlockToastTimer = window.setTimeout(() => {
    unlockToast.hidden = true;
    unlockToastTimer = null;
  }, 3400);
}

function checkSecretUnlocks(scorerId: string, goalsAdded: number): void {
  const totalGoals = incrementCharacterGoals(scorerId, goalsAdded);
  goalsByCharacter[scorerId] = totalGoals;

  for (const char of CHARACTERS) {
    if (!char.unlockRule) continue;
    if (char.unlockRule.requiredCharacterId !== scorerId) continue;
    if (totalGoals >= char.unlockRule.requiredGoals) {
      const newlyUnlocked = unlockCharacter(char.id);
      unlockedCharacterIds.add(char.id);
      if (newlyUnlocked) {
        window.setTimeout(() => {
          soundEngine.playUnlock();
          showUnlockToast(char);
        }, 380);
      }
    }
  }
}

function syncCpuOpponents(): void {
  const rivals = CHARACTERS.filter((c) => c.id !== selectedCharacter?.id).map((def) => ({
    def,
    sprites: loadedSprites.get(def.id) ?? null,
  }));
  game.setCpuOpponents(rivals);
}

function renderCopaBoard(copa: CopaSnapshot): void {
  const totalSlots = Math.max(5, copa.playerResults.length, copa.cpuResults.length);

  const renderDots = (container: HTMLElement, results: Array<'goal' | 'miss'>) => {
    container.innerHTML = '';
    for (let i = 0; i < totalSlots; i++) {
      const dot = document.createElement('span');
      dot.className = 'copa-dot';
      if (results[i] === 'goal') dot.classList.add('goal');
      if (results[i] === 'miss') dot.classList.add('miss');
      container.appendChild(dot);
    }
  };

  renderDots(copaDotsPlayerEl, copa.playerResults);
  renderDots(copaDotsCpuEl, copa.cpuResults);

  const pGoals = copa.playerResults.filter((r) => r === 'goal').length;
  const cGoals = copa.cpuResults.filter((r) => r === 'goal').length;
  copaScorePlayerEl.textContent = String(pGoals);
  copaScoreCpuEl.textContent = String(cGoals);

  if (copa.turn === 'cpu') {
    hudPlayerRoleEl.textContent = 'GOLEIRO (VOCÊ)';
    hudPlayerNameEl.textContent = `VS ${copa.cpuName}`;
    drawHudAvatar(goalkeeperSpritesCache);
  } else if (selectedCharacter) {
    hudPlayerRoleEl.textContent = copa.suddenDeath ? 'MORTE SÚBITA' : `COBRANÇA ${copa.round}`;
    hudPlayerNameEl.textContent = selectedCharacter.name;
    drawHudAvatar(loadedSprites.get(selectedCharacter.id) ?? null);
  }
}

const game = new PenaltyGame(gameCanvas, {
  onScoreChange: (score, goalsAdded, isNewRecord) => {
    hudScoreEl.textContent = String(score);
    triggerScoreBump(hudScoreEl);

    if (selectedCharacter) {
      checkSecretUnlocks(selectedCharacter.id, goalsAdded);
    }

    if (selectedMode === 'infinite' && (isNewRecord || score > highScoreRecord.score)) {
      highScoreRecord = saveHighScoreRecord(score, selectedCharacter?.name ?? '');
      syncHighScoreUI();
      triggerScoreBump(hudHighScoreEl);
    }
  },
  onHudStatusChange: (status) => {
    badgeOnFire.hidden = !(status.mode === 'infinite' && status.onFire);
    badgeShield.hidden = !(status.mode === 'infinite' && status.hasShield);
    badgeParedao.hidden = !(status.mode === 'infinite' && status.paredao);

    if (status.mode === 'copa' && status.copa) {
      hudScoreboardInfinite.hidden = true;
      hudScoreboardCopa.hidden = false;
      renderCopaBoard(status.copa);
    } else {
      hudScoreboardInfinite.hidden = false;
      hudScoreboardCopa.hidden = true;
      if (selectedCharacter) {
        hudPlayerRoleEl.textContent = 'BATEDOR';
        hudPlayerNameEl.textContent = selectedCharacter.name;
        drawHudAvatar(loadedSprites.get(selectedCharacter.id) ?? null);
      }
    }
  },
  onGameOver: (info) => {
    if (info.mode === 'infinite') {
      highScoreRecord = saveHighScoreRecord(info.finalScore, selectedCharacter?.name ?? '');
      if (info.finalScore > 0 && selectedCharacter) {
        const nick = getPlayerNick();
        addLeaderboardEntry(nick, selectedCharacter.name, info.finalScore);
        void sendScoreToGlobalRanking(nick, selectedCharacter.name, info.finalScore);
      } else {
        gameOverOnlineStatus.hidden = true;
      }
      syncHighScoreUI();
    } else {
      gameOverOnlineStatus.hidden = true;
      if (info.reason === 'copa-win') {
        incrementCopaWins();
      }
    }
    showGameOver(info);
  },
  onFirstKick: () => {
    controlsHint.classList.add('hidden');
  },
});

function triggerScoreBump(el: HTMLElement): void {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function syncHighScoreUI(): void {
  const val = String(highScoreRecord.score);
  const holder = highScoreRecord.score > 0 ? highScoreRecord.playerName : null;

  selectHighScoreEl.textContent = val;
  hudHighScoreEl.textContent = val;

  if (holder) {
    selectHighScoreHolderEl.textContent = holder;
    selectHighScoreHolderEl.hidden = false;

    hudHighScoreHolderEl.textContent = holder;
    hudHighScoreHolderEl.hidden = false;
  } else {
    selectHighScoreHolderEl.hidden = true;
    hudHighScoreHolderEl.hidden = true;
  }
}

function syncSoundButtons(): void {
  const icon = soundEngine.isEnabled() ? '🔊' : '🔇';
  btnSoundSelect.textContent = icon;
  btnSoundGame.textContent = icon;
}

function drawHudAvatar(sprites: CharacterSprites | null): void {
  const ctx = hudAvatarCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, hudAvatarCanvas.width, hudAvatarCanvas.height);
  if (!sprites) return;
  ctx.drawImage(sprites.avatar, 0, 0, hudAvatarCanvas.width, hudAvatarCanvas.height);
}

function attachSpritePreview(spriteBox: HTMLElement, sprites: CharacterSprites): void {
  const preview = document.createElement('canvas');
  preview.className = 'char-sprite-canvas';
  preview.width = sprites.front.width;
  preview.height = sprites.front.height;
  preview.getContext('2d')?.drawImage(sprites.front, 0, 0);

  spriteBox.innerHTML = '';
  spriteBox.appendChild(preview);
}

function renderCharacterCards(): void {
  characterGrid.innerHTML = '';

  CHARACTERS.forEach((char) => {
    const unlocked = isCharacterUnlocked(char);
    const isSelected = unlocked && selectedCharacter?.id === char.id;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'char-card';
    if (!unlocked) card.classList.add('locked');
    if (isSelected) card.classList.add('selected');
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(isSelected));
    card.setAttribute('aria-disabled', String(!unlocked));
    card.dataset.charId = char.id;

    if (unlocked && char.unlockRule) {
      const badge = document.createElement('span');
      badge.className = 'char-secret-badge';
      badge.textContent = 'SECRETO';
      card.appendChild(badge);
    }

    const spriteBox = document.createElement('div');
    spriteBox.className = 'char-sprite-box';

    const cached = loadedSprites.get(char.id);
    if (cached) {
      attachSpritePreview(spriteBox, cached);
    } else {
      const loader = document.createElement('div');
      loader.className = 'char-loading';
      spriteBox.appendChild(loader);
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'char-name';
    nameEl.textContent = unlocked ? char.name : '???';

    card.appendChild(spriteBox);
    card.appendChild(nameEl);

    if (!unlocked && char.unlockRule) {
      const progress = Math.min(
        char.unlockRule.requiredGoals,
        goalsByCharacter[char.unlockRule.requiredCharacterId] ?? 0
      );

      const lockOverlay = document.createElement('div');
      lockOverlay.className = 'char-lock-overlay';
      lockOverlay.innerHTML = `
        <span class="char-lock-icon">🔒</span>
        <span class="char-lock-hint">Faça ${char.unlockRule.requiredGoals} gols com ${char.unlockRule.requiredCharacterName}</span>
        <span class="char-lock-progress">${progress}/${char.unlockRule.requiredGoals}</span>
      `;
      card.appendChild(lockOverlay);
    }

    card.addEventListener('click', () => {
      soundEngine.unlock();
      if (!unlocked) {
        soundEngine.playLocked();
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        return;
      }
      soundEngine.playSelect();
      selectCharacter(char);
    });

    characterGrid.appendChild(card);

    if (!cached) {
      getCharacterSprites(char.imageUrl)
        .then((sprites) => {
          loadedSprites.set(char.id, sprites);
          if (spriteBox.isConnected) {
            attachSpritePreview(spriteBox, sprites);
          }
          syncCpuOpponents();

          if (selectedCharacter?.id === char.id && screenGame.classList.contains('active')) {
            game.updateSprites(sprites);
            drawHudAvatar(sprites);
          }
        })
        .catch(() => {
          if (!spriteBox.isConnected) return;
          const img = document.createElement('img');
          img.src = char.imageUrl;
          img.alt = unlocked ? char.name : 'Personagem secreto';
          img.className = 'char-sprite-canvas';
          spriteBox.innerHTML = '';
          spriteBox.appendChild(img);
        });
    }
  });
}

function updateStartButtonText(): void {
  if (!selectedCharacter) {
    btnStartGame.disabled = true;
    btnStartGame.textContent = 'SELECIONE UM BATEDOR';
    return;
  }
  btnStartGame.disabled = false;
  btnStartGame.textContent =
    selectedMode === 'copa'
      ? `JOGAR COPA COM ${selectedCharacter.name.toUpperCase()}`
      : `BATER COM ${selectedCharacter.name.toUpperCase()}`;
}

function selectCharacter(char: CharacterDef): void {
  if (!isCharacterUnlocked(char)) return;
  selectedCharacter = char;

  characterGrid.querySelectorAll<HTMLButtonElement>('.char-card').forEach((card) => {
    const isSel = card.dataset.charId === char.id;
    card.classList.toggle('selected', isSel);
    card.setAttribute('aria-checked', String(isSel));
  });

  updateStartButtonText();

  if (char.goalSoundUrl) {
    soundEngine.preloadCustomSound(char.goalSoundUrl);
  }
}

function setMode(mode: GameMode): void {
  selectedMode = mode;
  btnModeInfinite.classList.toggle('active', mode === 'infinite');
  btnModeInfinite.setAttribute('aria-selected', String(mode === 'infinite'));
  btnModeCopa.classList.toggle('active', mode === 'copa');
  btnModeCopa.setAttribute('aria-selected', String(mode === 'copa'));
  updateStartButtonText();
}

function startGame(): void {
  if (!selectedCharacter) return;

  soundEngine.unlock();
  overlayGameOver.hidden = true;
  unlockToast.hidden = true;
  controlsHint.classList.remove('hidden');

  hudScoreEl.textContent = '0';
  hudPlayerRoleEl.textContent = 'BATEDOR';
  hudPlayerNameEl.textContent = selectedCharacter.name;
  syncHighScoreUI();
  syncCpuOpponents();

  screenSelect.classList.remove('active');
  screenGame.classList.add('active');

  const sprites = loadedSprites.get(selectedCharacter.id) ?? null;
  drawHudAvatar(sprites);

  requestAnimationFrame(() => {
    if (!selectedCharacter) return;
    game.startSession(selectedCharacter, sprites, highScoreRecord.score, selectedMode);
  });
}

function showSelectScreen(): void {
  soundEngine.playSelect();
  overlayGameOver.hidden = true;
  unlockToast.hidden = true;
  game.stop();
  screenGame.classList.remove('active');
  screenSelect.classList.add('active');
  syncHighScoreUI();
  renderCharacterCards();
}

function showGameOver(info: GameOverInfo): void {
  const playerName = selectedCharacter?.name ?? 'Atleta';
  gameOverBadge.classList.remove('badge-win');

  if (info.mode === 'copa') {
    const won = info.reason === 'copa-win';
    const pGoals = info.copaPlayerGoals ?? 0;
    const cGoals = info.copaCpuGoals ?? 0;

    gameOverBadge.textContent = won ? '🏆 CAMPEÃO DA COPA!' : 'FIM DA COPA 5x5';
    if (won) gameOverBadge.classList.add('badge-win');
    gameOverTitle.textContent = won ? 'É CAMPEÃO!' : 'Eliminado nos Pênaltis!';
    gameOverSubtitle.textContent = won
      ? `${playerName} levantou a taça da Copa NMFC!`
      : info.isCaus
        ? CAUS_RESENHA_MESSAGES[Math.floor(Math.random() * CAUS_RESENHA_MESSAGES.length)]
        : 'O PC levou a melhor dessa vez!';

    gameOverLeftLabel.textContent = 'VOCÊ';
    gameOverRightLabel.textContent = 'PC';
    gameOverScore.textContent = String(pGoals);
    gameOverScorePlayer.textContent = `com ${playerName}`;
    gameOverHighScore.textContent = String(cGoals);
    gameOverHighScoreHolder.textContent = 'Computador';
    gameOverHighScoreHolder.hidden = false;
    gameOverNewRecord.hidden = !won;
    gameOverNewRecord.textContent = `🏆 TÍTULOS NA COPA: ${getCopaWins()}`;

    lastShareText = won
      ? `🏆 Fui CAMPEÃO da Copa 5x5 (${pGoals}x${cGoals}) com ${playerName} no NMFC Pênaltis! Quero ver ganhar! ⚽🔥 ${GAME_SHARE_URL}`
      : `⚽ Disputa tensa (${pGoals}x${cGoals}) na Copa 5x5 do NMFC Pênaltis com ${playerName}! Vem jogar: ${GAME_SHARE_URL}`;
  } else {
    gameOverBadge.textContent =
      info.reason === 'post' ? 'BOLA NA TRAVE!' : 'DEFESA DO GOLEIRO!';
    gameOverTitle.textContent =
      info.finalScore === 0
        ? 'Zero no Placar!'
        : info.finalScore >= 5
          ? 'Bela Sequência!'
          : 'Fim de Sequência';

    if (info.isCaus) {
      gameOverSubtitle.textContent =
        CAUS_RESENHA_MESSAGES[Math.floor(Math.random() * CAUS_RESENHA_MESSAGES.length)];
    } else if (info.reason === 'post') {
      gameOverSubtitle.textContent = 'Explodiu na trave e saiu!';
    } else {
      gameOverSubtitle.textContent =
        SAVE_MESSAGES[Math.floor(Math.random() * SAVE_MESSAGES.length)];
    }

    gameOverLeftLabel.textContent = 'GOLS SEGUIDOS';
    gameOverRightLabel.textContent = 'RECORDE';
    gameOverScore.textContent = String(info.finalScore);
    gameOverScorePlayer.textContent = `com ${playerName}`;
    gameOverHighScore.textContent = String(highScoreRecord.score);
    if (highScoreRecord.score > 0 && highScoreRecord.playerName) {
      gameOverHighScoreHolder.textContent = `com ${highScoreRecord.playerName}`;
      gameOverHighScoreHolder.hidden = false;
    } else {
      gameOverHighScoreHolder.hidden = true;
    }

    gameOverNewRecord.textContent = '⭐ NOVO RECORDE PESSOAL!';
    gameOverNewRecord.hidden = !(info.isNewRecord && info.finalScore > 0);

    const holderNote =
      highScoreRecord.score > 0 && highScoreRecord.playerName
        ? ` (Recorde: ${highScoreRecord.score} com ${highScoreRecord.playerName})`
        : '';
    lastShareText = info.isCaus
      ? `😂 Tentei bater pênalti com o Caus no NMFC Pênaltis e fiz ${info.finalScore} gols! Quero ver quem consegue marcar com ele! 🧤 ${GAME_SHARE_URL}`
      : `⚽ Fiz ${info.finalScore} ${info.finalScore === 1 ? 'gol' : 'gols seguidos'} com ${playerName} no NMFC Pênaltis!${holderNote} Quero ver bater! 🏆🔥 ${GAME_SHARE_URL}`;
  }

  overlayGameOver.hidden = false;
}

function syncRealtimeBadge(): void {
  if (activeRankingTab !== 'global') {
    rankingLiveBadge.hidden = true;
    return;
  }

  rankingLiveBadge.hidden = false;
  rankingLiveBadge.classList.remove('offline');
  if (realtimeStatus === 'live') {
    rankingLiveBadge.textContent = '🟢 AO VIVO';
  } else if (realtimeStatus === 'online') {
    rankingLiveBadge.textContent = '🟢 ONLINE';
  } else if (realtimeStatus === 'connecting') {
    rankingLiveBadge.textContent = '🟡 CONECTANDO...';
  } else if (realtimeStatus === 'unconfigured') {
    rankingLiveBadge.textContent = '⚙️ OFFLINE';
    rankingLiveBadge.classList.add('offline');
  } else {
    rankingLiveBadge.textContent = '⚪ SEM CONEXÃO';
    rankingLiveBadge.classList.add('offline');
  }
}

async function sendScoreToGlobalRanking(
  nick: string,
  characterName: string,
  score: number
): Promise<void> {
  if (!isOnlineRankingConfigured()) {
    gameOverOnlineStatus.hidden = true;
    return;
  }

  gameOverOnlineStatus.textContent = '🌍 Enviando para o Ranking Global...';
  gameOverOnlineStatus.hidden = false;

  try {
    const saved = await submitGlobalScore(nick, characterName, score);
    if (saved) {
      lastSubmittedOnlineId = saved.id;
      await globalRankingSub?.refresh();
      const rankIdx = globalRankingEntries.findIndex((e) => e.id === saved.id);
      const posText = rankIdx >= 0 ? ` (#${rankIdx + 1} no Top 15!)` : '!';
      gameOverOnlineStatus.textContent = `🌍 Salvo no Ranking Global${posText}`;
    } else {
      gameOverOnlineStatus.hidden = true;
    }
  } catch {
    gameOverOnlineStatus.textContent = '📱 Salvo no Ranking Local (sem conexão online)';
  }
}

function setRankingTab(tab: 'global' | 'local'): void {
  activeRankingTab = tab;
  tabRankingGlobal.classList.toggle('active', tab === 'global');
  tabRankingGlobal.setAttribute('aria-selected', String(tab === 'global'));
  tabRankingLocal.classList.toggle('active', tab === 'local');
  tabRankingLocal.setAttribute('aria-selected', String(tab === 'local'));
  renderRankingModal();
}

function renderRankingModal(): void {
  inputNick.value = getPlayerNick();
  rankingCopaWinsEl.textContent = String(getCopaWins());
  syncRealtimeBadge();

  rankingListEl.innerHTML = '';

  if (activeRankingTab === 'global') {
    if (!isOnlineRankingConfigured()) {
      rankingEmptyEl.textContent =
        'Ranking Global pronto para conectar! Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Supabase/GitHub Secrets (use a aba Local enquanto isso).';
      rankingEmptyEl.hidden = false;
      return;
    }

    if (globalRankingEntries.length === 0) {
      rankingEmptyEl.textContent =
        realtimeStatus === 'connecting'
          ? 'Carregando placar global...'
          : realtimeStatus === 'offline'
            ? 'Sem conexão com o servidor. Toque em ↻ para tentar novamente.'
            : 'Nenhum placar global ainda. Seja o 1º a inaugurar o Ranking NMFC!';
      rankingEmptyEl.hidden = false;
      return;
    }

    rankingEmptyEl.hidden = true;
    const medals = ['🥇', '🥈', '🥉'];
    globalRankingEntries.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'ranking-item';
      if (item.id === lastSubmittedOnlineId) li.classList.add('is-mine');
      const pos = medals[idx] ?? `${idx + 1}º`;
      li.innerHTML = `
        <div class="ranking-item-left">
          <span class="ranking-pos">${pos}</span>
          <div class="ranking-meta">
            <span class="ranking-nick"></span>
            <span class="ranking-char"></span>
          </div>
        </div>
        <strong class="ranking-score">${item.score} ⚽</strong>
      `;
      (li.querySelector('.ranking-nick') as HTMLElement).textContent = item.nick;
      (li.querySelector('.ranking-char') as HTMLElement).textContent =
        `com ${item.characterName}${item.date ? ` • ${item.date}` : ''}`;
      rankingListEl.appendChild(li);
    });
    return;
  }

  const list = getLeaderboard();
  if (list.length === 0) {
    rankingEmptyEl.textContent =
      'Nenhuma sequência registrada neste aparelho ainda. Bata uns pênaltis para entrar no Top 10!';
    rankingEmptyEl.hidden = false;
    return;
  }

  rankingEmptyEl.hidden = true;
  const medals = ['🥇', '🥈', '🥉'];

  list.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    const pos = medals[idx] ?? `${idx + 1}º`;
    li.innerHTML = `
      <div class="ranking-item-left">
        <span class="ranking-pos">${pos}</span>
        <div class="ranking-meta">
          <span class="ranking-nick"></span>
          <span class="ranking-char"></span>
        </div>
      </div>
      <strong class="ranking-score">${item.score} ⚽</strong>
    `;
    (li.querySelector('.ranking-nick') as HTMLElement).textContent = item.nick;
    (li.querySelector('.ranking-char') as HTMLElement).textContent =
      `com ${item.characterName} • ${item.date}`;
    rankingListEl.appendChild(li);
  });
}

async function shareOnWhatsapp(): Promise<void> {
  soundEngine.playSelect();
  const text = lastShareText || `⚽ Vem jogar NMFC Pênaltis! ${GAME_SHARE_URL}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'NMFC Pênaltis', text });
      return;
    } catch {
      // Usuário cancelou ou fallback para WhatsApp URL
    }
  }

  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
}

// Eventos
btnModeInfinite.addEventListener('click', () => {
  soundEngine.unlock();
  soundEngine.playSelect();
  setMode('infinite');
});

btnModeCopa.addEventListener('click', () => {
  soundEngine.unlock();
  soundEngine.playSelect();
  setMode('copa');
});

btnRanking.addEventListener('click', () => {
  soundEngine.unlock();
  soundEngine.playSelect();
  setRankingTab(activeRankingTab);
  overlayRanking.hidden = false;
  if (activeRankingTab === 'global') {
    void globalRankingSub?.refresh();
  }
});

btnRefreshRanking.addEventListener('click', () => {
  soundEngine.playSelect();
  if (activeRankingTab === 'global' && isOnlineRankingConfigured()) {
    realtimeStatus = 'connecting';
    syncRealtimeBadge();
    void globalRankingSub?.refresh();
  } else {
    renderRankingModal();
  }
});

tabRankingGlobal.addEventListener('click', () => {
  soundEngine.playSelect();
  setRankingTab('global');
  void globalRankingSub?.refresh();
});

tabRankingLocal.addEventListener('click', () => {
  soundEngine.playSelect();
  setRankingTab('local');
});

btnCloseRanking.addEventListener('click', () => {
  soundEngine.playSelect();
  overlayRanking.hidden = true;
});

overlayRanking.addEventListener('click', (e) => {
  if (e.target === overlayRanking) {
    overlayRanking.hidden = true;
  }
});

inputNick.addEventListener('change', () => {
  inputNick.value = setPlayerNick(inputNick.value);
});

btnShareWhatsapp.addEventListener('click', () => {
  void shareOnWhatsapp();
});

btnStartGame.addEventListener('click', startGame);
btnBack.addEventListener('click', showSelectScreen);

btnRetry.addEventListener('click', () => {
  soundEngine.playSelect();
  startGame();
});

btnChangePlayer.addEventListener('click', showSelectScreen);

[btnSoundSelect, btnSoundGame].forEach((btn) => {
  btn.addEventListener('click', () => {
    soundEngine.toggle();
    syncSoundButtons();
  });
});

// Inicialização
syncHighScoreUI();
syncSoundButtons();
renderCharacterCards();

if (isOnlineRankingConfigured()) {
  globalRankingSub = subscribeGlobalRanking(
    (entries) => {
      globalRankingEntries = entries;
      if (!overlayRanking.hidden && activeRankingTab === 'global') {
        renderRankingModal();
      }
      if (lastSubmittedOnlineId !== null && !overlayGameOver.hidden) {
        const idx = entries.findIndex((e) => e.id === lastSubmittedOnlineId);
        if (idx >= 0) {
          gameOverOnlineStatus.textContent = `🌍 Salvo no Ranking Global (#${idx + 1} no Top 15!)`;
        }
      }
    },
    (status) => {
      realtimeStatus = status;
      if (!overlayRanking.hidden) {
        syncRealtimeBadge();
      }
    }
  );
  window.addEventListener('beforeunload', () => {
    globalRankingSub?.unsubscribe();
  });
}

if (GOALKEEPER_IMAGE_URL) {
  getGoalkeeperSprites(GOALKEEPER_IMAGE_URL)
    .then((sprites) => {
      goalkeeperSpritesCache = sprites;
      game.setGoalkeeperSprites(sprites);
    })
    .catch(() => {});
}

// Registro do Service Worker para instalação PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
