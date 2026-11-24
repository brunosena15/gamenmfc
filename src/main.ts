import './styles.css';
import { soundEngine } from './audio';
import { CHARACTERS, GOALKEEPER_IMAGE_URL, type CharacterDef } from './characters';
import { PenaltyGame } from './game';
import {
  getCharacterSprites,
  getGoalkeeperSprites,
  type CharacterSprites,
} from './spriteExtractor';
import { getHighScore, saveHighScore } from './storage';

const screenSelect = document.getElementById('screen-select') as HTMLElement;
const screenGame = document.getElementById('screen-game') as HTMLElement;
const characterGrid = document.getElementById('character-grid') as HTMLElement;

const selectHighScoreEl = document.getElementById('select-highscore') as HTMLElement;
const btnStartGame = document.getElementById('btn-start-game') as HTMLButtonElement;
const btnSoundSelect = document.getElementById('btn-sound-select') as HTMLButtonElement;
const btnSoundGame = document.getElementById('btn-sound-game') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;

const hudScoreEl = document.getElementById('hud-score') as HTMLElement;
const hudHighScoreEl = document.getElementById('hud-highscore') as HTMLElement;
const hudPlayerNameEl = document.getElementById('hud-player-name') as HTMLElement;
const hudAvatarCanvas = document.getElementById('hud-avatar-canvas') as HTMLCanvasElement;
const controlsHint = document.getElementById('controls-hint') as HTMLElement;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const overlayGameOver = document.getElementById('overlay-gameover') as HTMLElement;
const gameOverTitle = document.getElementById('gameover-title') as HTMLElement;
const gameOverSubtitle = document.getElementById('gameover-subtitle') as HTMLElement;
const gameOverScore = document.getElementById('gameover-score') as HTMLElement;
const gameOverHighScore = document.getElementById('gameover-highscore') as HTMLElement;
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
let highScore = getHighScore();
const loadedSprites = new Map<string, CharacterSprites>();

const game = new PenaltyGame(gameCanvas, {
  onScoreChange: (score, isNewRecord) => {
    hudScoreEl.textContent = String(score);
    triggerScoreBump(hudScoreEl);

    if (isNewRecord || score > highScore) {
      highScore = saveHighScore(score);
      syncHighScoreUI();
      triggerScoreBump(hudHighScoreEl);
    }
  },
  onGameOver: (finalScore, isNewRecord) => {
    highScore = saveHighScore(finalScore);
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
  const val = String(highScore);
  selectHighScoreEl.textContent = val;
  hudHighScoreEl.textContent = val;
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

function renderCharacterCards(): void {
  characterGrid.innerHTML = '';

  CHARACTERS.forEach((char) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'char-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.dataset.charId = char.id;

    const spriteBox = document.createElement('div');
    spriteBox.className = 'char-sprite-box';

    const loader = document.createElement('div');
    loader.className = 'char-loading';
    spriteBox.appendChild(loader);

    const nameEl = document.createElement('span');
    nameEl.className = 'char-name';
    nameEl.textContent = char.name;

    card.appendChild(spriteBox);
    card.appendChild(nameEl);

    card.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.playSelect();
      selectCharacter(char);
    });

    characterGrid.appendChild(card);

    // Extrai sprite frontal e de costas em background
    getCharacterSprites(char.imageUrl)
      .then((sprites) => {
        loadedSprites.set(char.id, sprites);

        const preview = document.createElement('canvas');
        preview.className = 'char-sprite-canvas';
        preview.width = sprites.front.width;
        preview.height = sprites.front.height;
        preview.getContext('2d')?.drawImage(sprites.front, 0, 0);

        spriteBox.innerHTML = '';
        spriteBox.appendChild(preview);

        if (selectedCharacter?.id === char.id && screenGame.classList.contains('active')) {
          game.updateSprites(sprites);
          drawHudAvatar(sprites);
        }
      })
      .catch(() => {
        // Fallback para imagem direta se houver algum erro no processamento
        const img = document.createElement('img');
        img.src = char.imageUrl;
        img.alt = char.name;
        img.className = 'char-sprite-canvas';
        spriteBox.innerHTML = '';
        spriteBox.appendChild(img);
      });
  });
}

function selectCharacter(char: CharacterDef): void {
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
    game.startSession(selectedCharacter, sprites, highScore);
  });
}

function showSelectScreen(): void {
  soundEngine.playSelect();
  overlayGameOver.hidden = true;
  game.stop();
  screenGame.classList.remove('active');
  screenSelect.classList.add('active');
  syncHighScoreUI();
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
  gameOverHighScore.textContent = String(highScore);
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
