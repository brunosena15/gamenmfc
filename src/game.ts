import { soundEngine } from './audio';
import type { CharacterDef } from './characters';
import type { CharacterSprites } from './spriteExtractor';

export type TargetId =
  | 'top-left'
  | 'bottom-left'
  | 'center'
  | 'top-right'
  | 'bottom-right';

export const TARGET_IDS: TargetId[] = [
  'top-left',
  'bottom-left',
  'center',
  'top-right',
  'bottom-right',
];

const TARGET_LABELS: Record<TargetId, string> = {
  'top-left': 'SUP. ESQ',
  'bottom-left': 'INF. ESQ',
  center: 'MEIO',
  'top-right': 'SUP. DIR',
  'bottom-right': 'INF. DIR',
};

export type GameMode = 'infinite' | 'copa';
export type ShotQuality = 'perfect' | 'good' | 'bad';

export interface CopaSnapshot {
  playerResults: Array<'goal' | 'miss'>;
  cpuResults: Array<'goal' | 'miss'>;
  turn: 'player' | 'cpu';
  round: number;
  suddenDeath: boolean;
  cpuName: string;
}

export interface HudStatus {
  streak: number;
  hasShield: boolean;
  shieldProgress: number;
  shieldNeedsRecharge: boolean;
  onFire: boolean;
  paredao: boolean;
  mode: GameMode;
  copa: CopaSnapshot | null;
}

export interface GameOverInfo {
  mode: GameMode;
  finalScore: number;
  isNewRecord: boolean;
  reason: 'saved' | 'post' | 'copa-win' | 'copa-loss';
  isCaus: boolean;
  copaPlayerGoals?: number;
  copaCpuGoals?: number;
}

export interface GameCallbacks {
  onScoreChange: (score: number, goalsAdded: number, isNewRecord: boolean) => void;
  onHudStatusChange: (status: HudStatus) => void;
  onGameOver: (info: GameOverInfo) => void;
  onFirstKick: () => void;
}

type GamePhase =
  | 'READY'
  | 'TIMING'
  | 'RUNNING_UP'
  | 'BALL_FLIGHT'
  | 'GOAL'
  | 'SAVED'
  | 'POST_MISS'
  | 'SHIELD_SAVED'
  | 'DEFEND_READY'
  | 'DEFEND_RUNUP'
  | 'DEFEND_FLIGHT'
  | 'DEFEND_SAVED'
  | 'DEFEND_CONCEDED';

interface Point {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
  rotation: number;
  vr: number;
  shape: 'rect' | 'circle';
}

interface CrowdMember {
  nx: number;
  row: number;
  color: string;
  phase: number;
}

interface LayoutMetrics {
  w: number;
  h: number;
  horizonY: number;
  goalLeft: number;
  goalRight: number;
  goalTop: number;
  goalBottom: number;
  goalW: number;
  goalH: number;
  ballStart: Point;
  ballRadius: number;
  kickerIdle: Point;
  kickerKick: Point;
  kickerHeight: number;
  targets: Record<TargetId, Point>;
  targetRadius: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class PenaltyGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: GameCallbacks;

  private mode: GameMode = 'infinite';
  private character!: CharacterDef;
  private sprites: CharacterSprites | null = null;
  private goalkeeperSprites: CharacterSprites | null = null;

  // Elenco para escolher batedores do PC no Modo Copa
  private cpuOpponents: Array<{ def: CharacterDef; sprites: CharacterSprites | null }> = [];
  private activeCpuIndex = 0;

  private metrics!: LayoutMetrics;
  private dpr = 1;
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private elapsed = 0;

  private phase: GamePhase = 'READY';
  private phaseTimer = 0;

  private score = 0;
  private streak = 0;
  private shotsTaken = 0;
  private hasShield = false;
  private hasLostFirstShield = false;
  private bonusGoalsTowardNextShield = 0;
  private highScoreAtStart = 0;
  private achievedNewRecord = false;
  private hasKickedOnce = false;

  // Alvo bônus dourado (aparece a cada 3 cobranças no modo Infinito)
  private bonusTarget: TargetId | null = null;

  // Barra de precisão (Timing)
  private timingCursor = 0.5;
  private timingDir = 1;
  private timingSpeed = 1.65;
  private shotQuality: ShotQuality = 'good';

  // Paradinha & Cavadinha & Câmera lenta
  private didParadinha = false;
  private paradinhaPause = 0;
  private paradinhaBannerTimer = 0;
  private isCavadinha = false;
  private timeScale = 1;

  // Estado da cobrança atual
  private playerTarget: TargetId = 'center';
  private keeperTarget: TargetId = 'center';
  private isGoalShot = false;
  private postHitIn = false;
  private postImpactPoint: Point = { x: 0, y: 0 };

  // Estado da Copa (5 cobranças + morte súbita)
  private copaPlayerResults: Array<'goal' | 'miss'> = [];
  private copaCpuResults: Array<'goal' | 'miss'> = [];
  private copaTurn: 'player' | 'cpu' = 'player';
  private copaFinished = false;

  // Efeitos exclusivos de personagem
  private pedroCarActive = false;
  private pedroCarX = -120;
  private robinComicTimer = 0;
  private robinComicWord = 'POW!';
  private totzinSpeechTimer = 0;

  // Bola
  private ballPos: Point = { x: 0, y: 0 };
  private ballScale = 1;
  private ballRotation = 0;
  private ballShadowPos: Point = { x: 0, y: 0 };
  private ballVel: Point = { x: 0, y: 0 };
  private ballTrail: Array<{ x: number; y: number; r: number; alpha: number; fire: boolean }> = [];

  // Rede / Feedback
  private netBulge = 0;
  private netImpact: Point = { x: 0, y: 0 };
  private screenShake = 0;
  private bannerText = '';
  private bannerSubtext = '';
  private bannerColor = '#22c55e';
  private bannerTimer = 0;

  // Goleiro e Batedor
  private keeperProgress = 0;
  private kickerProgress = 0;
  private lastStrideStep = -1;
  private kickSwooshTimer = 0;

  // Controles touch / swipe
  private pointerActive = false;
  private pointerId: number | null = null;
  private pointerStart: Point = { x: 0, y: 0 };
  private pointerCurrent: Point = { x: 0, y: 0 };
  private isSwiping = false;
  private hoveredTarget: TargetId | null = null;

  // Partículas e torcida
  private particles: Particle[] = [];
  private crowd: CrowdMember[] = [];
  private crowdExcitement = 0;

