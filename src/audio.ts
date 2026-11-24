import { getSoundEnabled, setSoundEnabled } from './storage';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = getSoundEnabled();
  private noiseBuffer: AudioBuffer | null = null;

  private rawAudioCache = new Map<string, Promise<ArrayBuffer>>();
  private decodedBufferCache = new Map<string, AudioBuffer>();
  private activeCustomSource: AudioBufferSourceNode | null = null;
  private activeFallbackAudio: HTMLAudioElement | null = null;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    setSoundEnabled(this.enabled);
    if (this.enabled) {
      this.unlock();
      this.playSelect();
    } else {
      this.stopCustomSound();
    }
    return this.enabled;
  }

  public stopCustomSound(): void {
    if (this.activeCustomSource) {
      try {
        this.activeCustomSource.stop();
      } catch {
        // noop
      }
      this.activeCustomSource = null;
    }
    if (this.activeFallbackAudio) {
      this.activeFallbackAudio.pause();
      this.activeFallbackAudio.currentTime = 0;
      this.activeFallbackAudio = null;
    }
  }

  public preloadCustomSound(url: string): void {
    if (!this.rawAudioCache.has(url)) {
      const req = fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      });
      this.rawAudioCache.set(url, req);
    }

    if (this.ctx && !this.decodedBufferCache.has(url)) {
      this.decodeCachedAudio(url, this.ctx).catch(() => {});
    }
  }

  private async decodeCachedAudio(url: string, ctx: AudioContext): Promise<AudioBuffer> {
    const existing = this.decodedBufferCache.get(url);
    if (existing) return existing;

    if (!this.rawAudioCache.has(url)) {
      this.preloadCustomSound(url);
    }
    const raw = await this.rawAudioCache.get(url)!;
    // slice(0) evita detach do ArrayBuffer em reutilizações
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    this.decodedBufferCache.set(url, decoded);
    return decoded;
  }

  private playBufferNode(ctx: AudioContext, buffer: AudioBuffer): void {
    this.stopCustomSound();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, ctx.currentTime);
    src.connect(gain).connect(ctx.destination);
    src.onended = () => {
      if (this.activeCustomSource === src) {
        this.activeCustomSource = null;
      }
    };
    this.activeCustomSource = src;
    src.start(ctx.currentTime);
  }

  private playCustomClip(url: string, ctx: AudioContext): void {
    const decoded = this.decodedBufferCache.get(url);
    if (decoded) {
      this.playBufferNode(ctx, decoded);
      return;
    }

    this.decodeCachedAudio(url, ctx)
      .then((buffer) => {
        if (!this.enabled) return;
        this.playBufferNode(ctx, buffer);
      })
      .catch(() => {
        if (!this.enabled) return;
        this.stopCustomSound();
        const el = new Audio(url);
        this.activeFallbackAudio = el;
        el.play().catch(() => {});
      });
  }

  public unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx) {
      for (const url of this.rawAudioCache.keys()) {
        if (!this.decodedBufferCache.has(url)) {
          this.decodeCachedAudio(url, this.ctx).catch(() => {});
        }
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    this.unlock();
    return this.ctx;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const duration = 2.0;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Leve coloração rosa para soar mais natural como torcida/impacto
      data[i] = (lastOut + 0.12 * white) / 1.12;
      lastOut = data[i];
      data[i] *= 2.4;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  public playSelect(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(810, now + 0.065);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  /** Apito do árbitro com trinado característico */
  public playWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = 0.28;

    const carrier = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(2680, now);
    carrier.frequency.linearRampToValueAtTime(2840, now + 0.08);
    carrier.frequency.linearRampToValueAtTime(2720, now + duration);

    // Trinado da bolinha dentro do apito
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(34, now);
    lfoGain.gain.setValueAtTime(115, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.025);
    gain.gain.setValueAtTime(0.11, now + duration - 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    lfo.connect(lfoGain).connect(carrier.frequency);
    carrier.connect(gain).connect(ctx.destination);

    // Sopro de ar sutil
    const air = ctx.createBufferSource();
    air.buffer = this.getNoiseBuffer(ctx);
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.setValueAtTime(3000, now);
    airFilter.Q.setValueAtTime(4, now);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.001, now);
    airGain.gain.linearRampToValueAtTime(0.04, now + 0.02);
    airGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    air.connect(airFilter).connect(airGain).connect(ctx.destination);

    lfo.start(now);
    carrier.start(now);
    air.start(now);

    lfo.stop(now + duration + 0.02);
    carrier.stop(now + duration + 0.02);
    air.stop(now + duration + 0.02);
  }

  /** Chute potente na bola */
  public playKick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Punch grave (couro da bola)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(175, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.13);

    oscGain.gain.setValueAtTime(0.32, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);

    // Estalo seco do impacto da chuteira
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, now);
    filter.Q.setValueAtTime(1.2, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.22, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.09);
  }

  /** Defesa do goleiro + reação frustrada da torcida */
  public playSave(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Impacto nas luvas
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(140, now);
    thump.frequency.exponentialRampToValueAtTime(48, now + 0.11);
    thumpGain.gain.setValueAtTime(0.26, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    thump.connect(thumpGain).connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.14);

    // Tapa da luva
    const slap = ctx.createBufferSource();
    slap.buffer = this.getNoiseBuffer(ctx);
    const slapFilter = ctx.createBiquadFilter();
    slapFilter.type = 'bandpass';
    slapFilter.frequency.setValueAtTime(1400, now);
    slapFilter.Q.setValueAtTime(1.4, now);
    const slapGain = ctx.createGain();
    slapGain.gain.setValueAtTime(0.24, now);
    slapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    slap.connect(slapFilter).connect(slapGain).connect(ctx.destination);
    slap.start(now);
    slap.stop(now + 0.1);

    // "OOOH!" da torcida + notas descendentes
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.getNoiseBuffer(ctx);
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.setValueAtTime(720, now + 0.05);
    crowdFilter.frequency.exponentialRampToValueAtTime(340, now + 0.72);
    crowdFilter.Q.setValueAtTime(2.6, now);
    const crowdGain = ctx.createGain();
    crowdGain.gain.setValueAtTime(0.001, now + 0.04);
    crowdGain.gain.linearRampToValueAtTime(0.18, now + 0.16);
    crowdGain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);
    crowd.connect(crowdFilter).connect(crowdGain).connect(ctx.destination);
    crowd.start(now + 0.04);
    crowd.stop(now + 0.8);

    // Dois tons curtos de defesa/fim
    [330, 247].forEach((freq, idx) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = now + 0.12 + idx * 0.14;
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(lp).connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.22);
    });
  }

  /** Gol: bola estufando a rede + som personalizado do atleta (se houver) ou torcida/fanfarra */
  public playGoal(isNewRecord = false, customGoalSoundUrl?: string | null): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Som da rede estufando (swish rápido)
    const net = ctx.createBufferSource();
    net.buffer = this.getNoiseBuffer(ctx);
    const netFilter = ctx.createBiquadFilter();
    netFilter.type = 'highpass';
    netFilter.frequency.setValueAtTime(1800, now);
    const netGain = ctx.createGain();
    netGain.gain.setValueAtTime(0.16, now);
    netGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    net.connect(netFilter).connect(netGain).connect(ctx.destination);
    net.start(now);
    net.stop(now + 0.2);

    // Se o personagem tem som personalizado de gol (ex: Mau -> songs/songmau.m4a),
    // toca o clipe em destaque com torcida suave ao fundo sem fanfarra competindo
    if (customGoalSoundUrl) {
      this.playCustomClip(customGoalSoundUrl, ctx);

      const softCheer = ctx.createBufferSource();
      softCheer.buffer = this.getNoiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(680, now + 0.04);
      bp.Q.setValueAtTime(1.2, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + 0.03);
      g.gain.linearRampToValueAtTime(0.08, now + 0.22);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
      softCheer.connect(bp).connect(g).connect(ctx.destination);
      softCheer.start(now + 0.03);
      softCheer.stop(now + 1.15);
      return;
    }

    // 2. Torcida comemorando (swell de ruído filtrado em duas bandas)
    [620, 1280].forEach((centerFreq, i) => {
      const cheer = ctx.createBufferSource();
      cheer.buffer = this.getNoiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(centerFreq * 0.85, now + 0.04);
      bp.frequency.linearRampToValueAtTime(centerFreq * 1.2, now + 0.45);
      bp.frequency.linearRampToValueAtTime(centerFreq, now + 1.25);
      bp.Q.setValueAtTime(1.15, now);

      const g = ctx.createGain();
      const peak = i === 0 ? 0.24 : 0.15;
      g.gain.setValueAtTime(0.001, now + 0.03);
      g.gain.linearRampToValueAtTime(peak, now + 0.24);
      g.gain.setValueAtTime(peak * 0.85, now + 0.72);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.35);

      cheer.connect(bp).connect(g).connect(ctx.destination);
      cheer.start(now + 0.03);
      cheer.stop(now + 1.4);
    });

    // 3. Fanfarra curta comemorativa (acorde maior ascendente)
    const notes = isNewRecord ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + 0.06 + idx * 0.075;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.11, t + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }
}

export const soundEngine = new SoundEngine();
