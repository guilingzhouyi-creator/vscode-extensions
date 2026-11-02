/**
 * Module: ProceduralAudioSynth — 纯原生 Web Audio 声学提示音合成器
 * File Path: src/presentation/procedural-audio-synth.ts
 * Architecture Role: Presentation layer procedural sound generator for timer and break events
 * Dependencies & Triggers: Web Audio API (AudioContext, OscillatorNode, GainNode); triggered by timer completions and break endings
 * Responsibilities: Synthesize harmonic ascending chime (440Hz->880Hz) and wooden resonance (330Hz/660Hz); enforce locked 30% volume baseline; self-heal browser autoplay suspensions
 * Exit Semantics & Design Rationale: Zero external audio assets (MP3/WAV) to ensure lightweight offline portability; exponential envelope ramp eliminates speaker pop/click artifacts
 */

import {
    FREQ_A4_HZ,
    FREQ_A5_HZ,
    FREQ_E4_HZ,
    FREQ_E5_HZ,
    MS_PER_SECOND,
} from '../domain/models';

export type SoundEffectType = 'timer_completed' | 'break_ended';

export interface ProceduralSynthOptions {
    volume?: number;
    audioContext?: AudioContext;
    audioContextFactory?: () => AudioContext;
}

/** 默认基线音量：锁定在 30% 舒缓音量 */
const DEFAULT_LOCKED_VOLUME = 0.3;
const EXPONENTIAL_MIN_GAIN = 0.0001;

/** 泛音增益缩放常量 */
const HARMONIC_GAIN_SCALE = 0.35;
const OVERTONE_GAIN_SCALE = 0.4;

interface SoundHarmonicConfig {
    readonly totalDuration: number;
    readonly attackDuration: number;
    readonly primaryType: OscillatorType;
    readonly primaryStartFreq: number;
    readonly primaryEndFreq?: number;
    readonly primaryRampRatio?: number;
    readonly secondaryType: OscillatorType;
    readonly secondaryFreq: number;
    readonly secondaryGainScale: number;
}

const TIMER_COMPLETED_CONFIG: SoundHarmonicConfig = {
    totalDuration: 0.65,
    attackDuration: 0.02,
    primaryType: 'sine',
    primaryStartFreq: FREQ_A4_HZ,
    primaryEndFreq: FREQ_A5_HZ,
    primaryRampRatio: 0.7,
    secondaryType: 'triangle',
    secondaryFreq: FREQ_A5_HZ,
    secondaryGainScale: HARMONIC_GAIN_SCALE,
};

const BREAK_ENDED_CONFIG: SoundHarmonicConfig = {
    totalDuration: 0.5,
    attackDuration: 0.012,
    primaryType: 'triangle',
    primaryStartFreq: FREQ_E4_HZ,
    secondaryType: 'sine',
    secondaryFreq: FREQ_E5_HZ,
    secondaryGainScale: OVERTONE_GAIN_SCALE,
};

export class ProceduralAudioSynth {
    private context: AudioContext | null = null;
    private readonly contextFactory?: () => AudioContext;
    private readonly lockedVolume: number;
    private isDisposed: boolean = false;

    constructor(options?: ProceduralSynthOptions) {
        this.lockedVolume = typeof options?.volume === 'number'
            ? Math.max(0, Math.min(1.0, options.volume))
            : DEFAULT_LOCKED_VOLUME;

        if (options?.audioContext) {
            this.context = options.audioContext;
        } else if (options?.audioContextFactory) {
            this.contextFactory = options.audioContextFactory;
        }
    }

    /** 当前锁定的音量比例（0.0 ~ 1.0） */
    public get volume(): number {
        return this.lockedVolume;
    }