  private resizeObserver: ResizeObserver;
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Contexto 2D do Canvas não disponível.');
    }
    this.ctx = ctx;
    this.callbacks = callbacks;

    this.generateCrowd();
    this.updateCanvasSize();

    this.resizeObserver = new ResizeObserver(() => this.updateCanvasSize());
    this.resizeObserver.observe(this.canvas);

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.canvas.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointercancel', this.boundPointerUp);
  }

  private generateCrowd(): void {
    const palette = ['#1d4ed8', '#e02437', '#f8fafc', '#facc15', '#3b82f6', '#ef4444'];
    this.crowd = [];
    for (let row = 0; row < 4; row++) {
      const count = 24 + row * 4;
      for (let i = 0; i < count; i++) {
        this.crowd.push({
          nx: (i + 0.5 + (Math.random() - 0.5) * 0.45) / count,
          row,
          color: palette[Math.floor(Math.random() * palette.length)],
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  public setCpuOpponents(opponents: Array<{ def: CharacterDef; sprites: CharacterSprites | null }>): void {
    this.cpuOpponents = opponents;
  }

  public startSession(
    character: CharacterDef,
    sprites: CharacterSprites | null,
    currentHighScore: number,
    mode: GameMode = 'infinite'
  ): void {
    this.mode = mode;
    this.character = character;
    this.sprites = sprites;
    if (character.goalSoundUrl) {
      soundEngine.preloadCustomSound(character.goalSoundUrl);
    }

    this.score = 0;
    this.streak = 0;
    this.shotsTaken = 0;
    this.hasShield = false;
    this.hasLostFirstShield = false;
    this.bonusGoalsTowardNextShield = 0;
    this.highScoreAtStart = currentHighScore;
    this.achievedNewRecord = false;
    this.hasKickedOnce = false;
    this.bonusTarget = null;

    this.copaPlayerResults = [];
    this.copaCpuResults = [];
    this.copaTurn = 'player';
    this.copaFinished = false;
    this.pickNextCpuOpponent();

    this.particles = [];
    this.crowdExcitement = 0;
    this.pedroCarActive = false;
    this.robinComicTimer = 0;
    this.totzinSpeechTimer = 0;

    this.updateCanvasSize();
    this.resetRound(true);
    this.emitHudStatus();

    if (this.rafId === null) {
      this.lastTimestamp = performance.now();
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  public updateSprites(sprites: CharacterSprites): void {
    this.sprites = sprites;
  }

  public setGoalkeeperSprites(sprites: CharacterSprites | null): void {
    this.goalkeeperSprites = sprites;
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    soundEngine.stopCustomSound();
    this.pointerActive = false;
    this.isSwiping = false;
    this.hoveredTarget = null;
  }

  public destroy(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerUp);
  }

  private get isOnFire(): boolean {
    return this.streak >= 3;
  }

  private get isParedao(): boolean {
    return this.mode === 'infinite' && this.streak >= 5;
  }

  private pickNextCpuOpponent(): void {
    if (this.cpuOpponents.length === 0) {
      this.activeCpuIndex = 0;
      return;
    }
    this.activeCpuIndex = Math.floor(Math.random() * this.cpuOpponents.length);
  }

  private getActiveKickerSprites(): CharacterSprites | null {
    if (
      this.phase === 'DEFEND_READY' ||
      this.phase === 'DEFEND_RUNUP' ||
      this.phase === 'DEFEND_FLIGHT' ||
      this.phase === 'DEFEND_SAVED' ||
      this.phase === 'DEFEND_CONCEDED'
    ) {
      return this.cpuOpponents[this.activeCpuIndex]?.sprites ?? this.sprites;
    }
    return this.sprites;
  }

  private getActiveCpuName(): string {
    return this.cpuOpponents[this.activeCpuIndex]?.def.name ?? 'Rival';
  }

  private emitHudStatus(): void {
    let copa: CopaSnapshot | null = null;
    if (this.mode === 'copa') {
      const round = Math.max(this.copaPlayerResults.length, this.copaCpuResults.length) +
        (this.copaTurn === 'player' ? 1 : 0);
      copa = {
        playerResults: [...this.copaPlayerResults],
        cpuResults: [...this.copaCpuResults],
        turn: this.copaTurn,
        round: Math.max(1, round),
        suddenDeath: this.copaPlayerResults.length >= 5 && this.copaCpuResults.length >= 5,
        cpuName: this.getActiveCpuName(),
      };
    }

    this.callbacks.onHudStatusChange({
      streak: this.streak,
      hasShield: this.hasShield,
      shieldProgress: this.bonusGoalsTowardNextShield,
      shieldNeedsRecharge: this.hasLostFirstShield && !this.hasShield,
      onFire: this.isOnFire,
      paredao: this.isParedao,
      mode: this.mode,
      copa,
    });
  }

  private resetRound(playWhistleSound: boolean): void {
    this.phaseTimer = 0;
    this.keeperProgress = 0;
    this.kickerProgress = 0;
    this.lastStrideStep = -1;
    this.kickSwooshTimer = 0;
    this.netBulge = 0;
    this.ballTrail = [];
    this.bannerTimer = 0;
    this.didParadinha = false;
    this.paradinhaPause = 0;
    this.paradinhaBannerTimer = 0;
    this.isCavadinha = false;
    this.timeScale = 1;
    this.pointerActive = false;
    this.isSwiping = false;
    this.hoveredTarget = null;

    this.ballPos = { ...this.metrics.ballStart };
    this.ballShadowPos = { ...this.metrics.ballStart };
    this.ballScale = 1;
    this.ballRotation = 0;

    if (this.mode === 'copa' && this.copaTurn === 'cpu') {
      this.pickNextCpuOpponent();
      this.phase = 'DEFEND_READY';
      this.bonusTarget = null;
    } else {
      this.phase = 'READY';
      // Alvo bônus dourado aparece a cada 3 cobranças no Modo Infinito
      if (this.mode === 'infinite' && this.shotsTaken > 0 && (this.shotsTaken + 1) % 3 === 0) {
        this.bonusTarget = Math.random() < 0.5 ? 'top-left' : 'top-right';
      } else {
        this.bonusTarget = null;
      }
    }

    this.emitHudStatus();

    if (playWhistleSound) {
      soundEngine.playWhistle();
    }
  }

  private updateCanvasSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width || window.innerWidth);
    const h = Math.max(500, rect.height || window.innerHeight);

    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    const goalW = Math.min(w * 0.86, h * 0.54);
    const goalH = goalW * 0.44;
    const goalLeft = (w - goalW) * 0.5;
    const goalRight = goalLeft + goalW;
    const goalBottom = h * 0.48;
    const goalTop = goalBottom - goalH;
    const horizonY = goalBottom - goalH * 0.16;

    const ballStart: Point = { x: w * 0.5, y: h * 0.805 };
    const ballRadius = clamp(w * 0.056, 17, 25);

    const kickerHeight = clamp(h * 0.24, 134, 215);
    const kickerIdle: Point = { x: w * 0.26, y: h * 0.955 };
    const kickerKick: Point = { x: w * 0.455, y: h * 0.83 };

    const targets: Record<TargetId, Point> = {
      'top-left': { x: goalLeft + goalW * 0.165, y: goalTop + goalH * 0.27 },
      'bottom-left': { x: goalLeft + goalW * 0.165, y: goalTop + goalH * 0.76 },
      center: { x: w * 0.5, y: goalTop + goalH * 0.47 },
      'top-right': { x: goalLeft + goalW * 0.835, y: goalTop + goalH * 0.27 },
      'bottom-right': { x: goalLeft + goalW * 0.835, y: goalTop + goalH * 0.76 },
    };

    const targetRadius = clamp(goalW * 0.088, 22, 34);

    this.metrics = {
      w,
      h,
      horizonY,
      goalLeft,
      goalRight,
      goalTop,
      goalBottom,
      goalW,
      goalH,
      ballStart,
      ballRadius,
      kickerIdle,
      kickerKick,
      kickerHeight,
      targets,
      targetRadius,
    };

    if (this.phase === 'READY' || this.phase === 'TIMING' || this.phase === 'DEFEND_READY') {
      this.ballPos = { ...ballStart };
      this.ballShadowPos = { ...ballStart };
    }
  }

  private getCanvasPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private findTappedTarget(pt: Point): TargetId | null {
    const m = this.metrics;
    const padX = m.goalW * 0.1;
    const padY = m.goalH * 0.22;

    const inGoalArea =
      pt.x >= m.goalLeft - padX &&
      pt.x <= m.goalRight + padX &&
      pt.y >= m.goalTop - padY &&
      pt.y <= m.goalBottom + padY;

    if (!inGoalArea) return null;

    let best: TargetId = 'center';
    let bestDistSq = Infinity;
    for (const id of TARGET_IDS) {
      const t = m.targets[id];
      const dx = pt.x - t.x;
      const dy = pt.y - t.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = id;
      }
    }
    return best;
  }

  private resolveSwipeTarget(start: Point, current: Point): TargetId | null {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    if (dy > -22) return null;

    const direct = this.findTappedTarget(current);
    if (direct) return direct;

    const m = this.metrics;
    const travelY = Math.max(120, m.ballStart.y - m.goalBottom);
    const slopeX = dx / Math.max(30, -dy);
    const projectedX = m.ballStart.x + slopeX * travelY;

    const relX = (projectedX - m.w * 0.5) / (m.goalW * 0.5);
    const swipeUpDist = -dy;
    const isHigh = swipeUpDist >= m.h * 0.165 || current.y < m.h * 0.55;

    if (relX < -0.26) return isHigh ? 'top-left' : 'bottom-left';
    if (relX > 0.26) return isHigh ? 'top-right' : 'bottom-right';
    return 'center';
  }

  private handlePointerDown(e: PointerEvent): void {
    soundEngine.unlock();

    // 1. Fase TIMING: 1 toque em qualquer lugar trava a força/precisão!
    if (this.phase === 'TIMING') {
      this.lockTimingAndRun();
      return;
    }

    // 2. Fase RUNNING_UP: toque durante a corrida faz a PARADINHA!
    if (this.phase === 'RUNNING_UP' && !this.didParadinha && this.kickerProgress < 0.68) {
      this.triggerParadinha();
      return;
    }

    // 3. Fase DEFEND_READY (Modo Copa): toque no canto onde o jogador quer pular com o goleiro!
    if (this.phase === 'DEFEND_READY') {
      const pt = this.getCanvasPoint(e);
      const chosenDive = this.findTappedTarget(pt);
      if (chosenDive) {
        this.startCpuKick(chosenDive);
      }
      return;
    }

    if (this.phase !== 'READY') return;

    const pt = this.getCanvasPoint(e);
    this.pointerActive = true;
    this.pointerId = e.pointerId;
    this.pointerStart = pt;
    this.pointerCurrent = pt;
    this.isSwiping = false;
    this.hoveredTarget = this.findTappedTarget(pt);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.pointerActive || e.pointerId !== this.pointerId || this.phase !== 'READY') {
      return;
    }

    const pt = this.getCanvasPoint(e);
    this.pointerCurrent = pt;

    const dx = pt.x - this.pointerStart.x;
    const dy = pt.y - this.pointerStart.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 14 && dy < -10) {
      this.isSwiping = true;
      this.hoveredTarget = this.resolveSwipeTarget(this.pointerStart, pt);
    } else if (!this.isSwiping) {
      this.hoveredTarget = this.findTappedTarget(pt);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.pointerActive || e.pointerId !== this.pointerId) return;

    const pt = this.getCanvasPoint(e);
    this.pointerActive = false;
    this.pointerId = null;

    if (this.phase !== 'READY') {
      this.isSwiping = false;
      this.hoveredTarget = null;
      return;
    }

    let chosen: TargetId | null = null;
    if (this.isSwiping) {
      chosen = this.resolveSwipeTarget(this.pointerStart, pt);
    } else {
      chosen = this.findTappedTarget(pt);
    }

    this.isSwiping = false;
    this.hoveredTarget = null;

    if (chosen) {
      this.beginTimingPhase(chosen);
    }
  }

  private beginTimingPhase(target: TargetId): void {
    if (!this.hasKickedOnce) {
      this.hasKickedOnce = true;
      this.callbacks.onFirstKick();
    }

    this.playerTarget = target;
    this.phase = 'TIMING';
    this.phaseTimer = 0;

    // Começa de um lado aleatório para sempre exigir reflexo real
    this.timingCursor = Math.random() < 0.5 ? 0.08 : 0.92;
    this.timingDir = this.timingCursor < 0.5 ? 1 : -1;
    // Acelera conforme a sequência sobe (Modo Paredão mais desafiador!)
    const streakBoost = this.mode === 'infinite' ? Math.min(1.45, this.streak * 0.14) : 0.25;
    this.timingSpeed = 1.6 + streakBoost;
    soundEngine.playSelect();
  }

  private lockTimingAndRun(): void {
    const pos = this.timingCursor;
    if (pos >= 0.4 && pos <= 0.6) {
      this.shotQuality = 'perfect';
    } else if (pos >= 0.15 && pos <= 0.85) {
      this.shotQuality = 'good';
    } else {
      this.shotQuality = 'bad';
    }

    this.didParadinha = false;
    this.paradinhaPause = 0;
    this.paradinhaBannerTimer = 0;
    this.shotsTaken += 1;

    this.computeShotOutcome();

    this.phase = 'RUNNING_UP';
    this.phaseTimer = 0;
    this.kickerProgress = 0;
    this.lastStrideStep = -1;
    this.kickSwooshTimer = 0;
    this.keeperProgress = 0;
    this.ballTrail = [];
  }

  private triggerParadinha(): void {
    this.didParadinha = true;
    this.paradinhaPause = 0.27;
    this.paradinhaBannerTimer = 0.72;
    soundEngine.playFeint();

    // Recalcula desfecho com vantagem da paradinha (goleiro cai antes pro lado errado — exceto no Caus!)
    this.computeShotOutcome();
  }

  private chooseRandomOtherTarget(exclude: TargetId): TargetId {
    const others = TARGET_IDS.filter((id) => id !== exclude);
    return others[Math.floor(Math.random() * others.length)];
  }

  private computeShotOutcome(): void {
    this.isCavadinha =
      this.playerTarget === 'center' && (this.shotQuality === 'perfect' || this.didParadinha);
    this.postHitIn = false;

    // REGRA ESPECIAL OCULTA: personagens/caus.jpg é SEMPRE defendido 100% pelo goleiro!
    if (this.character.alwaysSaved) {
      this.keeperTarget = this.playerTarget;
      this.isGoalShot = false;
      this.postHitIn = false;
      return;
    }

    const isBonusShot =
      this.mode === 'infinite' &&
      this.bonusTarget !== null &&
      this.playerTarget === this.bonusTarget;

    // DECISÃO DE RISCO NO ALVO BÔNUS:
    // O goleiro SEMPRE vai naquela direção e o gol só é convertido com cobrança PERFEITA!
    if (isBonusShot) {
      this.keeperTarget = this.playerTarget;
      if (this.shotQuality === 'perfect') {
        this.isGoalShot = true;
        return;
      }
      if (this.shotQuality === 'bad') {
        this.postHitIn = false;
        this.isGoalShot = false;
        const m = this.metrics;
        this.postImpactPoint = {
          x: this.playerTarget.includes('left') ? m.goalLeft + 3 : m.goalRight - 3,
          y: m.targets[this.playerTarget].y,
        };
        return;
      }
      // Zona verde (não perfeita) no alvo bônus = goleiro defende!
      this.isGoalShot = false;
      return;
    }

    // Zona vermelha (errou feio o timing): bola vai na trave!
    if (this.shotQuality === 'bad') {
      this.keeperTarget = TARGET_IDS[Math.floor(Math.random() * TARGET_IDS.length)];
      // 30% de sorte: bate na trave e entra chorando! 70%: sai para fora
      this.postHitIn = Math.random() < 0.3;
      this.isGoalShot = this.postHitIn;
      const m = this.metrics;
      if (this.playerTarget.includes('left')) {
        this.postImpactPoint = { x: m.goalLeft + 3, y: m.targets[this.playerTarget].y };
      } else if (this.playerTarget.includes('right')) {
        this.postImpactPoint = { x: m.goalRight - 3, y: m.targets[this.playerTarget].y };
      } else {
        this.postImpactPoint = { x: m.w * 0.5, y: m.goalTop + 3 };
      }
      return;
    }

    // Zona Dourada (Perfeito — NA GAVETA!)
    if (this.shotQuality === 'perfect') {
      if (this.playerTarget === 'center') {
        // No meio (cavadinha ou batida normal): se o goleiro ficar no meio, ele PEGA mesmo na zona dourada!
        const stayCenterChance = this.didParadinha ? 0.15 : this.isParedao ? 0.3 : 0.2;
        this.keeperTarget =
          Math.random() < stayCenterChance
            ? 'center'
            : this.chooseRandomOtherTarget('center');
        this.isGoalShot = this.keeperTarget !== 'center';
        return;
      }

      const randomIdx = Math.floor(Math.random() * TARGET_IDS.length);
      this.keeperTarget = TARGET_IDS[randomIdx];
      // Se fez paradinha, goleiro pula pro outro lado!
      if (this.didParadinha && this.keeperTarget === this.playerTarget) {
        this.keeperTarget = this.chooseRandomOtherTarget(this.playerTarget);
      }
      this.isGoalShot = true;
      return;
    }

    // Zona Verde (Chute bom normal):
    if (this.didParadinha) {
      // Paradinha engana o goleiro na maior parte das vezes (85% de deslocar ele)
      this.keeperTarget =
        Math.random() < 0.85
          ? this.chooseRandomOtherTarget(this.playerTarget)
          : this.playerTarget;
    } else {
      // No Modo Paredão (5+ seguidos), goleiro tem leve chance extra (30% vs 20%)
      const saveChance = this.isParedao ? 0.3 : 0.2;
      if (Math.random() < saveChance) {
        this.keeperTarget = this.playerTarget;
      } else {
        this.keeperTarget = this.chooseRandomOtherTarget(this.playerTarget);
      }
    }

    this.isGoalShot = this.keeperTarget !== this.playerTarget;
  }

  private startCpuKick(playerDiveChoice: TargetId): void {
    this.keeperTarget = playerDiveChoice;
    // PC escolhe aleatoriamente 1 dos 5 cantos
    this.playerTarget = TARGET_IDS[Math.floor(Math.random() * TARGET_IDS.length)];
    this.isGoalShot = this.keeperTarget !== this.playerTarget;
    this.shotQuality = 'good';
    this.isCavadinha = false;

    this.phase = 'DEFEND_RUNUP';
    this.phaseTimer = 0;
    this.kickerProgress = 0;
    this.keeperProgress = 0;
    this.lastStrideStep = -1;
    this.kickSwooshTimer = 0;
    this.ballTrail = [];
    soundEngine.playSelect();
  }

  private spawnStepDust(x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 14,
        y: y - 2,
        vx: (Math.random() - 0.5) * 55 - 15,
        vy: -25 - Math.random() * 45,
        size: 2.5 + Math.random() * 3,
        color: i % 2 === 0 ? '#86efac' : '#bbf7d0',
        alpha: 0.78,
        life: 0,
        maxLife: 0.26 + Math.random() * 0.16,
        gravity: 210,
        rotation: 0,
        vr: 0,
        shape: 'circle',
      });
    }
  }

  private spawnKickDust(isFire: boolean): void {
    const { x, y } = this.metrics.ballStart;
    for (let i = 0; i < (isFire ? 16 : 10); i++) {
      const ang = -Math.PI * (0.15 + Math.random() * 0.7);
      const spd = 45 + Math.random() * 125;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 14,
        y: y + 10,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.65,
        size: 3 + Math.random() * 4.5,
        color: isFire
          ? i % 2 === 0
            ? '#facc15'
            : '#fb923c'
          : i % 2 === 0
            ? '#86efac'
            : '#dcfce7',
        alpha: 0.92,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
        gravity: 230,
        rotation: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        shape: 'circle',
      });
    }
  }

  private spawnGoalConfetti(): void {
    const colors = ['#facc15', '#22c55e', '#3b82f6', '#ef4444', '#ffffff', '#f97316'];
    const cx = this.metrics.w * 0.5;
    const cy = this.metrics.goalTop + this.metrics.goalH * 0.35;

    for (let i = 0; i < 60; i++) {
      const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.4;
      const spd = 120 + Math.random() * 290;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * this.metrics.goalW * 0.75,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        size: 5 + Math.random() * 6,
        color: colors[i % colors.length],
        alpha: 1,
        life: 0,
        maxLife: 1.0 + Math.random() * 0.65,
        gravity: 340,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        shape: 'rect',
      });
    }
  }

  private spawnSaveSparks(impact: Point, palette?: string[]): void {
    const colors = palette ?? ['#ffffff', '#facc15', '#fb923c', '#ff4757'];
    for (let i = 0; i < 24; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 75 + Math.random() * 190;
      this.particles.push({
        x: impact.x,
        y: impact.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3 + Math.random() * 4.8,
        color: colors[i % colors.length],
        alpha: 1,
        life: 0,
        maxLife: 0.44 + Math.random() * 0.25,
        gravity: 220,
        rotation: 0,
        vr: 0,
        shape: 'circle',
      });
    }
  }

  private loop = (timestamp: number): void => {
    const rawDt = Math.min(0.05, Math.max(0.001, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    this.elapsed += rawDt;

    this.update(rawDt);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(rawDt: number): void {
    const dt = rawDt * this.timeScale;
    this.phaseTimer += dt;
    this.screenShake = Math.max(0, this.screenShake - rawDt * 24);
    this.netBulge = Math.max(0, this.netBulge - rawDt * 1.9);
    this.crowdExcitement = Math.max(0, this.crowdExcitement - rawDt * 0.7);
    if (this.kickSwooshTimer > 0) this.kickSwooshTimer = Math.max(0, this.kickSwooshTimer - rawDt);
    if (this.bannerTimer > 0) this.bannerTimer = Math.max(0, this.bannerTimer - rawDt);
    if (this.paradinhaBannerTimer > 0) {
      this.paradinhaBannerTimer = Math.max(0, this.paradinhaBannerTimer - rawDt);
    }
    if (this.robinComicTimer > 0) {
      this.robinComicTimer = Math.max(0, this.robinComicTimer - rawDt);
    }
    if (this.totzinSpeechTimer > 0) {
      this.totzinSpeechTimer = Math.max(0, this.totzinSpeechTimer - rawDt);
    }

    // Carro #95 do Pedro atravessando o campo comemorando
    if (this.pedroCarActive) {
      this.pedroCarX += rawDt * (this.metrics.w * 1.45);
      if (Math.random() < 0.65) {
        this.particles.push({
          x: this.pedroCarX - 38,
          y: this.metrics.goalBottom + 18 + (Math.random() - 0.5) * 6,
          vx: -80 - Math.random() * 60,
          vy: -20 - Math.random() * 35,
          size: 3.5 + Math.random() * 3.5,
          color: Math.random() < 0.5 ? '#facc15' : '#fb923c',
          alpha: 0.9,
          life: 0,
          maxLife: 0.35,
          gravity: 120,
          rotation: 0,
          vr: 0,
          shape: 'circle',
        });
      }
      if (this.pedroCarX > this.metrics.w + 130) {
        this.pedroCarActive = false;
      }
    }

    // Partículas
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += rawDt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * rawDt;
      p.x += p.vx * rawDt;
      p.y += p.vy * rawDt;
      p.rotation += p.vr * rawDt;
      p.alpha = 1 - p.life / p.maxLife;
    }

    // Rastro da bola
    for (let i = this.ballTrail.length - 1; i >= 0; i--) {
      this.ballTrail[i].alpha -= rawDt * 3.2;
      if (this.ballTrail[i].alpha <= 0) {
        this.ballTrail.splice(i, 1);
      }
    }

    const m = this.metrics;

    // ===== FASE TIMING (BARRA DE PRECISÃO) =====
    if (this.phase === 'TIMING') {
      this.timingCursor += this.timingDir * this.timingSpeed * rawDt;
      if (this.timingCursor >= 1) {
        this.timingCursor = 1;
        this.timingDir = -1;
      } else if (this.timingCursor <= 0) {
        this.timingCursor = 0;
        this.timingDir = 1;
      }
      // Segurança: se o jogador não tocar em 3.5s, chuta automático
      if (this.phaseTimer >= 3.5) {
        this.lockTimingAndRun();
      }
      return;
    }

    // ===== FASE CORRIDA DO JOGADOR =====
    if (this.phase === 'RUNNING_UP') {
      if (this.paradinhaPause > 0) {
        this.paradinhaPause = Math.max(0, this.paradinhaPause - rawDt);
        // Durante a paradinha, o goleiro já se antecipa (exceto se for o Caus!)
        if (!this.character.alwaysSaved) {
          this.keeperProgress = clamp(this.keeperProgress + rawDt * 1.15, 0, 0.42);
        }
        return;
      }

      const duration = 0.56;
      this.kickerProgress = clamp(this.kickerProgress + dt / duration, 0, 1);

      if (this.kickerProgress < 0.78) {
        const strideIdx = Math.floor((this.kickerProgress / 0.78) * 4);
        if (strideIdx > this.lastStrideStep) {
          this.lastStrideStep = strideIdx;
          const runT = clamp(this.kickerProgress / 0.88, 0, 1);
          const fx = lerp(m.kickerIdle.x, m.kickerKick.x, runT);
          const fy = lerp(m.kickerIdle.y, m.kickerKick.y, runT);
          this.spawnStepDust(fx, fy);
        }
      }

      if (this.kickerProgress >= 1) {
        this.phase = 'BALL_FLIGHT';
        this.phaseTimer = 0;
        this.kickSwooshTimer = 0.24;

        const isFireShot = this.shotQuality === 'perfect' || this.isOnFire;
        if (this.shotQuality === 'perfect') {
          soundEngine.playPerfectKick();
        } else {
          soundEngine.playKick();
        }
        this.spawnKickDust(isFireShot);

        // Câmera lenta dramática nos momentos épicos!
        const isCausPerfect = this.character.alwaysSaved && this.shotQuality === 'perfect';
        const isRecordShot =
          this.mode === 'infinite' &&
          this.isGoalShot &&
          this.highScoreAtStart > 0 &&
          this.score === this.highScoreAtStart;

        if (this.isCavadinha) {
          // Cavadinha bem mais dramática em câmera lenta!
          this.timeScale = 0.36;
        } else if (isCausPerfect || this.shotQuality === 'bad' || isRecordShot) {
          this.timeScale = 0.62;
        } else {
          this.timeScale = 1;
        }
      }
      return;
    }

    // ===== FASE VOO DA BOLA (ATAQUE) =====
    if (this.phase === 'BALL_FLIGHT') {
      const flightDuration = this.isCavadinha ? 0.64 : this.shotQuality === 'perfect' ? 0.38 : 0.44;
      const t = clamp(this.phaseTimer / flightDuration, 0, 1);
      const destPt =
        this.shotQuality === 'bad' ? this.postImpactPoint : m.targets[this.playerTarget];

      const isTop = this.playerTarget === 'top-left' || this.playerTarget === 'top-right';
      const arcHeight = this.isCavadinha
        ? m.h * 0.165
        : isTop
          ? m.h * 0.08
          : m.h * 0.035;
      const curveX = this.playerTarget.includes('left')
        ? -m.w * 0.045
        : this.playerTarget.includes('right')
          ? m.w * 0.045
          : 0;

      const et = easeOutCubic(t);
      const bx = lerp(m.ballStart.x, destPt.x, et) + Math.sin(t * Math.PI) * curveX;
      const by = lerp(m.ballStart.y, destPt.y, et) - Math.sin(t * Math.PI) * arcHeight;

      this.ballPos = { x: bx, y: by };
      this.ballScale = lerp(1, 0.54, et);
      this.ballRotation += dt * (this.isCavadinha ? 5 : 20);
      this.ballShadowPos = {
        x: bx,
        y: lerp(m.ballStart.y + m.ballRadius * 0.65, m.goalBottom + 2, et),
      };

      const fireTrail = this.shotQuality === 'perfect' || this.isOnFire;
      if (t < 0.96) {
        this.ballTrail.push({
          x: bx,
          y: by,
          r: m.ballRadius * this.ballScale * (fireTrail ? 0.95 : 0.8),
          alpha: fireTrail ? 0.55 : 0.34,
          fire: fireTrail,
        });
      }

      const keeperStart = this.didParadinha && !this.character.alwaysSaved ? 0 : 0.06;
      const keeperT = clamp((t - keeperStart) / (1 - keeperStart), 0, 1);
      this.keeperProgress = Math.max(this.keeperProgress, easeOutCubic(keeperT));

      if (t >= 1) {
        this.timeScale = 1;
        this.resolveAttackImpact(destPt);
      }
      return;
    }

    // ===== RESULTADO: GOL =====
    if (this.phase === 'GOAL') {
      const targetPt = m.targets[this.playerTarget];
      const settleT = clamp(this.phaseTimer / 0.35, 0, 1);
      this.ballPos = {
        x: lerp(targetPt.x, targetPt.x + (targetPt.x - m.w * 0.5) * 0.06, settleT),
        y: lerp(targetPt.y, m.goalBottom - m.ballRadius * 0.55, easeOutCubic(settleT)),
      };
      this.ballShadowPos = { x: this.ballPos.x, y: m.goalBottom - 2 };
      this.ballRotation += dt * 5 * (1 - settleT);

      if (this.phaseTimer >= 1.38) {
        this.advanceAfterAttack('goal');
      }
      return;
    }

    // ===== RESULTADO: ESCUDO SALVOU =====
    if (this.phase === 'SHIELD_SAVED') {
      this.updateBouncingBall(dt, m);
      if (this.phaseTimer >= 1.25) {
        this.resetRound(true);
      }
      return;
    }

    // ===== RESULTADO: DEFESA OU TRAVE FORA =====
    if (this.phase === 'SAVED' || this.phase === 'POST_MISS') {
      this.updateBouncingBall(dt, m);
      if (this.phaseTimer >= 1.15 && this.phaseTimer - dt < 1.15) {
        if (this.mode === 'copa') {
          this.advanceAfterAttack('miss');
        } else {
          this.callbacks.onGameOver({
            mode: 'infinite',
            finalScore: this.score,
            isNewRecord: this.achievedNewRecord,
            reason: this.phase === 'POST_MISS' ? 'post' : 'saved',
            isCaus: this.character.alwaysSaved,
          });
        }
      }
      return;
    }

    // ===== MODO COPA: VEZ DO PC BATER (JOGADOR DEFENDE) =====
    if (this.phase === 'DEFEND_RUNUP') {
      const duration = 0.48;
      this.kickerProgress = clamp(this.phaseTimer / duration, 0, 1);
      if (this.kickerProgress < 0.78) {
        const strideIdx = Math.floor((this.kickerProgress / 0.78) * 3);
        if (strideIdx > this.lastStrideStep) {
          this.lastStrideStep = strideIdx;
          const runT = clamp(this.kickerProgress / 0.88, 0, 1);
          this.spawnStepDust(
            lerp(m.kickerIdle.x, m.kickerKick.x, runT),
            lerp(m.kickerIdle.y, m.kickerKick.y, runT)
          );
        }
      }
      if (this.kickerProgress >= 1) {
        this.phase = 'DEFEND_FLIGHT';
        this.phaseTimer = 0;
        this.kickSwooshTimer = 0.22;
        soundEngine.playKick();
        this.spawnKickDust(false);
      }
      return;
    }

    if (this.phase === 'DEFEND_FLIGHT') {
      const flightDuration = 0.43;
      const t = clamp(this.phaseTimer / flightDuration, 0, 1);
      const targetPt = m.targets[this.playerTarget];
      const et = easeOutCubic(t);

      const isTop = this.playerTarget === 'top-left' || this.playerTarget === 'top-right';
      const arcHeight = isTop ? m.h * 0.08 : m.h * 0.035;
      const bx = lerp(m.ballStart.x, targetPt.x, et);
      const by = lerp(m.ballStart.y, targetPt.y, et) - Math.sin(t * Math.PI) * arcHeight;

      this.ballPos = { x: bx, y: by };
      this.ballScale = lerp(1, 0.54, et);
      this.ballRotation += dt * 18;
      this.ballShadowPos = {
        x: bx,
        y: lerp(m.ballStart.y + m.ballRadius * 0.65, m.goalBottom + 2, et),
      };

      if (t < 0.95) {
        this.ballTrail.push({
          x: bx,
          y: by,
          r: m.ballRadius * this.ballScale * 0.8,
          alpha: 0.34,
          fire: false,
        });
      }

      this.keeperProgress = easeOutCubic(clamp(t * 1.05, 0, 1));

      if (t >= 1) {
        this.resolveDefendImpact(targetPt);
      }
      return;
    }

    if (this.phase === 'DEFEND_SAVED') {
      this.updateBouncingBall(dt, m);
      if (this.phaseTimer >= 1.25) {
        this.advanceAfterCpuKick('miss');
      }
      return;
    }

    if (this.phase === 'DEFEND_CONCEDED') {
      const targetPt = m.targets[this.playerTarget];
      const settleT = clamp(this.phaseTimer / 0.35, 0, 1);
      this.ballPos = {
        x: lerp(targetPt.x, targetPt.x + (targetPt.x - m.w * 0.5) * 0.06, settleT),
        y: lerp(targetPt.y, m.goalBottom - m.ballRadius * 0.55, easeOutCubic(settleT)),
      };
      this.ballShadowPos = { x: this.ballPos.x, y: m.goalBottom - 2 };
      if (this.phaseTimer >= 1.25) {
        this.advanceAfterCpuKick('goal');
      }
    }
  }

  private updateBouncingBall(dt: number, m: LayoutMetrics): void {
    this.ballVel.y += 720 * dt;
    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.y += this.ballVel.y * dt;
    this.ballRotation += dt * 13;

    const groundY = m.goalBottom + 36;
    if (this.ballPos.y > groundY) {
      this.ballPos.y = groundY;
      this.ballVel.y *= -0.45;
      this.ballVel.x *= 0.82;
    }
    this.ballShadowPos = { x: this.ballPos.x, y: groundY + 4 };
  }

  private resolveAttackImpact(impactPt: Point): void {
    // 1. Bola na trave!
    if (this.shotQuality === 'bad' && !this.character.alwaysSaved) {
      soundEngine.playPostHit();
      this.spawnSaveSparks(impactPt, ['#ffffff', '#cbd5e1', '#facc15']);
      if (!this.postHitIn) {
        // Escudo salva também se acertar a trave!
        if (this.mode === 'infinite' && this.hasShield) {
          this.consumeShieldSave(impactPt, 'A trave perdoou pelo escudo!');
          return;
        }
        this.phase = 'POST_MISS';
        this.phaseTimer = 0;
        this.screenShake = 12;
        this.ballVel = {
          x: (this.playerTarget.includes('left') ? -1 : 1) * 165,
          y: -170,
        };
        this.bannerText = 'NA TRAVE!';
        this.bannerSubtext = 'Quase! Faltou caprichar na barra!';
        this.bannerColor = '#f97316';
        this.bannerTimer = 1.1;
        if (navigator.vibrate) navigator.vibrate(95);
        return;
      }
    }

    // 2. GOL!
    if (this.isGoalShot) {
      this.phase = 'GOAL';
      this.phaseTimer = 0;
      this.streak += 1;

      const prevScore = this.score;
      const hitBonus = this.mode === 'infinite' && this.bonusTarget === this.playerTarget;
      const goalsAdded = hitBonus ? 2 : 1;
      this.score += goalsAdded;

      let gainedShield = false;
      let shieldRechargeNote = '';

      // Regra do Escudo: máximo 1 escudo por vez; após perder o 1º, só ganha outro acertando 3 gols bônus!
      if (hitBonus && !this.hasShield) {
        if (!this.hasLostFirstShield) {
          this.hasShield = true;
          gainedShield = true;
          soundEngine.playShieldGain();
        } else {
          this.bonusGoalsTowardNextShield += 1;
          if (this.bonusGoalsTowardNextShield >= 3) {
            this.hasShield = true;
            this.bonusGoalsTowardNextShield = 0;
            gainedShield = true;
            soundEngine.playShieldGain();
          } else {
            shieldRechargeNote = `🛡️ Novo escudo: ${this.bonusGoalsTowardNextShield}/3 bônus`;
          }
        }
      }

      const justBeatRecord =
        this.mode === 'infinite' && this.score > this.highScoreAtStart;
      const firstTimeBeating = justBeatRecord && !this.achievedNewRecord;
      if (justBeatRecord) this.achievedNewRecord = true;

      this.netBulge = 1;
      this.netImpact = { ...this.metrics.targets[this.playerTarget] };
      this.crowdExcitement = 1;
      this.screenShake = this.shotQuality === 'perfect' ? 8 : 5;

      // Texto de comemoração contextual
      if (this.postHitIn) {
        this.bannerText = 'NA TRAVE E ENTROU!';
      } else if (this.isCavadinha) {
        this.bannerText = 'CAVADINHA! 🥄';
      } else if (hitBonus) {
        this.bannerText = 'ALVO DOURADO! +2';
      } else if (this.shotQuality === 'perfect') {
        this.bannerText = 'NA GAVETA! ⭐';
      } else {
        const isTop = this.playerTarget === 'top-left' || this.playerTarget === 'top-right';
        this.bannerText = isTop ? 'GOLAÇO!' : 'GOL!';
      }

      if (gainedShield) {
        this.bannerSubtext = this.hasLostFirstShield
          ? '🛡️ NOVO ESCUDO CONQUISTADO!'
          : '🛡️ +1 ESCUDO DE PROTEÇÃO!';
      } else if (shieldRechargeNote) {
        this.bannerSubtext = shieldRechargeNote;
      } else if (firstTimeBeating) {
        this.bannerSubtext = '⭐ NOVO RECORDE!';
      } else if (this.mode === 'copa') {
        this.bannerSubtext = 'Belo pênalti convertido!';
      } else if (this.isOnFire) {
        this.bannerSubtext = `🔥 ON FIRE! ${this.score} gols!`;
      } else {
        this.bannerSubtext = `${this.score} ${this.score === 1 ? 'gol seguido' : 'gols seguidos'}`;
      }

      this.bannerColor = hitBonus || firstTimeBeating || this.shotQuality === 'perfect'
        ? '#facc15'
        : '#22c55e';
      this.bannerTimer = 1.3;

      // Efeitos exclusivos de personagem!
      if (this.character.id === 'pedro') {
        this.pedroCarActive = true;
        this.pedroCarX = -90;
      } else if (this.character.id === 'robin') {
        const words = ['POW!', 'BAM!', 'ZAP!', 'GOLAÇO!'];
        this.robinComicWord = words[Math.floor(Math.random() * words.length)];
        this.robinComicTimer = 1.2;
      } else if (
        this.character.id === 'totzin' &&
        Math.floor(this.score / 5) > Math.floor(prevScore / 5)
      ) {
        this.totzinSpeechTimer = 2.0;
      }

      soundEngine.playGoal(firstTimeBeating, this.character.goalSoundUrl);
      this.spawnGoalConfetti();
      if (navigator.vibrate) navigator.vibrate([35, 30, 50]);

      this.emitHudStatus();
      this.callbacks.onScoreChange(this.score, goalsAdded, justBeatRecord);
      return;
    }

    // 3. DEFESA DO GOLEIRO!
    if (this.mode === 'infinite' && this.hasShield) {
      this.consumeShieldSave(impactPt, 'O escudo absorveu a defesa!');
      return;
    }

    this.phase = 'SAVED';
    this.phaseTimer = 0;
    this.screenShake = 11;

    const dirX = this.playerTarget.includes('left')
      ? -1
      : this.playerTarget.includes('right')
        ? 1
        : Math.random() < 0.5
          ? -0.7
          : 0.7;
    this.ballVel = {
      x: dirX * (150 + Math.random() * 70),
      y: -155,
    };

    if (this.character.alwaysSaved) {
      this.bannerText = this.shotQuality === 'perfect' ? 'MILAGRE!' : 'DEFENDEU!';
      this.bannerSubtext =
        this.shotQuality === 'perfect'
          ? 'Nem na gaveta passa hoje, Caus!'
          : 'O goleiro já sabia esse canto!';
    } else if (this.mode === 'infinite' && this.bonusTarget === this.playerTarget) {
      this.bannerText = 'DEFENDEU!';
      this.bannerSubtext = 'No bônus só entra na zona dourada!';
    } else if (this.playerTarget === 'center' && this.keeperTarget === 'center') {
      this.bannerText = 'FICOU NO MEIO!';
      this.bannerSubtext = this.isCavadinha
        ? 'O goleiro pegou a cavadinha!'
        : 'O goleiro nem saiu do lugar!';
    } else {
      this.bannerText = 'DEFENDEU!';
      this.bannerSubtext = 'O goleiro buscou no canto!';
    }
    this.bannerColor = '#ef4444';
    this.bannerTimer = 1.1;

    soundEngine.playSave();
    this.spawnSaveSparks(impactPt);
    if (navigator.vibrate) navigator.vibrate(95);
  }

  private consumeShieldSave(impactPt: Point, subtitle: string): void {
    this.hasShield = false;
    this.hasLostFirstShield = true;
    this.bonusGoalsTowardNextShield = 0;
    this.phase = 'SHIELD_SAVED';
    this.phaseTimer = 0;
    this.screenShake = 8;
    this.ballVel = {
      x: (Math.random() < 0.5 ? -1 : 1) * 140,
      y: -165,
    };

    this.bannerText = 'ESCUDO SALVOU! 🛡️';
    this.bannerSubtext = subtitle;
    this.bannerColor = '#38bdf8';
    this.bannerTimer = 1.2;

    soundEngine.playShieldBreak();
    this.spawnSaveSparks(impactPt, ['#38bdf8', '#7dd3fc', '#ffffff', '#facc15']);
    this.emitHudStatus();
  }

  private resolveDefendImpact(targetPt: Point): void {
    if (!this.isGoalShot) {
      // Jogador defendeu o pênalti do PC!
      this.phase = 'DEFEND_SAVED';
      this.phaseTimer = 0;
      this.screenShake = 9;
      this.crowdExcitement = 1;
      const dirX = this.playerTarget.includes('left') ? -1 : 1;
      this.ballVel = { x: dirX * 165, y: -165 };

      this.bannerText = 'DEFESAÇA! 🧤';
      this.bannerSubtext = 'Você fechou o gol!';
      this.bannerColor = '#38bdf8';
      this.bannerTimer = 1.2;

      soundEngine.playGoal(false);
      this.spawnSaveSparks(targetPt, ['#38bdf8', '#facc15', '#ffffff']);
      if (navigator.vibrate) navigator.vibrate([40, 25, 50]);
    } else {
      this.phase = 'DEFEND_CONCEDED';
      this.phaseTimer = 0;
      this.netBulge = 1;
      this.netImpact = { ...targetPt };
      this.screenShake = 7;

      this.bannerText = 'GOL DO PC!';
      this.bannerSubtext = `${this.getActiveCpuName()} converteu!`;
      this.bannerColor = '#ef4444';
      this.bannerTimer = 1.2;

      soundEngine.playSave();
      if (navigator.vibrate) navigator.vibrate(80);
    }
  }

  private advanceAfterAttack(result: 'goal' | 'miss'): void {
    if (this.mode === 'infinite') {
      this.resetRound(true);
      return;
    }

    this.copaPlayerResults.push(result);
    if (this.checkCopaWinner()) return;

    this.copaTurn = 'cpu';
    this.resetRound(true);
  }

  private advanceAfterCpuKick(result: 'goal' | 'miss'): void {
    this.copaCpuResults.push(result);
    if (this.checkCopaWinner()) return;

    this.copaTurn = 'player';
    this.resetRound(true);
  }

  private checkCopaWinner(): boolean {
    if (this.copaFinished) return true;

    const pGoals = this.copaPlayerResults.filter((r) => r === 'goal').length;
    const cGoals = this.copaCpuResults.filter((r) => r === 'goal').length;
    const pTaken = this.copaPlayerResults.length;
    const cTaken = this.copaCpuResults.length;

    let winner: 'player' | 'cpu' | null = null;

    if (pTaken <= 5 && cTaken <= 5) {
      const pRemaining = 5 - pTaken;
      const cRemaining = 5 - cTaken;
      if (pGoals > cGoals + cRemaining) {
        winner = 'player';
      } else if (cGoals > pGoals + pRemaining) {
        winner = 'cpu';
      }
    } else if (pTaken === cTaken && pGoals !== cGoals) {
      // Morte súbita!
      winner = pGoals > cGoals ? 'player' : 'cpu';
    }

    this.emitHudStatus();

    if (winner) {
      this.copaFinished = true;
      if (winner === 'player') {
        soundEngine.playCopaWin();
        this.spawnGoalConfetti();
      }
      this.callbacks.onGameOver({
        mode: 'copa',
        finalScore: pGoals,
        isNewRecord: false,
        reason: winner === 'player' ? 'copa-win' : 'copa-loss',
        isCaus: this.character.alwaysSaved,
        copaPlayerGoals: pGoals,
        copaCpuGoals: cGoals,
      });
      return true;
    }

    return false;
  }

  // ==================== RENDERIZAÇÃO ====================

  private render(): void {
    const ctx = this.ctx;
    const m = this.metrics;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    if (this.screenShake > 0.2) {
      const sx = (Math.random() - 0.5) * this.screenShake;
      const sy = (Math.random() - 0.5) * this.screenShake;
      ctx.translate(sx, sy);
    }

    this.drawStadiumSkyAndLights(ctx, m);
    this.drawStandsAndCrowd(ctx, m);
    this.drawPitch(ctx, m);

    // Carrinho #95 do Pedro comemorando no fundo do campo
    if (this.pedroCarActive) {
      this.drawPedroCar95(ctx, m);
    }

    this.drawGoalBackAndNet(ctx, m);

    // Alvos de ataque ou defesa
    if (this.phase === 'READY' || this.phase === 'TIMING' || this.phase === 'DEFEND_READY') {
      this.drawTargets(ctx, m);
    }

    // Goleiro (com aura de Modo Paredão se 5+ seguidos!)
    this.drawGoalkeeper(ctx, m);

    // Trave da frente
    this.drawGoalFrame(ctx, m);

    // Bola e rastro
    this.drawBallTrail(ctx);
    this.drawBall(ctx, m);

    // Guia de swipe
    if (this.phase === 'READY' && this.isSwiping) {
      this.drawSwipeGuide(ctx, m);
    }

    // Batedor em primeiro plano
    this.drawKicker(ctx, m);

    // Barra de precisão (Timing)
    if (this.phase === 'TIMING') {
      this.drawTimingBar(ctx, m);
    }

    // Dica de Paradinha durante a corrida
    if (this.phase === 'RUNNING_UP' && !this.didParadinha && this.kickerProgress < 0.65) {
      this.drawParadinhaPrompt(ctx, m);
    }

    // Banner rápido de Paradinha
    if (this.paradinhaBannerTimer > 0) {
      this.drawParadinhaPopup(ctx, m);
    }

    // Dica de defesa no Modo Copa
    if (this.phase === 'DEFEND_READY') {
      this.drawDefendPrompt(ctx, m);
    }

    // Balão HQ do Robin
    if (this.robinComicTimer > 0) {
      this.drawRobinComicBurst(ctx, m);
    }

    // Balão de fala do Totzin a cada 5 gols ("Faça o L !!")
    if (this.totzinSpeechTimer > 0) {
      this.drawTotzinSpeechBubble(ctx, m);
    }

    // Partículas
    this.drawParticles(ctx);

    // Aura quente nas bordas quando ON FIRE
    if (this.isOnFire && this.mode === 'infinite') {
      this.drawOnFireEdgeGlow(ctx, m);
    }

    // Banner principal
    if (this.bannerTimer > 0) {
      this.drawBanner(ctx, m);
    }

    ctx.restore();
  }

  private drawOnFireEdgeGlow(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const pulse = 0.14 + Math.sin(this.elapsed * 7) * 0.05;
    const grad = ctx.createRadialGradient(
      m.w * 0.5,
      m.h * 0.5,
      m.w * 0.32,
      m.w * 0.5,
      m.h * 0.5,
      m.h * 0.65
    );
    grad.addColorStop(0, 'rgba(251, 146, 60, 0)');
    grad.addColorStop(1, `rgba(249, 115, 22, ${pulse})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, m.w, m.h);
  }

  private drawTimingBar(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const barW = Math.min(m.w * 0.78, 280);
    const barH = 22;
    const bx = (m.w - barW) * 0.5;
    const by = m.ballStart.y - m.ballRadius * 2.95;

    ctx.save();

    // Fundo escuro
    ctx.fillStyle = 'rgba(7, 17, 36, 0.9)';
    ctx.beginPath();
    ctx.roundRect(bx - 6, by - 26, barW + 12, barH + 34, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Texto de instrução (destaca o risco quando mirando no Alvo Bônus!)
    const isBonusAim =
      this.mode === 'infinite' &&
      this.bonusTarget !== null &&
      this.playerTarget === this.bonusTarget;
    ctx.fillStyle = isBonusAim ? '#facc15' : '#fde68a';
    ctx.font = '900 10.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      isBonusAim ? '★ BÔNUS! SÓ ENTRA NA ZONA DOURADA!' : '⚡ TOQUE NA TELA PARA CHUTAR!',
      m.w * 0.5,
      by - 12
    );

    // Zonas da barra (Vermelho | Verde | Dourado | Verde | Vermelho)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, 11);
    ctx.clip();

    // Vermelho (pontas 0..15% e 85..100%)
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(bx, by, barW, barH);

    // Verde (15%..85%)
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(bx + barW * 0.15, by, barW * 0.7, barH);

    // Dourado Perfeito (40%..60%)
    const goldGrad = ctx.createLinearGradient(bx + barW * 0.4, by, bx + barW * 0.6, by);
    goldGrad.addColorStop(0, '#f59e0b');
    goldGrad.addColorStop(0.5, '#fef08a');
    goldGrad.addColorStop(1, '#f59e0b');
    ctx.fillStyle = goldGrad;
    ctx.fillRect(bx + barW * 0.4, by, barW * 0.2, barH);

    ctx.restore();

    // Borda da barra
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, 11);
    ctx.stroke();

    // Estrela no centro da zona dourada
    ctx.fillStyle = '#09152b';
    ctx.font = '900 12px system-ui, sans-serif';
    ctx.fillText('★', bx + barW * 0.5, by + barH * 0.53);

    // Cursor oscilando
    const cx = bx + this.timingCursor * barW;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#09152b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(cx - 5, by - 4, 10, barH + 8, 5);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawParadinhaPrompt(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const cx = m.w * 0.5;
    const cy = m.h * 0.62;
    ctx.save();
    ctx.fillStyle = 'rgba(9, 21, 44, 0.85)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - 105, cy - 16, 210, 32, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e0f2fe';
    ctx.font = '900 11.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ TOQUE P/ PARADINHA!', cx, cy + 0.5);
    ctx.restore();
  }

  private drawParadinhaPopup(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const alpha = clamp(this.paradinhaBannerTimer / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#09152b';
    ctx.lineWidth = 5;
    const text = '⚡ PARADINHA!';
    ctx.strokeText(text, m.w * 0.5, m.h * 0.58);
    ctx.fillText(text, m.w * 0.5, m.h * 0.58);
    ctx.restore();
  }

  private drawDefendPrompt(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const cx = m.w * 0.5;
    const cy = m.h * 0.61;
    ctx.save();
    ctx.fillStyle = 'rgba(7, 21, 46, 0.9)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(cx - 134, cy - 24, 268, 48, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = '900 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🧤 DEFENDA ${this.getActiveCpuName().toUpperCase()}!`, cx, cy - 7);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText('Toque no canto onde quer mergulhar', cx, cy + 10);
    ctx.restore();
  }

  private drawPedroCar95(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const x = this.pedroCarX;
    const y = m.goalBottom + 16;

    ctx.save();
    ctx.translate(x, y);

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(0, 13, 38, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Carroceria vermelha #95 estilizada
    ctx.fillStyle = '#e11d48';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-36, 8);
    ctx.lineTo(-34, -4);
    ctx.lineTo(-16, -16);
    ctx.lineTo(12, -16);
    ctx.lineTo(34, -3);
    ctx.lineTo(38, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Aerofólio
    ctx.fillStyle = '#be123c';
    ctx.beginPath();
    ctx.roundRect(-40, -14, 10, 6, 2);
    ctx.fill();
    ctx.stroke();

    // Para-brisa com olhos cartoon
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(-12, -13);
    ctx.lineTo(10, -13);
    ctx.lineTo(18, -4);
    ctx.lineTo(-14, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.arc(0, -8.5, 2.6, 0, Math.PI * 2);
    ctx.arc(9, -8.5, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Raio amarelo + número 95
    ctx.fillStyle = '#facc15';
    ctx.font = '900 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('95', -2, 3);

    // Rodas
    [-20, 20].forEach((wx) => {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(wx, 9, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(wx, 9, 3.6, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  private drawRobinComicBurst(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const enter = clamp(1 - (this.robinComicTimer > 0.95 ? (this.robinComicTimer - 0.95) / 0.25 : 0), 0.05, 1);
    const scale = easeOutBack(enter);
    const cx = m.w * 0.5;
    const cy = m.goalTop + m.goalH * 0.32;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.1);
    ctx.scale(scale, scale);

    // Estrela explosiva HQ
    const spikes = 12;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (i * Math.PI) / spikes;
      const r = i % 2 === 0 ? 74 : 46;
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r * 0.62;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 4;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 4;
    ctx.font = '900 30px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(this.robinComicWord, 0, 2);
    ctx.fillText(this.robinComicWord, 0, 2);

    ctx.restore();
  }

  private drawTotzinSpeechBubble(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const enter = clamp(
      1 - (this.totzinSpeechTimer > 1.75 ? (this.totzinSpeechTimer - 1.75) / 0.25 : 0),
      0.05,
      1
    );
    const fadeOut = clamp(this.totzinSpeechTimer / 0.28, 0, 1);
    const scale = easeOutBack(enter);

    const bx = clamp(m.kickerKick.x + m.w * 0.13, 108, m.w - 108);
    const by = m.kickerKick.y - m.kickerHeight * 1.05;

    ctx.save();
    ctx.globalAlpha = fadeOut;
    ctx.translate(bx, by);
    ctx.scale(scale, scale);

    const w = 178;
    const h = 48;

    // Sombra suave do balão
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.roundRect(-w * 0.5 + 3, -h * 0.5 + 4, w, h, 18);
    ctx.fill();

    // Corpo branco do balão + rabicho apontando pro Totzin
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-w * 0.5, -h * 0.5, w, h, 18);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-30, h * 0.5 - 2);
    ctx.lineTo(-46, h * 0.5 + 15);
    ctx.lineTo(-10, h * 0.5 - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Limpa a linha interna da junção do rabicho
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-31, h * 0.5 - 5, 22, 6);

    // Texto em vermelho vibrante
    ctx.fillStyle = '#dc2626';
    ctx.font = '900 21px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Faça o L !!', 0, 1);

    ctx.restore();
  }

  private drawStadiumSkyAndLights(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, m.horizonY);
    skyGrad.addColorStop(0, '#040b18');
    skyGrad.addColorStop(0.55, '#0b1e40');
    skyGrad.addColorStop(1, '#133163');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, m.w, m.horizonY + 10);

    const towers = [m.w * 0.14, m.w * 0.86];
    towers.forEach((tx, idx) => {
      const ty = m.h * 0.095;
      const beam = ctx.createRadialGradient(tx, ty, 6, tx, ty + m.h * 0.14, m.w * 0.55);
      beam.addColorStop(0, 'rgba(255, 252, 230, 0.26)');
      beam.addColorStop(0.4, 'rgba(186, 224, 255, 0.08)');
      beam.addColorStop(1, 'rgba(186, 224, 255, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(idx === 0 ? m.w * 0.72 : m.w * 0.28, m.horizonY + 40);
      ctx.lineTo(idx === 0 ? -m.w * 0.1 : m.w * 1.1, m.horizonY + 40);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fffde7';
      ctx.shadowColor = '#fde68a';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.roundRect(tx - 16, ty - 5, 32, 10, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  private drawStandsAndCrowd(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const standTop = m.h * 0.185;
    const standBottom = m.horizonY;
    const standH = standBottom - standTop;

    const standGrad = ctx.createLinearGradient(0, standTop, 0, standBottom);
    standGrad.addColorStop(0, '#0a162d');
    standGrad.addColorStop(1, '#122547');
    ctx.fillStyle = standGrad;
    ctx.fillRect(0, standTop, m.w, standH);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) {
      const ry = standTop + (standH * r) / 4;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(m.w, ry);
      ctx.stroke();
    }

    const fireBoost = this.isOnFire ? 0.35 : 0;
    const jumpAmp = 2 + (this.crowdExcitement + fireBoost) * 9;
    const jumpFreq = 4 + (this.crowdExcitement + fireBoost) * 12;

    for (const fan of this.crowd) {
      const fx = fan.nx * m.w;
      const baseY = standTop + 14 + (fan.row / 3.4) * (standH - 22);
      const bounce = Math.abs(Math.sin(this.elapsed * jumpFreq + fan.phase)) * jumpAmp;
      const fy = baseY - bounce;

      ctx.fillStyle = fan.color;
      ctx.globalAlpha = 0.68 + fan.row * 0.08;
      ctx.beginPath();
      ctx.roundRect(fx - 4.5, fy, 9, 10, 3);
      ctx.fill();

      ctx.fillStyle = '#e2c2a2';
      ctx.beginPath();
      ctx.arc(fx, fy - 3.2, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const boardH = 16;
    const boardY = standBottom - boardH;
    ctx.fillStyle = '#0f2d6b';
    ctx.fillRect(0, boardY, m.w, boardH);

    ctx.fillStyle = '#d92638';
    for (let x = -20; x < m.w + 20; x += 64) {
      ctx.fillRect(x, boardY, 18, boardH);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '900 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = this.mode === 'copa'
      ? ['COPA NMFC', '•', 'PÊNALTIS', '•', 'COPA NMFC', '•', 'PÊNALTIS']
      : ['NMFC', '•', 'PÊNALTIS', '•', 'NMFC', '•', 'PÊNALTIS'];
    labels.forEach((txt, i) => {
      ctx.fillText(txt, ((i + 0.5) / labels.length) * m.w, boardY + boardH * 0.54);
    });
  }

  private drawPitch(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const pitchH = m.h - m.horizonY;

    const grassGrad = ctx.createLinearGradient(0, m.horizonY, 0, m.h);
    grassGrad.addColorStop(0, '#146e34');
    grassGrad.addColorStop(0.35, '#198740');
    grassGrad.addColorStop(1, '#1da44c');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, m.horizonY, m.w, pitchH);

    const bands = 7;
    for (let i = 0; i < bands; i++) {
      if (i % 2 === 0) continue;
      const t0 = Math.pow(i / bands, 1.35);
      const t1 = Math.pow((i + 1) / bands, 1.35);
      const y0 = m.horizonY + pitchH * t0;
      const y1 = m.horizonY + pitchH * t1;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
      ctx.fillRect(0, y0, m.w, y1 - y0);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(0, m.goalBottom);
    ctx.lineTo(m.w, m.goalBottom);
    ctx.stroke();

    const boxTopHalf = m.goalW * 0.62;
    const boxBotHalf = m.goalW * 0.88;
    const boxBotY = m.goalBottom + pitchH * 0.24;
    ctx.beginPath();
    ctx.moveTo(m.w * 0.5 - boxTopHalf, m.goalBottom);
    ctx.lineTo(m.w * 0.5 - boxBotHalf, boxBotY);
    ctx.lineTo(m.w * 0.5 + boxBotHalf, boxBotY);
    ctx.lineTo(m.w * 0.5 + boxTopHalf, m.goalBottom);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.ellipse(m.ballStart.x, m.ballStart.y + m.ballRadius * 0.58, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGoalBackAndNet(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const depthX = m.goalW * 0.065;
    const depthY = m.goalH * 0.13;

    const backLeft = m.goalLeft + depthX;
    const backRight = m.goalRight - depthX;
    const backTop = m.goalTop + depthY;
    const backBottom = m.goalBottom - depthY * 0.35;

    ctx.fillStyle = 'rgba(4, 14, 30, 0.42)';
    ctx.fillRect(m.goalLeft, m.goalTop, m.goalW, m.goalH);

    ctx.strokeStyle = 'rgba(235, 245, 255, 0.34)';
    ctx.lineWidth = 1.15;

    const cols = 16;
    const rows = 8;

    const deform = (x: number, y: number): Point => {
      if (this.netBulge <= 0.01) return { x, y };
      const dx = x - this.netImpact.x;
      const dy = y - this.netImpact.y;
      const dist = Math.hypot(dx, dy);
      const radius = m.goalW * 0.28;
      if (dist >= radius) return { x, y };
      const k = Math.cos((dist / radius) * Math.PI * 0.5) * this.netBulge;
      const wave = Math.sin(this.elapsed * 26) * 4 * k;
      return {
        x: x + dx * 0.16 * k + wave * 0.5,
        y: y + dy * 0.16 * k - 10 * k,
      };
    };

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const topX = lerp(m.goalLeft, m.goalRight, u);
      const backX = lerp(backLeft, backRight, u);
      ctx.beginPath();
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        const px = lerp(topX, backX, v * 0.65);
        const py = lerp(m.goalTop, backBottom, v);
        const pt = deform(px, py);
        if (r === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const py = lerp(m.goalTop, backBottom, v);
      const lx = lerp(m.goalLeft, backLeft, v * 0.65);
      const rx = lerp(m.goalRight, backRight, v * 0.65);
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const px = lerp(lx, rx, u);
        const pt = deform(px, py);
        if (c === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(200, 215, 235, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(m.goalLeft, m.goalTop);
    ctx.lineTo(backLeft, backTop);
    ctx.lineTo(backLeft, backBottom);
    ctx.moveTo(m.goalRight, m.goalTop);
    ctx.lineTo(backRight, backTop);
    ctx.lineTo(backRight, backBottom);
    ctx.moveTo(backLeft, backTop);
    ctx.lineTo(backRight, backTop);
    ctx.stroke();
  }

  private drawGoalFrame(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const postWidth = clamp(m.goalW * 0.028, 7, 11);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = postWidth + 4;
    ctx.beginPath();
    ctx.moveTo(m.goalLeft, m.goalBottom + 2);
    ctx.lineTo(m.goalLeft, m.goalTop + 2);
    ctx.lineTo(m.goalRight, m.goalTop + 2);
    ctx.lineTo(m.goalRight, m.goalBottom + 2);
    ctx.stroke();

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = postWidth;
    ctx.beginPath();
    ctx.moveTo(m.goalLeft, m.goalBottom);
    ctx.lineTo(m.goalLeft, m.goalTop);
    ctx.lineTo(m.goalRight, m.goalTop);
    ctx.lineTo(m.goalRight, m.goalBottom);
    ctx.stroke();

    ctx.restore();
  }

  private drawTargets(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const pulse = 1 + Math.sin(this.elapsed * 4.8) * 0.08;
    const isDefending = this.phase === 'DEFEND_READY';
    const isTiming = this.phase === 'TIMING';

    for (const id of TARGET_IDS) {
      if (isTiming && id !== this.playerTarget) continue;

      const pt = m.targets[id];
      const isBonus = !isDefending && this.bonusTarget === id;
      const isActive = isTiming ? id === this.playerTarget : this.hoveredTarget === id;
      const r = m.targetRadius * (isActive ? 1.18 : isBonus ? 1.08 * pulse : pulse);

      ctx.save();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      if (isDefending) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      } else if (isActive || isBonus) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.32)';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      }
      ctx.fill();

      ctx.lineWidth = isActive || isBonus ? 3 : 2;
      ctx.strokeStyle = isDefending
        ? '#38bdf8'
        : isActive || isBonus
          ? '#facc15'
          : 'rgba(255, 255, 255, 0.65)';
      if (!isActive && !isBonus) {
        ctx.setLineDash([6, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      if (isDefending) {
        ctx.font = '15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🧤', pt.x, pt.y + 1);
      } else if (isBonus) {
        ctx.fillStyle = '#fef08a';
        ctx.font = '900 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★+2', pt.x, pt.y + 1);
      } else {
        ctx.fillStyle = isActive ? '#facc15' : 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isActive ? 5 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isActive && !isDefending) {
        ctx.font = '800 9.5px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#09152b';
        const pillW = 62;
        const pillH = 16;
        ctx.beginPath();
        ctx.roundRect(pt.x - pillW * 0.5, pt.y + r + 4, pillW, pillH, 8);
        ctx.fill();
        ctx.fillStyle = '#facc15';
        ctx.fillText(TARGET_LABELS[id], pt.x, pt.y + r + 12.5);
      }

      ctx.restore();
    }
  }

  private drawGoalkeeper(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const gkHeight = m.goalH * 0.84;
    const baseX = m.w * 0.5;
    const baseY = m.goalBottom - gkHeight * 0.44;

    let posX = baseX;
    let posY = baseY;
    let tilt = 0;
    let scaleX = 1;
    let scaleY = 1;
    let diveSpeedAlpha = 0;
    let diveDirX = 0;

    const isWaitingPhase =
      this.phase === 'READY' ||
      this.phase === 'TIMING' ||
      this.phase === 'DEFEND_READY' ||
      this.phase === 'DEFEND_RUNUP' ||
      (this.phase === 'RUNNING_UP' && this.keeperProgress === 0);

    const isAlert =
      this.phase === 'TIMING' ||
      this.phase === 'RUNNING_UP' ||
      this.phase === 'DEFEND_RUNUP';

    const readyFreq = isAlert ? 10.5 : 4.2;
    const readyWave = Math.sin(this.elapsed * readyFreq);
    const armBreath = Math.sin(this.elapsed * (isAlert ? 12 : 5.2));

    let leftUpperAng = 2.32 + armBreath * 0.06;
    let leftForeAng = 2.94 + armBreath * 0.1;
    let rightUpperAng = 0.82 - armBreath * 0.06;
    let rightForeAng = 0.2 - armBreath * 0.1;
    let gloveStretch = 1;

    if (isWaitingPhase) {
      const lateralAmp = isAlert ? 4.5 : 7.5;
      posX += readyWave * lateralAmp;
      const crouchBounce = Math.abs(Math.sin(this.elapsed * readyFreq * 1.35));
      const baseCrouch = isAlert ? 0.9 : 0.94;
      scaleY = baseCrouch - crouchBounce * 0.035;
      scaleX = 1.04 + crouchBounce * 0.025;
      posY = baseY + (1 - scaleY) * gkHeight * 0.45 + crouchBounce * 2.5;
      tilt = readyWave * 0.035;

      if (isAlert) {
        leftUpperAng = 2.55 + armBreath * 0.08;
        leftForeAng = 3.28 + armBreath * 0.1;
        rightUpperAng = 0.59 - armBreath * 0.08;
        rightForeAng = -0.14 - armBreath * 0.1;
      }
    } else {
      const p = this.keeperProgress;
      const armT = easeOutCubic(clamp(p * 1.25, 0, 1));
      const targetPt = m.targets[this.keeperTarget];
      const arcLift = Math.sin(p * Math.PI) * m.goalH * 0.11;
      diveSpeedAlpha = Math.sin(p * Math.PI) * 0.65;
      gloveStretch = lerp(1, 1.14, armT);

      const reach = gkHeight * 0.56;
      let finalTilt = 0;
      let destX = baseX;
      let destY = baseY;

      switch (this.keeperTarget) {
        case 'top-left':
          finalTilt = -0.84;
          destX = targetPt.x - Math.sin(finalTilt) * reach;
          destY = targetPt.y + Math.cos(finalTilt) * reach;
          diveDirX = -1;
          leftUpperAng = lerp(2.55, 4.54, armT);
          leftForeAng = lerp(3.28, 4.58, armT);
          rightUpperAng = lerp(0.59, -1.46, armT);
          rightForeAng = lerp(-0.14, -1.52, armT);
          break;
        case 'bottom-left':
          finalTilt = -1.32;
          destX = targetPt.x - Math.sin(finalTilt) * reach;
          destY = Math.min(m.goalBottom - gkHeight * 0.12, targetPt.y + Math.cos(finalTilt) * reach);
          diveDirX = -1;
          leftUpperAng = lerp(2.55, 4.6, armT);
          leftForeAng = lerp(3.28, 4.64, armT);
          rightUpperAng = lerp(0.59, -1.48, armT);
          rightForeAng = lerp(-0.14, -1.54, armT);
          break;
        case 'top-right':
          finalTilt = 0.84;
          destX = targetPt.x - Math.sin(finalTilt) * reach;
          destY = targetPt.y + Math.cos(finalTilt) * reach;
          diveDirX = 1;
          leftUpperAng = lerp(2.55, 4.64, armT);
          leftForeAng = lerp(3.28, 4.68, armT);
          rightUpperAng = lerp(0.59, -1.4, armT);
          rightForeAng = lerp(-0.14, -1.44, armT);
          break;
        case 'bottom-right':
          finalTilt = 1.32;
          destX = targetPt.x - Math.sin(finalTilt) * reach;
          destY = Math.min(m.goalBottom - gkHeight * 0.12, targetPt.y + Math.cos(finalTilt) * reach);
          diveDirX = 1;
          leftUpperAng = lerp(2.55, 4.68, armT);
          leftForeAng = lerp(3.28, 4.7, armT);
          rightUpperAng = lerp(0.59, -1.46, armT);
          rightForeAng = lerp(-0.14, -1.5, armT);
          break;
        case 'center':
          finalTilt = 0;
          destX = baseX;
          destY = targetPt.y + reach * 0.72;
          diveDirX = 0;
          leftUpperAng = lerp(2.55, 4.46, armT);
          leftForeAng = lerp(3.28, 4.62, armT);
          rightUpperAng = lerp(0.59, -1.32, armT);
          rightForeAng = lerp(-0.14, -1.48, armT);
          break;
      }

      posX = lerp(baseX, destX, p);
      posY = lerp(baseY, destY, p) - (diveDirX !== 0 ? arcLift : Math.sin(p * Math.PI) * m.goalH * 0.08);
      tilt = lerp(0, finalTilt, p);
      scaleX = lerp(1.03, 0.98, p);
      scaleY = lerp(0.92, 1.07, p);
    }

    // Aura vermelha no Modo Paredão (5+ gols seguidos no modo Infinito)
    if (this.isParedao) {
      const aura = 0.25 + Math.sin(this.elapsed * 8) * 0.12;
      const g = ctx.createRadialGradient(posX, posY, gkHeight * 0.1, posX, posY, gkHeight * 0.72);
      g.addColorStop(0, `rgba(239, 68, 68, ${aura})`);
      g.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(posX, posY, gkHeight * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sombra dinâmica
    ctx.save();
    const heightOffGround = Math.max(0, baseY - posY);
    const shadowAlpha = clamp(0.36 - heightOffGround * 0.0022, 0.16, 0.36);
    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(
      posX,
      m.goalBottom + 1,
      gkHeight * (0.26 + Math.abs(tilt) * 0.2),
      gkHeight * 0.06,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    if (diveSpeedAlpha > 0.05 && diveDirX !== 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(254, 240, 138, ${diveSpeedAlpha * 0.55})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const ly = posY + i * gkHeight * 0.16;
        const startX = posX - diveDirX * gkHeight * 0.22;
        const len = gkHeight * (0.3 + (i === 0 ? 0.12 : 0));
        ctx.beginPath();
        ctx.moveTo(startX, ly);
        ctx.lineTo(startX - diveDirX * len, ly + i * 3);
        ctx.stroke();
      }
      ctx.restore();
    }

    const rig = this.goalkeeperSprites?.goalkeeperRig ?? null;

    ctx.save();
    ctx.translate(posX, posY);
    ctx.rotate(tilt);
    ctx.scale(scaleX, scaleY);

    if (rig) {
      const scale = gkHeight / Math.max(1, rig.height);
      const drawW = rig.width * scale;
      const bodyOriginX = -rig.centerX * scale;
      const bodyOriginY = -gkHeight * 0.52;

      const leftShX = (rig.leftShoulderX - rig.centerX) * scale;
      const rightShX = (rig.rightShoulderX - rig.centerX) * scale;
      const shY = bodyOriginY + rig.shoulderY * scale;

      const upperLen = gkHeight * 0.17;
      const foreLen = gkHeight * 0.165;
      const thickness = gkHeight * 0.072;

      ctx.drawImage(rig.body, bodyOriginX, bodyOriginY, drawW, gkHeight);

      this.drawGoalkeeperArm(
        ctx,
        leftShX,
        shY,
        leftUpperAng,
        leftForeAng,
        upperLen,
        foreLen,
        thickness,
        -1,
        gloveStretch
      );
      this.drawGoalkeeperArm(
        ctx,
        rightShX,
        shY,
        rightUpperAng,
        rightForeAng,
        upperLen,
        foreLen,
        thickness,
        1,
        gloveStretch
      );
    } else {
      const u = m.goalH * 0.0115;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.roundRect(-u * 13, -u * 16, u * 26, u * 30, u * 6);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.roundRect(-u * 12, u * 10, u * 24, u * 14, u * 3);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawGoalkeeperArm(
    ctx: CanvasRenderingContext2D,
    shX: number,
    shY: number,
    upperAng: number,
    foreAng: number,
    upperLen: number,
    foreLen: number,
    thickness: number,
    side: -1 | 1,
    gloveScale: number
  ): void {
    const elbowX = shX + Math.cos(upperAng) * upperLen;
    const elbowY = shY + Math.sin(upperAng) * upperLen;
    const wristX = elbowX + Math.cos(foreAng) * foreLen;
    const wristY = elbowY + Math.sin(foreAng) * foreLen;

    const drawSleeveSegment = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      width: number,
      withStripes: boolean
    ) => {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const r = width * 0.5;

      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(ang);

      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, '#fff200');
      grad.addColorStop(0.65, '#facc15');
      grad.addColorStop(1, '#d4a100');

      ctx.fillStyle = grad;
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = Math.max(1.5, width * 0.16);
      ctx.beginPath();
      ctx.roundRect(-r * 0.55, -r, len + r * 1.1, width, r);
      ctx.fill();
      ctx.stroke();

      if (withStripes) {
        ctx.strokeStyle = '#18181b';
        ctx.lineWidth = Math.max(1.1, width * 0.11);
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.35);
        ctx.lineTo(len * 0.88, -r * 0.35);
        ctx.moveTo(0, 0);
        ctx.lineTo(len * 0.88, 0);
        ctx.stroke();
      }

      ctx.restore();
    };

    drawSleeveSegment(shX, shY, elbowX, elbowY, thickness, true);
    drawSleeveSegment(elbowX, elbowY, wristX, wristY, thickness * 0.88, false);

    ctx.save();
    ctx.translate(wristX, wristY);
    ctx.rotate(foreAng);
    ctx.scale(gloveScale, gloveScale);

    const gw = thickness * 1.48;
    const gh = thickness * 1.18;

    ctx.fillStyle = '#1f2430';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.4, thickness * 0.15);
    ctx.beginPath();
    ctx.roundRect(-thickness * 0.45, -gh * 0.38, thickness * 0.65, gh * 0.76, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1e2430';
    ctx.beginPath();
    ctx.roundRect(0, -gh * 0.52, gw * 0.86, gh * 1.04, gh * 0.44);
    ctx.fill();
    ctx.stroke();

    const thumbDir = side === -1 ? -1 : 1;
    ctx.fillStyle = '#1e2430';
    ctx.beginPath();
    ctx.ellipse(
      gw * 0.28,
      thumbDir * gh * 0.56,
      gw * 0.25,
      gh * 0.22,
      thumbDir * 0.45,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(gw * 0.16, -gh * 0.3, gw * 0.48, gh * 0.6, gh * 0.24);
    ctx.fill();

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1, thickness * 0.1);
    ctx.beginPath();
    ctx.moveTo(gw * 0.58, -gh * 0.18);
    ctx.lineTo(gw * 0.82, -gh * 0.18);
    ctx.moveTo(gw * 0.58, gh * 0.18);
    ctx.lineTo(gw * 0.82, gh * 0.18);
    ctx.stroke();

    ctx.restore();
  }

  private drawBallTrail(ctx: CanvasRenderingContext2D): void {
    for (const tr of this.ballTrail) {
      if (tr.fire) {
        const g = ctx.createRadialGradient(tr.x, tr.y, 1, tr.x, tr.y, tr.r * 1.45);
        g.addColorStop(0, `rgba(254, 240, 138, ${tr.alpha})`);
        g.addColorStop(0.55, `rgba(249, 115, 22, ${tr.alpha * 0.85})`);
        g.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, tr.r * 1.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${tr.alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const r = m.ballRadius * this.ballScale;

    const lift = Math.max(0, this.ballShadowPos.y - (this.ballPos.y + r));
    const shadowScale = clamp(1 - lift / 180, 0.45, 1);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.38 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(
      this.ballShadowPos.x,
      this.ballShadowPos.y,
      r * 0.95 * shadowScale,
      r * 0.36 * shadowScale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.save();
    ctx.translate(this.ballPos.x, this.ballPos.y);

    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.72, '#e2e8f0');
    grad.addColorStop(1, '#94a3b8');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.rotate(this.ballRotation);

    ctx.fillStyle = '#111827';
    const drawPentagon = (cx: number, cy: number, pr: number) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const ang = (-90 + i * 72) * (Math.PI / 180);
        const px = cx + Math.cos(ang) * pr;
        const py = cy + Math.sin(ang) * pr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    };

    drawPentagon(0, 0, r * 0.36);
    for (let i = 0; i < 5; i++) {
      const ang = (-90 + i * 72) * (Math.PI / 180);
      drawPentagon(Math.cos(ang) * r * 0.96, Math.sin(ang) * r * 0.96, r * 0.3);
    }
    ctx.restore();

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawSwipeGuide(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const start = m.ballStart;
    const end = this.hoveredTarget ? m.targets[this.hoveredTarget] : this.pointerCurrent;

    ctx.save();
    const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    grad.addColorStop(0, 'rgba(250, 204, 21, 0.25)');
    grad.addColorStop(1, 'rgba(250, 204, 21, 0.95)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    const midX = (start.x + end.x) * 0.5;
    const midY = (start.y + end.y) * 0.5 - 24;
    ctx.quadraticCurveTo(midX, midY, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const angle = Math.atan2(end.y - midY, end.x - midX);
    ctx.fillStyle = '#facc15';
    ctx.translate(end.x, end.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-14, -8);
    ctx.lineTo(-10, 0);
    ctx.lineTo(-14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawKicker(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const isIdle =
      this.phase === 'READY' || this.phase === 'TIMING' || this.phase === 'DEFEND_READY';
    const isRunning = this.phase === 'RUNNING_UP' || this.phase === 'DEFEND_RUNUP';
    const isFlight = this.phase === 'BALL_FLIGHT' || this.phase === 'DEFEND_FLIGHT';
    const isGoalAnim = this.phase === 'GOAL' || this.phase === 'DEFEND_CONCEDED';
    const isSadAnim =
      this.phase === 'SAVED' ||
      this.phase === 'POST_MISS' ||
      this.phase === 'DEFEND_SAVED';

    const p = isIdle ? 0 : isRunning ? this.kickerProgress : 1;

    const runMoveT = clamp(p / 0.86, 0, 1);
    const easeMove = easeOutCubic(runMoveT);
    const arcX = Math.sin(runMoveT * Math.PI) * -m.w * 0.035;
    const kx = lerp(m.kickerIdle.x, m.kickerKick.x, easeMove) + arcX;
    const ky = lerp(m.kickerIdle.y, m.kickerKick.y, easeMove);

    const perspectiveScale = lerp(1.06, 0.95, easeMove);
    const drawH = m.kickerHeight * perspectiveScale;

    let bodyBounceY = 0;
    let bodyTilt = 0;
    let bodyScaleX = 1;
    let bodyScaleY = 1;
    let leftLegRot = 0;
    let leftLegScaleY = 1;
    let leftLegLiftY = 0;
    let rightLegRot = 0;
    let rightLegScaleY = 1;
    let rightLegLiftY = 0;

    if (isIdle) {
      const breath = Math.sin(this.elapsed * 3.4);
      bodyBounceY = breath * 2.2;
      bodyScaleY = 1 + breath * 0.012;
      bodyTilt = Math.sin(this.elapsed * 1.7) * 0.018;
    } else if (isRunning) {
      if (this.paradinhaPause > 0) {
        // Pose congelada estilosa da paradinha!
        bodyTilt = -0.1;
        bodyBounceY = 4;
        rightLegScaleY = 0.72;
        rightLegLiftY = -drawH * 0.06;
        rightLegRot = -0.22;
      } else if (p < 0.74) {
        const runT = p / 0.74;
        const stride = runT * Math.PI * 3.5;
        const leftWave = Math.sin(stride);
        const rightWave = Math.sin(stride + Math.PI);
        const leftAir = Math.max(0, leftWave);
        const rightAir = Math.max(0, rightWave);

        leftLegScaleY = 1 - leftAir * 0.27;
        leftLegLiftY = -leftAir * drawH * 0.065;
        leftLegRot = -leftWave * 0.16;

        rightLegScaleY = 1 - rightAir * 0.27;
        rightLegLiftY = -rightAir * drawH * 0.065;
        rightLegRot = rightWave * 0.16;

        bodyBounceY = -Math.abs(Math.sin(stride)) * drawH * 0.055;
        bodyTilt = Math.sin(stride) * 0.075 + 0.04;
        bodyScaleY = 0.98 + Math.abs(Math.sin(stride)) * 0.03;
      } else {
        const wT = easeOutCubic((p - 0.74) / 0.26);
        leftLegRot = lerp(0, 0.12, wT);
        rightLegScaleY = lerp(1, 0.62, wT);
        rightLegLiftY = -wT * drawH * 0.095;
        rightLegRot = lerp(0, -0.34, wT);
        bodyTilt = lerp(0.04, -0.13, wT);
        bodyBounceY = lerp(-4, 3, wT);
        bodyScaleX = lerp(1, 0.96, wT);
      }
    } else if (isFlight) {
      const strikeDuration = 0.14;
      const settleDuration = 0.3;
      if (this.phaseTimer <= strikeDuration) {
        const sT = easeOutCubic(clamp(this.phaseTimer / strikeDuration, 0, 1));
        leftLegRot = lerp(0.12, 0.08, sT);
        rightLegScaleY = lerp(0.62, 1.12, sT);
        rightLegLiftY = lerp(-drawH * 0.095, -drawH * 0.025, sT);
        rightLegRot = lerp(-0.34, 0.52, sT);
        bodyTilt = lerp(-0.13, -0.19, sT);
        bodyBounceY = lerp(3, -drawH * 0.03, sT);
        bodyScaleX = lerp(0.96, 1.03, sT);
      } else {
        const fT = easeOutCubic(clamp((this.phaseTimer - strikeDuration) / settleDuration, 0, 1));
        leftLegRot = lerp(0.08, 0, fT);
        rightLegScaleY = lerp(1.12, 1, fT);
        rightLegLiftY = lerp(-drawH * 0.025, 0, fT);
        rightLegRot = lerp(0.52, 0.04, fT);
        bodyTilt = lerp(-0.19, -0.02, fT);
        bodyBounceY = lerp(-drawH * 0.03, 0, fT);
        bodyScaleX = lerp(1.03, 1, fT);
      }
    } else if (isGoalAnim) {
      const jump = Math.abs(Math.sin(this.elapsed * 11));
      bodyBounceY = -jump * drawH * 0.11;
      bodyTilt = Math.sin(this.elapsed * 11) * 0.08;
      leftLegRot = jump * 0.18;
      rightLegRot = -jump * 0.18;
      leftLegScaleY = 1 - jump * 0.1;
      rightLegScaleY = 1 - jump * 0.1;
    } else if (isSadAnim) {
      const slump = clamp(this.phaseTimer / 0.35, 0, 1);
      bodyBounceY = slump * 5;
      bodyScaleY = 1 - slump * 0.05;
      bodyTilt = slump * 0.06;
    }

    const shadowScale = clamp(1 + bodyBounceY / (drawH * 0.45), 0.72, 1.08);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(
      kx,
      ky + 2,
      drawH * 0.25 * shadowScale,
      drawH * 0.06 * shadowScale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    if (this.kickSwooshTimer > 0) {
      this.drawKickSwoosh(ctx, m);
    }

    const activeSprites = this.getActiveKickerSprites();
    const rig = activeSprites?.kickerRig ?? null;
    if (!rig) {
      const sprite = activeSprites?.back ?? null;
      if (!sprite) return;
      const aspect = sprite.width / Math.max(1, sprite.height);
      const drawW = drawH * aspect;
      ctx.save();
      ctx.translate(kx, ky + bodyBounceY);
      ctx.rotate(bodyTilt);
      ctx.drawImage(sprite, -drawW * 0.5, -drawH, drawW, drawH);
      ctx.restore();
      return;
    }

    const scale = drawH / Math.max(1, rig.height);
    const drawW = rig.width * scale;
    const originX = -drawW * 0.5;
    const originY = -drawH;

    const hipLocalY = originY + rig.hipY * scale;
    const leftHipLocalX = originX + rig.leftHipX * scale;
    const rightHipLocalX = originX + rig.rightHipX * scale;
    const legTopOffset = (rig.legTopY - rig.hipY) * scale;

    ctx.save();
    ctx.translate(kx, ky + bodyBounceY);

    ctx.save();
    ctx.translate(leftHipLocalX, hipLocalY + leftLegLiftY);
    ctx.rotate(leftLegRot);
    ctx.scale(1, leftLegScaleY);
    ctx.drawImage(
      rig.leftLeg,
      originX - leftHipLocalX,
      legTopOffset,
      rig.leftLeg.width * scale,
      rig.leftLeg.height * scale
    );
    ctx.restore();

    ctx.save();
    ctx.translate(rightHipLocalX, hipLocalY + rightLegLiftY);
    ctx.rotate(rightLegRot);
    ctx.scale(1, rightLegScaleY);
    ctx.drawImage(
      rig.rightLeg,
      originX + rig.midX * scale - rightHipLocalX,
      legTopOffset,
      rig.rightLeg.width * scale,
      rig.rightLeg.height * scale
    );
    ctx.restore();

    ctx.save();
    ctx.translate(0, hipLocalY);
    ctx.rotate(bodyTilt);
    ctx.scale(bodyScaleX, bodyScaleY);
    ctx.drawImage(
      rig.upperBody,
      originX,
      originY - hipLocalY,
      rig.upperBody.width * scale,
      rig.upperBody.height * scale
    );
    ctx.restore();

    ctx.restore();
  }

  private drawKickSwoosh(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const t = 1 - this.kickSwooshTimer / 0.24;
    const alpha = Math.sin(clamp(t, 0, 1) * Math.PI) * 0.78;
    if (alpha <= 0.02) return;

    const cx = m.ballStart.x - m.ballRadius * 0.3;
    const cy = m.ballStart.y + m.ballRadius * 0.1;
    const radius = m.ballRadius * (1.8 + t * 0.8);

    ctx.save();
    ctx.strokeStyle =
      this.shotQuality === 'perfect'
        ? `rgba(250, 204, 21, ${alpha})`
        : `rgba(254, 240, 138, ${alpha})`;
    ctx.lineWidth = (1 - t) * 7 + 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.08, Math.PI * 0.72);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
    ctx.lineWidth = (1 - t) * 3.5 + 1;
    ctx.beginPath();
    ctx.arc(cx + 3, cy - 2, radius * 0.86, Math.PI * 0.14, Math.PI * 0.66);
    ctx.stroke();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.alpha, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size * 0.5, -p.size * 0.35, p.size, p.size * 0.7);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const enterT = clamp(
      1 - (this.bannerTimer > 1.0 ? (this.bannerTimer - 1.0) / 0.25 : 0),
      0,
      1
    );
    const scale = easeOutBack(clamp(enterT, 0.01, 1));

    const cx = m.w * 0.5;
    const cy = m.h * 0.61;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const boxW = Math.min(m.w * 0.84, 310);
    const boxH = 74;
    ctx.fillStyle = 'rgba(7, 17, 36, 0.9)';
    ctx.strokeStyle = this.bannerColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.bannerColor;
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.bannerText, 0, -10);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 12.5px system-ui, sans-serif';
    ctx.fillText(this.bannerSubtext, 0, 18);

    ctx.restore();
  }
}
