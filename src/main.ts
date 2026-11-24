import './styles.css';
import { soundEngine } from './audio';
import { CHARACTERS, GOALKEEPER_IMAGE_URL, type CharacterDef } from './characters';
import { PenaltyGame } from './game';
import {
  getCharacterSprites,
  getGoalkeeperSprites,
  type CharacterSprites,
} from './spriteExtractor';
import {
  getGoalsByCharacter,
  getHighScoreRecord,
  getUnlockedCharacterIds,
  incrementCharacterGoals,
  saveHighScoreRecord,
  unlockCharacter,
  type HighScoreRecord,
} from './storage';

const screenSelect = document.getElementById('screen-select') as HTMLElement;
const screenGame = document.getElementById('screen-game') as HTMLElement;
const characterGrid = document.getElementById('character-grid') as HTMLElement;

const selectHighScoreEl = document.getElementById('select-highscore') as HTMLElement;
const selectHighScoreHolderEl = document.getElementById('select-highscore-holder') as HTMLElement;
const btnStartGame = document.getElementById('btn-start-game') as HTMLButtonElement;
const btnSoundSelect = document.getElementById('btn-sound-select') as HTMLButtonElement;
const btnSoundGame = document.getElementById('btn-sound-game') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;

const hudScoreEl = document.getElementById('hud-score') as HTMLElement;
const hudHighScoreEl = document.getElementById('hud-highscore') as HTMLElement;
const hudHighScoreHolderEl = document.getElementById('hud-highscore-holder') as HTMLElement;
const hudPlayerNameEl = document.getElementById('hud-player-name') as HTMLElement;
const hudAvatarCanvas = document.getElementById('hud-avatar-canvas') as HTMLCanvasElement;
const controlsHint = document.getElementById('controls-hint') as HTMLElement;
const unlockToast = document.getElementById('unlock-toast') as HTMLElement;
const unlockToastName = document.getElementById('unlock-toast-name') as HTMLElement;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const overlayGameOver = document.getElementById('overlay-gameover') as HTMLElement;
const gameOverTitle = document.getElementById('gameover-title') as HTMLElement;
const gameOverSubtitle = document.getElementById('gameover-subtitle') as HTMLElement;
const gameOverScore = document.getElementById('gameover-score') as HTMLElement;
const gameOverScorePlayer = document.getElementById('gameover-score-player') as HTMLElement;
const gameOverHighScore = document.getElementById('gameover-highscore') as HTMLElement;
const gameOverHighScoreHolder = document.getElementById('gameover-highscore-holder') as HTMLElement;
const gameOverNewRecord = document.getElementById('gameover-new-record') as HTMLElement;
const btnRetry = document.getElementById('btn-retry') as HTMLButtonElement;
const btnChangePlayer = document.getElementById('btn-change-player') as HTMLButtonElement;

const SAVE_MESSAGES = [
  'O goleiro adivinhou o canto!',
  'Que defesaça do paredão!',
  'Não passou nem vento por ali!',
  'O goleiro leu seu movimento!',
];

let selectedCharacter: CharacterDef | null = null;
let highScoreRecord: HighScoreRecord = getHighScoreRecord();
let goalsByCharacter: Record<string, number> = getGoalsByCharacter();
let unlockedCharacterIds: Set<string> = getUnlockedCharacterIds();
let unlockToastTimer: number | null = null;

const loadedSprites = new Map<string, CharacterSprites>();

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

function checkSecretUnlocks(scorerId: string): void {
  const totalGoals = incrementCharacterGoals(scorerId);
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

const game = new PenaltyGame(gameCanvas, {
  onScoreChange: (score, isNewRecord) => {
    hudScoreEl.textContent = String(score);
    triggerScoreBump(hudScoreEl);

    if (selectedCharacter) {
      checkSecretUnlocks(selectedCharacter.id);
    }

    if (isNewRecord || score > highScoreRecord.score) {
      highScoreRecord = saveHighScoreRecord(score, selectedCharacter?.name ?? '');
      syncHighScoreUI();
      triggerScoreBump(hudHighScoreEl);
    }
  },
  onGameOver: (finalScore, isNewRecord) => {
    highScoreRecord = saveHighScoreRecord(finalScore, selectedCharacter?.name ?? '');
    syncHighScoreUI();
    showGameOver(finalScore, isNewRecord);
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
      // Extrai sprite frontal e de costas em background
      getCharacterSprites(char.imageUrl)
        .then((sprites) => {
          loadedSprites.set(char.id, sprites);
          if (spriteBox.isConnected) {
            attachSpritePreview(spriteBox, sprites);
          }

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

function selectCharacter(char: CharacterDef): void {
  if (!isCharacterUnlocked(char)) return;
  selectedCharacter = char;

  characterGrid.querySelectorAll<HTMLButtonElement>('.char-card').forEach((card) => {
    const isSel = card.dataset.charId === char.id;
    card.classList.toggle('selected', isSel);
    card.setAttribute('aria-checked', String(isSel));
  });

  btnStartGame.disabled = false;
  btnStartGame.textContent = `BATER COM ${char.name.toUpperCase()}`;

  if (char.goalSoundUrl) {
    soundEngine.preloadCustomSound(char.goalSoundUrl);
  }
}

function startGame(): void {
  if (!selectedCharacter) return;

  soundEngine.unlock();
  overlayGameOver.hidden = true;
  unlockToast.hidden = true;
  controlsHint.classList.remove('hidden');

  hudScoreEl.textContent = '0';
  hudPlayerNameEl.textContent = selectedCharacter.name;
  syncHighScoreUI();

  screenSelect.classList.remove('active');
  screenGame.classList.add('active');

  const sprites = loadedSprites.get(selectedCharacter.id) ?? null;
  drawHudAvatar(sprites);

  // Garante início após layout visível
  requestAnimationFrame(() => {
    if (!selectedCharacter) return;
    game.startSession(selectedCharacter, sprites, highScoreRecord.score);
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

function showGameOver(finalScore: number, isNewRecord: boolean): void {
  gameOverTitle.textContent =
    finalScore === 0
      ? 'Zero no Placar!'
      : finalScore >= 5
        ? 'Bela Sequência!'
        : 'Fim de Sequência';

  const msg = SAVE_MESSAGES[Math.floor(Math.random() * SAVE_MESSAGES.length)];
  gameOverSubtitle.textContent = msg;
  gameOverScore.textContent = String(finalScore);
  gameOverScorePlayer.textContent = selectedCharacter ? `com ${selectedCharacter.name}` : '';
  gameOverHighScore.textContent = String(highScoreRecord.score);
  if (highScoreRecord.score > 0 && highScoreRecord.playerName) {
    gameOverHighScoreHolder.textContent = `com ${highScoreRecord.playerName}`;
    gameOverHighScoreHolder.hidden = false;
  } else {
    gameOverHighScoreHolder.hidden = true;
  }
  gameOverNewRecord.hidden = !(isNewRecord && finalScore > 0);
  overlayGameOver.hidden = false;
}

// Eventos dos botões
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

if (GOALKEEPER_IMAGE_URL) {
  getGoalkeeperSprites(GOALKEEPER_IMAGE_URL)
    .then((sprites) => {
      game.setGoalkeeperSprites(sprites);
    })
    .catch(() => {
      // Mantém fallback visual caso ocorra erro no carregamento
    });
}

// Registro do Service Worker para instalação PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Service Worker pode não registrar em contextos sem HTTPS/localhost
    });
  });
}