    /** 浏览器 Autoplay 策略自愈与状态恢复 */
    public async ensureContextRunning(): Promise<boolean> {
        if (this.isDisposed) {
            return false;
        }
        const ctx = await this.getOrCreateAudioContext();
        if (!ctx) {
            return false;
        }
        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (err) {
                void err;
                return false;
            }
        }
        return ctx.state === 'running';
    }

    private async renderHarmonicSound(cfg: SoundHarmonicConfig): Promise<boolean> {
        if (this.isDisposed) return false;
        const ctx = await this.getOrCreateAudioContext();
        if (!ctx) return false;

        await this.ensureContextRunning();
        const now = ctx.currentTime;
        const stopTime = now + cfg.totalDuration;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(EXPONENTIAL_MIN_GAIN, now);
        masterGain.gain.exponentialRampToValueAtTime(this.lockedVolume, now + cfg.attackDuration);
        masterGain.gain.exponentialRampToValueAtTime(EXPONENTIAL_MIN_GAIN, stopTime);
        masterGain.connect(ctx.destination);

        const primaryOsc = ctx.createOscillator();
        primaryOsc.type = cfg.primaryType;
        primaryOsc.frequency.setValueAtTime(cfg.primaryStartFreq, now);
        if (cfg.primaryEndFreq !== undefined && cfg.primaryRampRatio !== undefined) {
            primaryOsc.frequency.exponentialRampToValueAtTime(cfg.primaryEndFreq, now + cfg.totalDuration * cfg.primaryRampRatio);
        }

        const secondaryOsc = ctx.createOscillator();
        secondaryOsc.type = cfg.secondaryType;
        secondaryOsc.frequency.setValueAtTime(cfg.secondaryFreq, now);

        const secondaryGain = ctx.createGain();
        secondaryGain.gain.setValueAtTime(cfg.secondaryGainScale, now);

        primaryOsc.connect(masterGain);
        secondaryOsc.connect(secondaryGain);
        secondaryGain.connect(masterGain);

        primaryOsc.start(now);
        secondaryOsc.start(now);
        primaryOsc.stop(stopTime);
        secondaryOsc.stop(stopTime);

        this.scheduleCleanup([primaryOsc, secondaryOsc, secondaryGain, masterGain], cfg.totalDuration);
        return true;
    }

    /** 播放计时器完成提示音（双音阶柔和上扬泛音 440Hz -> 880Hz） */
    public async playTimerCompleted(): Promise<boolean> {
        return this.renderHarmonicSound(TIMER_COMPLETED_CONFIG);
    }

    /** 播放休息结束提示音（温暖木质双谐振 330Hz / 660Hz） */
    public async playBreakEnded(): Promise<boolean> {
        return this.renderHarmonicSound(BREAK_ENDED_CONFIG);
    }

    /** 统一分发接口 */
    public async playSound(type: SoundEffectType): Promise<boolean> {
        if (type === 'timer_completed') {
            return this.playTimerCompleted();
        }
        if (type === 'break_ended') {
            return this.playBreakEnded();
        }
        return false;
    }

    /** 释放音频资源与上下文生命周期 */
    public dispose(): void {
        this.isDisposed = true;
        if (this.context && this.context.state !== 'closed') {
            try {
                void this.context.close();
            } catch (err) {
                void err;
            }
        }
        this.context = null;
    }

    /** 获取或惰性初始化 AudioContext */
    private async getOrCreateAudioContext(): Promise<AudioContext | null> {
        if (this.context) {
            return this.context;
        }
        if (this.contextFactory) {
            try {
                this.context = this.contextFactory();
                return this.context;
            } catch (err) {
                void err;
                return null;
            }
        }
        if (typeof window !== 'undefined' && typeof (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext !== 'undefined') {
            this.context = new window.AudioContext();
            return this.context;
        }
        if (typeof globalThis !== 'undefined' && (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext) {
            const CtxClass = (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext;
            this.context = new CtxClass();
            return this.context;
        }
        return null;
    }

    /** 节点异步解绑回收，防止 AudioNode 图内存泄漏 */
    private scheduleCleanup(nodes: Array<{ disconnect: () => void }>, durationSec: number): void {
        const cleanupDelayMs = Math.ceil((durationSec + 0.1) * MS_PER_SECOND);
        setTimeout(() => {
            for (let i = 0; i < nodes.length; i++) {
                try {
                    nodes[i].disconnect();
                } catch (err) {
                    void err;
                }
            }
        }, cleanupDelayMs);
    }
}
