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

type GamePhase = 'READY' | 'RUNNING_UP' | 'BALL_FLIGHT' | 'GOAL' | 'SAVED';

export interface GameCallbacks {
  onScoreChange: (score: number, isNewRecord: boolean) => void;
  onGameOver: (finalScore: number, isNewRecord: boolean) => void;
  onFirstKick: () => void;
}

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
  nx: number; // 0..1 ao longo da arquibancada
  row: number; // 0..3
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

  private character!: CharacterDef;
  private sprites: CharacterSprites | null = null;
  private goalkeeperSprites: CharacterSprites | null = null;

  private metrics!: LayoutMetrics;
  private dpr = 1;
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private elapsed = 0;

  private phase: GamePhase = 'READY';
  private phaseTimer = 0;

  private score = 0;
  private highScoreAtStart = 0;
  private achievedNewRecord = false;
  private hasKickedOnce = false;

  // Estado da cobrança atual
  private playerTarget: TargetId = 'center';
  private keeperTarget: TargetId = 'center';
  private isGoalShot = false;

  // Bola
  private ballPos: Point = { x: 0, y: 0 };
  private ballScale = 1;
  private ballRotation = 0;
  private ballShadowPos: Point = { x: 0, y: 0 };
  private ballVel: Point = { x: 0, y: 0 };
  private ballTrail: Array<{ x: number; y: number; r: number; alpha: number }> = [];

  // Rede / Feedback
  private netBulge = 0;
  private netImpact: Point = { x: 0, y: 0 };
  private screenShake = 0;
  private bannerText = '';
  private bannerSubtext = '';
  private bannerColor = '#22c55e';
  private bannerTimer = 0;

  // Goleiro
  private keeperProgress = 0;

  // Batedor
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

  public startSession(
    character: CharacterDef,
    sprites: CharacterSprites | null,
    currentHighScore: number
  ): void {
    this.character = character;
    this.sprites = sprites;
    if (character.goalSoundUrl) {
      soundEngine.preloadCustomSound(character.goalSoundUrl);
    }
    this.score = 0;
    this.highScoreAtStart = currentHighScore;
    this.achievedNewRecord = false;
    this.hasKickedOnce = false;
    this.particles = [];
    this.crowdExcitement = 0;
    this.updateCanvasSize();
    this.resetRound(true);

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

  private resetRound(playWhistleSound: boolean): void {
    this.phase = 'READY';
    this.phaseTimer = 0;
    this.keeperProgress = 0;
    this.kickerProgress = 0;
    this.lastStrideStep = -1;
    this.kickSwooshTimer = 0;
    this.netBulge = 0;
    this.ballTrail = [];
    this.bannerTimer = 0;
    this.pointerActive = false;
    this.isSwiping = false;
    this.hoveredTarget = null;

    this.ballPos = { ...this.metrics.ballStart };
    this.ballShadowPos = { ...this.metrics.ballStart };
    this.ballScale = 1;
    this.ballRotation = 0;

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

    if (this.phase === 'READY') {
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
    const padX = m.goalW * 0.08;
    const padY = m.goalH * 0.18;

    // Se tocou dentro da região expandida do gol, escolhe o alvo mais próximo
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

    // Exige movimento para cima (em direção ao gol)
    if (dy > -22) return null;

    // Se o dedo já está na área do gol, trava no alvo mais próximo do dedo
    const direct = this.findTappedTarget(current);
    if (direct) return direct;

    const m = this.metrics;
    // Projeta o vetor do swipe até a altura do gol
    const travelY = Math.max(120, m.ballStart.y - m.goalBottom);
    const slopeX = dx / Math.max(30, -dy);
    const projectedX = m.ballStart.x + slopeX * travelY;

    const relX = (projectedX - m.w * 0.5) / (m.goalW * 0.5);
    const swipeUpDist = -dy;
    const isHigh = swipeUpDist >= m.h * 0.165 || current.y < m.h * 0.55;

    if (relX < -0.26) {
      return isHigh ? 'top-left' : 'bottom-left';
    }
    if (relX > 0.26) {
      return isHigh ? 'top-right' : 'bottom-right';
    }
    return 'center';
  }

  private handlePointerDown(e: PointerEvent): void {
    soundEngine.unlock();
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
      this.executeKick(chosen);
    }
  }

  private chooseKeeperTarget(playerTarget: TargetId): TargetId {
    if (this.character.alwaysSaved) {
      // Regra especial oculta: personagens/caus.jpg sempre é lido pelo goleiro (100% defesa)
      return playerTarget;
    }
    const randomIdx = Math.floor(Math.random() * TARGET_IDS.length);
    return TARGET_IDS[randomIdx];
  }

  private executeKick(target: TargetId): void {
    if (!this.hasKickedOnce) {
      this.hasKickedOnce = true;
      this.callbacks.onFirstKick();
    }

    this.playerTarget = target;
    this.keeperTarget = this.chooseKeeperTarget(target);
    this.isGoalShot = this.keeperTarget !== this.playerTarget;

    this.phase = 'RUNNING_UP';
    this.phaseTimer = 0;
    this.kickerProgress = 0;
    this.lastStrideStep = -1;
    this.kickSwooshTimer = 0;
    this.keeperProgress = 0;
    this.ballTrail = [];
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

  private spawnKickDust(): void {
    const { x, y } = this.metrics.ballStart;
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI * (0.15 + Math.random() * 0.7);
      const spd = 45 + Math.random() * 110;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 14,
        y: y + 10,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.65,
        size: 3 + Math.random() * 4,
        color: i % 2 === 0 ? '#86efac' : '#dcfce7',
        alpha: 0.9,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
        gravity: 240,
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

    for (let i = 0; i < 55; i++) {
      const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.4;
      const spd = 120 + Math.random() * 280;
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

  private spawnSaveSparks(impact: Point): void {
    const colors = ['#ffffff', '#facc15', '#fb923c', '#ff4757'];
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 70 + Math.random() * 180;
      this.particles.push({
        x: impact.x,
        y: impact.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3 + Math.random() * 4.5,
        color: colors[i % colors.length],
        alpha: 1,
        life: 0,
        maxLife: 0.42 + Math.random() * 0.25,
        gravity: 220,
        rotation: 0,
        vr: 0,
        shape: 'circle',
      });
    }
  }

  private loop = (timestamp: number): void => {
    const dt = Math.min(0.05, Math.max(0.001, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    this.elapsed += dt;

    this.update(dt);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.phaseTimer += dt;
    this.screenShake = Math.max(0, this.screenShake - dt * 24);
    this.netBulge = Math.max(0, this.netBulge - dt * 1.9);
    this.crowdExcitement = Math.max(0, this.crowdExcitement - dt * 0.75);
    if (this.kickSwooshTimer > 0) {
      this.kickSwooshTimer = Math.max(0, this.kickSwooshTimer - dt);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    }

    // Atualiza partículas
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vr * dt;
      p.alpha = 1 - p.life / p.maxLife;
    }

    // Atualiza rastro da bola
    for (let i = this.ballTrail.length - 1; i >= 0; i--) {
      this.ballTrail[i].alpha -= dt * 3.4;
      if (this.ballTrail[i].alpha <= 0) {
        this.ballTrail.splice(i, 1);
      }
    }

    const m = this.metrics;

    if (this.phase === 'RUNNING_UP') {
      const duration = 0.56;
      this.kickerProgress = clamp(this.phaseTimer / duration, 0, 1);

      // Solta tufinhos de grama a cada pisada da corrida (primeiros 75%)
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

      if (this.phaseTimer >= duration) {
        this.phase = 'BALL_FLIGHT';
        this.phaseTimer = 0;
        this.kickSwooshTimer = 0.24;
        soundEngine.playKick();
        this.spawnKickDust();
      }
    } else if (this.phase === 'BALL_FLIGHT') {
      const flightDuration = 0.44;
      const t = clamp(this.phaseTimer / flightDuration, 0, 1);
      const targetPt = m.targets[this.playerTarget];

      // Arco 3D-falso (altura maior para chutes altos)
      const isTop = this.playerTarget === 'top-left' || this.playerTarget === 'top-right';
      const arcHeight = isTop ? m.h * 0.08 : m.h * 0.035;
      const curveX =
        this.playerTarget.includes('left')
          ? -m.w * 0.04
          : this.playerTarget.includes('right')
            ? m.w * 0.04
            : 0;

      const et = easeOutCubic(t);
      const bx = lerp(m.ballStart.x, targetPt.x, et) + Math.sin(t * Math.PI) * curveX;
      const by = lerp(m.ballStart.y, targetPt.y, et) - Math.sin(t * Math.PI) * arcHeight;

      this.ballPos = { x: bx, y: by };
      this.ballScale = lerp(1, 0.54, et);
      this.ballRotation += dt * 19;

      // Sombra acompanha no chão
      this.ballShadowPos = {
        x: bx,
        y: lerp(m.ballStart.y + m.ballRadius * 0.65, m.goalBottom + 2, et),
      };

      // Rastro luminoso
      if (t < 0.95) {
        this.ballTrail.push({
          x: bx,
          y: by,
          r: m.ballRadius * this.ballScale * 0.85,
          alpha: 0.36,
        });
      }

      // Goleiro salta sincronizado (com reação humana ultrarrápida após 10% do voo)
      const keeperT = clamp((t - 0.06) / 0.88, 0, 1);
      this.keeperProgress = easeOutCubic(keeperT);

      if (t >= 1) {
        this.resolveImpact(targetPt);
      }
    } else if (this.phase === 'GOAL') {
      // Bola assenta dentro da rede
      const targetPt = m.targets[this.playerTarget];
      const settleT = clamp(this.phaseTimer / 0.35, 0, 1);
      this.ballPos = {
        x: lerp(targetPt.x, targetPt.x + (targetPt.x - m.w * 0.5) * 0.06, settleT),
        y: lerp(targetPt.y, m.goalBottom - m.ballRadius * 0.55, easeOutCubic(settleT)),
      };
      this.ballShadowPos = {
        x: this.ballPos.x,
        y: m.goalBottom - 2,
      };
      this.ballRotation += dt * 5 * (1 - settleT);

      if (this.phaseTimer >= 1.32) {
        this.resetRound(true);
      }
    } else if (this.phase === 'SAVED') {
      // Bola rebate das luvas e quica no gramado
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

      if (this.phaseTimer >= 1.05 && this.phaseTimer - dt < 1.05) {
        this.callbacks.onGameOver(this.score, this.achievedNewRecord);
      }
    }
  }

  private resolveImpact(targetPt: Point): void {
    if (this.isGoalShot) {
      this.phase = 'GOAL';
      this.phaseTimer = 0;
      this.score += 1;

      const justBeatRecord = this.score > this.highScoreAtStart;
      const firstTimeBeating = justBeatRecord && !this.achievedNewRecord;
      if (justBeatRecord) {
        this.achievedNewRecord = true;
      }

      this.netBulge = 1;
      this.netImpact = { ...targetPt };
      this.crowdExcitement = 1;
      this.screenShake = 5;

      const isTopCorner = this.playerTarget === 'top-left' || this.playerTarget === 'top-right';
      this.bannerText = isTopCorner ? 'GOLAÇO!' : 'GOL!';
      this.bannerSubtext = firstTimeBeating
        ? '⭐ NOVO RECORDE!'
        : `${this.score} ${this.score === 1 ? 'gol seguido' : 'gols seguidos'}`;
      this.bannerColor = firstTimeBeating ? '#facc15' : '#22c55e';
      this.bannerTimer = 1.25;

      soundEngine.playGoal(firstTimeBeating, this.character.goalSoundUrl);
      this.spawnGoalConfetti();
      if (navigator.vibrate) {
        navigator.vibrate([35, 30, 50]);
      }

      this.callbacks.onScoreChange(this.score, justBeatRecord);
    } else {
      this.phase = 'SAVED';
      this.phaseTimer = 0;
      this.screenShake = 11;

      // Rebote para fora do gol
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

      this.bannerText = 'DEFENDEU!';
      this.bannerSubtext = 'O goleiro buscou no canto!';
      this.bannerColor = '#ef4444';
      this.bannerTimer = 1.05;

      soundEngine.playSave();
      this.spawnSaveSparks(targetPt);
      if (navigator.vibrate) {
        navigator.vibrate(95);
      }
    }
  }

  // ==================== RENDERIZAÇÃO ====================

  private render(): void {
    const ctx = this.ctx;
    const m = this.metrics;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Screen shake sutil em impacto
    if (this.screenShake > 0.2) {
      const sx = (Math.random() - 0.5) * this.screenShake;
      const sy = (Math.random() - 0.5) * this.screenShake;
      ctx.translate(sx, sy);
    }

    this.drawStadiumSkyAndLights(ctx, m);
    this.drawStandsAndCrowd(ctx, m);
    this.drawPitch(ctx, m);
    this.drawGoalBackAndNet(ctx, m);

    // Alvos interativos quando aguardando chute
    if (this.phase === 'READY') {
      this.drawTargets(ctx, m);
    }

    // Goleiro
    this.drawGoalkeeper(ctx, m);

    // Trave da frente (sobre a rede e o goleiro para profundidade real)
    this.drawGoalFrame(ctx, m);

    // Bola atrás ou na frente do goleiro conforme a fase
    this.drawBallTrail(ctx);
    this.drawBall(ctx, m);

    // Seta de mira do Swipe (se deslizando)
    if (this.phase === 'READY' && this.isSwiping) {
      this.drawSwipeGuide(ctx, m);
    }

    // Batedor em primeiro plano (costas para a câmera)
    this.drawKicker(ctx, m);

    // Partículas (confetes / grama / faíscas)
    this.drawParticles(ctx);

    // Banner animado ("GOL!", "GOLAÇO!", "DEFENDEU!")
    if (this.bannerTimer > 0) {
      this.drawBanner(ctx, m);
    }

    ctx.restore();
  }

  private drawStadiumSkyAndLights(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, m.horizonY);
    skyGrad.addColorStop(0, '#040b18');
    skyGrad.addColorStop(0.55, '#0b1e40');
    skyGrad.addColorStop(1, '#133163');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, m.w, m.horizonY + 10);

    // Refletores do estádio
    const towers = [m.w * 0.14, m.w * 0.86];
    towers.forEach((tx, idx) => {
      const ty = m.h * 0.095;
      // Cone de luz suave
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

      // Cabeça do refletor
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

    // Estrutura da arquibancada
    const standGrad = ctx.createLinearGradient(0, standTop, 0, standBottom);
    standGrad.addColorStop(0, '#0a162d');
    standGrad.addColorStop(1, '#122547');
    ctx.fillStyle = standGrad;
    ctx.fillRect(0, standTop, m.w, standH);

    // Degraus sutis
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) {
      const ry = standTop + (standH * r) / 4;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(m.w, ry);
      ctx.stroke();
    }

    // Torcida animada
    const jumpAmp = 2 + this.crowdExcitement * 9;
    const jumpFreq = 4 + this.crowdExcitement * 12;

    for (const fan of this.crowd) {
      const fx = fan.nx * m.w;
      const baseY = standTop + 14 + (fan.row / 3.4) * (standH - 22);
      const bounce = Math.abs(Math.sin(this.elapsed * jumpFreq + fan.phase)) * jumpAmp;
      const fy = baseY - bounce;

      // Corpo / Camisa
      ctx.fillStyle = fan.color;
      ctx.globalAlpha = 0.68 + fan.row * 0.08;
      ctx.beginPath();
      ctx.roundRect(fx - 4.5, fy, 9, 10, 3);
      ctx.fill();

      // Cabeça
      ctx.fillStyle = '#e2c2a2';
      ctx.beginPath();
      ctx.arc(fx, fy - 3.2, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Placa de publicidade / faixa NMFC na beira do campo
    const boardH = 16;
    const boardY = standBottom - boardH;
    ctx.fillStyle = '#0f2d6b';
    ctx.fillRect(0, boardY, m.w, boardH);

    // Listras vermelhas esportivas na placa
    ctx.fillStyle = '#d92638';
    for (let x = -20; x < m.w + 20; x += 64) {
      ctx.fillRect(x, boardY, 18, boardH);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '900 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = ['NMFC', '•', 'PÊNALTIS', '•', 'NMFC', '•', 'PÊNALTIS'];
    labels.forEach((txt, i) => {
      ctx.fillText(txt, ((i + 0.5) / labels.length) * m.w, boardY + boardH * 0.54);
    });
  }

  private drawPitch(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const pitchH = m.h - m.horizonY;

    // Gradiente base do gramado
    const grassGrad = ctx.createLinearGradient(0, m.horizonY, 0, m.h);
    grassGrad.addColorStop(0, '#146e34');
    grassGrad.addColorStop(0.35, '#198740');
    grassGrad.addColorStop(1, '#1da44c');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, m.horizonY, m.w, pitchH);

    // Faixas horizontais alternadas de grama em perspectiva
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

    // Linhas brancas do campo
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = 3;

    // Linha de fundo (linha do gol)
    ctx.beginPath();
    ctx.moveTo(0, m.goalBottom);
    ctx.lineTo(m.w, m.goalBottom);
    ctx.stroke();

    // Pequena área (perspectiva)
    const boxTopHalf = m.goalW * 0.62;
    const boxBotHalf = m.goalW * 0.88;
    const boxBotY = m.goalBottom + pitchH * 0.24;
    ctx.beginPath();
    ctx.moveTo(m.w * 0.5 - boxTopHalf, m.goalBottom);
    ctx.lineTo(m.w * 0.5 - boxBotHalf, boxBotY);
    ctx.lineTo(m.w * 0.5 + boxBotHalf, boxBotY);
    ctx.lineTo(m.w * 0.5 + boxTopHalf, m.goalBottom);
    ctx.stroke();

    // Marca da cal (ponto de pênalti)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.ellipse(
      m.ballStart.x,
      m.ballStart.y + m.ballRadius * 0.58,
      11,
      5,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  private drawGoalBackAndNet(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const depthX = m.goalW * 0.065;
    const depthY = m.goalH * 0.13;

    const backLeft = m.goalLeft + depthX;
    const backRight = m.goalRight - depthX;
    const backTop = m.goalTop + depthY;
    const backBottom = m.goalBottom - depthY * 0.35;

    // Fundo escurecido dentro do gol para destaque
    ctx.fillStyle = 'rgba(4, 14, 30, 0.42)';
    ctx.fillRect(m.goalLeft, m.goalTop, m.goalW, m.goalH);

    // Malha da rede com deformação elástica quando sai gol
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

    // Linhas verticais da rede
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

    // Linhas horizontais da rede
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

    // Hastes traseiras de suporte
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

    // Sombra suave da trave
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = postWidth + 4;
    ctx.beginPath();
    ctx.moveTo(m.goalLeft, m.goalBottom + 2);
    ctx.lineTo(m.goalLeft, m.goalTop + 2);
    ctx.lineTo(m.goalRight, m.goalTop + 2);
    ctx.lineTo(m.goalRight, m.goalBottom + 2);
    ctx.stroke();

    // Trave branca brilhante
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
    const pulse = 1 + Math.sin(this.elapsed * 4.5) * 0.08;

    for (const id of TARGET_IDS) {
      const pt = m.targets[id];
      const isActive = this.hoveredTarget === id;
      const r = m.targetRadius * (isActive ? 1.18 : pulse);

      ctx.save();

      // Preenchimento translúcido
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isActive
        ? 'rgba(250, 204, 21, 0.34)'
        : 'rgba(255, 255, 255, 0.12)';
      ctx.fill();

      // Anel tracejado/sólido
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.strokeStyle = isActive ? '#facc15' : 'rgba(255, 255, 255, 0.65)';
      if (!isActive) {
        ctx.setLineDash([6, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Mira central
      ctx.fillStyle = isActive ? '#facc15' : 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Rótulo pequeno quando mirado
      if (isActive) {
        ctx.font = '800 9.5px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#09152b';
        const pillW = 60;
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

    // Ângulos dos braços articulados (0 = direita, PI/2 = baixo, PI = esquerda, -PI/2 = cima)
    // Pose padrão ANTES da cobrança: postura ativa de defesa (braços abertos e mãos prontas, nunca na cintura)
    const isRunningUp = this.phase === 'RUNNING_UP';
    const readyFreq = isRunningUp ? 10.5 : 4.2;
    const readyWave = Math.sin(this.elapsed * readyFreq);
    const armBreath = Math.sin(this.elapsed * (isRunningUp ? 12 : 5.2));

    let leftUpperAng = 2.32 + armBreath * 0.06;
    let leftForeAng = 2.94 + armBreath * 0.1;
    let rightUpperAng = 0.82 - armBreath * 0.06;
    let rightForeAng = 0.2 - armBreath * 0.1;
    let gloveStretch = 1;

    if (this.phase === 'READY' || this.phase === 'RUNNING_UP') {
      // Base baixa e atlética de goleiro pronto para defender
      const lateralAmp = isRunningUp ? 4.5 : 7.5;
      posX += readyWave * lateralAmp;
      const crouchBounce = Math.abs(Math.sin(this.elapsed * readyFreq * 1.35));
      const baseCrouch = isRunningUp ? 0.9 : 0.94;
      scaleY = baseCrouch - crouchBounce * 0.035;
      scaleX = 1.04 + crouchBounce * 0.025;
      posY = baseY + (1 - scaleY) * gkHeight * 0.45 + crouchBounce * 2.5;
      tilt = readyWave * 0.035;

      if (isRunningUp) {
        // Abre mais os braços e ergue levemente as luvas enquanto o batedor corre
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

      // Alcance total do centro do goleiro até as pontas das luvas esticadas
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
          // Braços abrem pelo lado de fora até esticarem totalmente no ângulo
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
          // Salta no meio esticando os dois braços para cima/frente fechando o gol
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

    // Sombra dinâmica no gramado
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

    // Linhas de velocidade durante o salto/mergulho
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

      // Corpo do goleiro (cabeça, tronco limpo sem mão na cintura, shorts e pernas de goleiro.jpg)
      ctx.drawImage(rig.body, bodyOriginX, bodyOriginY, drawW, gkHeight);

      // Braços articulados com mangas amarelas + listras pretas + luvas de goleiro
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
      // Fallback rápido enquanto goleiro.jpg carrega
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

      // Manga amarela combinando com o uniforme de goleiro.jpg
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

      // Listras pretas esportivas da manga
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

    // 1. Braço superior (ombro -> cotovelo)
    drawSleeveSegment(shX, shY, elbowX, elbowY, thickness, true);

    // 2. Antebraço (cotovelo -> punho)
    drawSleeveSegment(elbowX, elbowY, wristX, wristY, thickness * 0.88, false);

    // 3. Munhequeira preta + Luva de goleiro preto e amarelo (estilo goleiro.jpg)
    ctx.save();
    ctx.translate(wristX, wristY);
    ctx.rotate(foreAng);
    ctx.scale(gloveScale, gloveScale);

    const gw = thickness * 1.48;
    const gh = thickness * 1.18;

    // Munhequeira / punho da luva
    ctx.fillStyle = '#1f2430';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.4, thickness * 0.15);
    ctx.beginPath();
    ctx.roundRect(-thickness * 0.45, -gh * 0.38, thickness * 0.65, gh * 0.76, 3);
    ctx.fill();
    ctx.stroke();

    // Corpo principal da luva (palma preta + detalhe amarelo vibrante)
    ctx.fillStyle = '#1e2430';
    ctx.beginPath();
    ctx.roundRect(0, -gh * 0.52, gw * 0.86, gh * 1.04, gh * 0.44);
    ctx.fill();
    ctx.stroke();

    // Polegar aberto para dentro/cima pronto para agarrar a bola
    const thumbDir = side === -1 ? -1 : 1;
    ctx.fillStyle = '#1e2430';
    ctx.beginPath();
    ctx.ellipse(gw * 0.28, thumbDir * gh * 0.56, gw * 0.25, gh * 0.22, thumbDir * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Detalhe amarelo no dorso da luva
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(gw * 0.16, -gh * 0.3, gw * 0.48, gh * 0.6, gh * 0.24);
    ctx.fill();

    // Linhas sutis dos dedos na ponta da luva
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
      ctx.fillStyle = `rgba(255, 255, 255, ${tr.alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D, m: LayoutMetrics): void {
    const r = m.ballRadius * this.ballScale;

    // Sombra da bola
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

    // Base esférica com gradiente de iluminação
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.72, '#e2e8f0');
    grad.addColorStop(1, '#94a3b8');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Gomos pretos rotacionando dentro do clip circular
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

    // Contorno da bola
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

    // Ponta da seta
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
    const p = this.phase === 'READY' ? 0 : this.phase === 'RUNNING_UP' ? this.kickerProgress : 1;

    // Corrida em leve arco (mais natural para batedor destro se aproximando da bola)
    const runMoveT = clamp(p / 0.86, 0, 1);
    const easeMove = easeOutCubic(runMoveT);
    const arcX = Math.sin(runMoveT * Math.PI) * -m.w * 0.035;
    const kx = lerp(m.kickerIdle.x, m.kickerKick.x, easeMove) + arcX;
    const ky = lerp(m.kickerIdle.y, m.kickerKick.y, easeMove);

    // Perspectiva: encolhe sutilmente ao correr em direção à marca da cal
    const perspectiveScale = lerp(1.06, 0.95, easeMove);
    const drawH = m.kickerHeight * perspectiveScale;

    // Parâmetros de articulação
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

    if (this.phase === 'READY') {
      // Respiração e prontidão leve
      const breath = Math.sin(this.elapsed * 3.4);
      bodyBounceY = breath * 2.2;
      bodyScaleY = 1 + breath * 0.012;
      bodyTilt = Math.sin(this.elapsed * 1.7) * 0.018;
    } else if (this.phase === 'RUNNING_UP') {
      if (p < 0.74) {
        // FASE 1: CORRIDA COM PASSADAS ALTERNADAS
        const runT = p / 0.74;
        const stride = runT * Math.PI * 3.5; // ~3.5 passadas bem marcadas
        const leftWave = Math.sin(stride);
        const rightWave = Math.sin(stride + Math.PI);

        // Quando wave > 0, a perna está dobrando para trás/subindo no ar
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
        // FASE 2: WIND-UP (perna esquerda planta firme, perna direita arma o chute!)
        const wT = easeOutCubic((p - 0.74) / 0.26);

        // Pé de apoio firme
        leftLegRot = lerp(0, 0.12, wT);
        leftLegScaleY = 1;
        leftLegLiftY = 0;

        // Perna de chute puxa para trás dobrando o joelho
        rightLegScaleY = lerp(1, 0.62, wT);
        rightLegLiftY = -wT * drawH * 0.095;
        rightLegRot = lerp(0, -0.34, wT);

        // Tronco abre e inclina para a esquerda para gerar força
        bodyTilt = lerp(0.04, -0.13, wT);
        bodyBounceY = lerp(-4, 3, wT);
        bodyScaleX = lerp(1, 0.96, wT);
      }
    } else if (this.phase === 'BALL_FLIGHT') {
      // FASE 3: CHICOTADA DO CHUTE + FOLLOW-THROUGH
      const strikeDuration = 0.14;
      const settleDuration = 0.3;

      if (this.phaseTimer <= strikeDuration) {
        const sT = easeOutCubic(clamp(this.phaseTimer / strikeDuration, 0, 1));
        leftLegRot = lerp(0.12, 0.08, sT);

        // Perna direita dispara para frente e cruza levemente na direção do chute
        rightLegScaleY = lerp(0.62, 1.12, sT);
        rightLegLiftY = lerp(-drawH * 0.095, -drawH * 0.025, sT);
        rightLegRot = lerp(-0.34, 0.52, sT);

        bodyTilt = lerp(-0.13, -0.19, sT);
        bodyBounceY = lerp(3, -drawH * 0.03, sT);
        bodyScaleX = lerp(0.96, 1.03, sT);
      } else {
        // Retorno suave ao apoio observando a bola
        const fT = easeOutCubic(
          clamp((this.phaseTimer - strikeDuration) / settleDuration, 0, 1)
        );
        leftLegRot = lerp(0.08, 0, fT);
        rightLegScaleY = lerp(1.12, 1, fT);
        rightLegLiftY = lerp(-drawH * 0.025, 0, fT);
        rightLegRot = lerp(0.52, 0.04, fT);

        bodyTilt = lerp(-0.19, -0.02, fT);
        bodyBounceY = lerp(-drawH * 0.03, 0, fT);
        bodyScaleX = lerp(1.03, 1, fT);
      }
    } else if (this.phase === 'GOAL') {
      // Comemoração vibrante pulando!
      const jump = Math.abs(Math.sin(this.elapsed * 11));
      bodyBounceY = -jump * drawH * 0.11;
      bodyTilt = Math.sin(this.elapsed * 11) * 0.08;
      leftLegRot = jump * 0.18;
      rightLegRot = -jump * 0.18;
      leftLegScaleY = 1 - jump * 0.1;
      rightLegScaleY = 1 - jump * 0.1;
    } else if (this.phase === 'SAVED') {
      // Reação de desapontamento após defesa
      const slump = clamp(this.phaseTimer / 0.35, 0, 1);
      bodyBounceY = slump * 5;
      bodyScaleY = 1 - slump * 0.05;
      bodyTilt = slump * 0.06;
    }

    // Sombra no gramado
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

    // Efeito visual de arco do chute no instante do impacto
    if (this.kickSwooshTimer > 0) {
      this.drawKickSwoosh(ctx, m);
    }

    const rig = this.sprites?.kickerRig ?? null;
    if (!rig) {
      const sprite = this.sprites?.back ?? null;
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

    // 1. Perna esquerda (atrás do calção)
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

    // 2. Perna direita (perna do chute, atrás do calção)
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

    // 3. Corpo superior (cabeça + tronco + camisa com nome/número + calção)
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
    ctx.strokeStyle = `rgba(254, 240, 138, ${alpha})`;
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
    const enterT = clamp(1 - (this.bannerTimer > 1.0 ? (this.bannerTimer - 1.0) / 0.25 : 0), 0, 1);
    const scale = easeOutBack(clamp(enterT, 0.01, 1));

    const cx = m.w * 0.5;
    const cy = m.h * 0.61;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Fundo da placa
    const boxW = Math.min(m.w * 0.78, 290);
    const boxH = 74;
    ctx.fillStyle = 'rgba(7, 17, 36, 0.88)';
    ctx.strokeStyle = this.bannerColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 20);
    ctx.fill();
    ctx.stroke();

    // Título principal
    ctx.fillStyle = this.bannerColor;
    ctx.font = '900 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.bannerText, 0, -9);

    // Subtítulo
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(this.bannerSubtext, 0, 19);

    ctx.restore();
  }
}
