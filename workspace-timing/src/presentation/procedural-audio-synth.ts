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
} from '../domain/models.js';

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
        const ctx = await this.resolveAudioContext();
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

    /** 播放计时器完成提示音（双音阶柔和上扬泛音 440Hz -> 880Hz） */
    public async playTimerCompleted(): Promise<boolean> {
        if (this.isDisposed) return false;
        const ctx = await this.resolveAudioContext();
        if (!ctx) return false;

        await this.ensureContextRunning();
        const now = ctx.currentTime;
        const totalDuration = 0.65;
        const attackDuration = 0.02;
        const stopTime = now + totalDuration;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(EXPONENTIAL_MIN_GAIN, now);
        masterGain.gain.exponentialRampToValueAtTime(this.lockedVolume, now + attackDuration);
        masterGain.gain.exponentialRampToValueAtTime(EXPONENTIAL_MIN_GAIN, stopTime);
        masterGain.connect(ctx.destination);

        // 主振荡器：基频 440Hz 柔和上扬过渡至 880Hz
        const carrierOsc = ctx.createOscillator();
        carrierOsc.type = 'sine';
        carrierOsc.frequency.setValueAtTime(FREQ_A4_HZ, now);
        carrierOsc.frequency.exponentialRampToValueAtTime(FREQ_A5_HZ, now + totalDuration * 0.7);

        // 谐波振荡器：880Hz 闪耀泛音
        const harmonicOsc = ctx.createOscillator();
        harmonicOsc.type = 'triangle';
        harmonicOsc.frequency.setValueAtTime(FREQ_A5_HZ, now);

        const harmonicGain = ctx.createGain();
        harmonicGain.gain.setValueAtTime(HARMONIC_GAIN_SCALE, now);

        carrierOsc.connect(masterGain);
        harmonicOsc.connect(harmonicGain);
        harmonicGain.connect(masterGain);

        carrierOsc.start(now);
        harmonicOsc.start(now);
        carrierOsc.stop(stopTime);
        harmonicOsc.stop(stopTime);

        this.scheduleCleanup([carrierOsc, harmonicOsc, harmonicGain, masterGain], totalDuration);
        return true;
    }

    /** 播放休息结束提示音（温暖木质双谐振 330Hz / 660Hz） */
    public async playBreakEnded(): Promise<boolean> {
        if (this.isDisposed) return false;
        const ctx = await this.resolveAudioContext();
        if (!ctx) return false;

        await this.ensureContextRunning();
        const now = ctx.currentTime;
        const totalDuration = 0.5;
        const attackDuration = 0.012;
        const stopTime = now + totalDuration;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(EXPONENTIAL_MIN_GAIN, now);
        masterGain.gain.exponentialRampToValueAtTime(this.lockedVolume, now + attackDuration);
        masterGain.gain.exponentialRampToValueAtTime(EXPONENTIAL_MIN_GAIN, stopTime);
        masterGain.connect(ctx.destination);

        // 木质共鸣双谐波：330Hz (E4) 与 660Hz (E5)
        const fundamentalOsc = ctx.createOscillator();
        fundamentalOsc.type = 'triangle';
        fundamentalOsc.frequency.setValueAtTime(FREQ_E4_HZ, now);

        const overtoneOsc = ctx.createOscillator();
        overtoneOsc.type = 'sine';
        overtoneOsc.frequency.setValueAtTime(FREQ_E5_HZ, now);

        const overtoneGain = ctx.createGain();
        overtoneGain.gain.setValueAtTime(OVERTONE_GAIN_SCALE, now);

        fundamentalOsc.connect(masterGain);
        overtoneOsc.connect(overtoneGain);
        overtoneGain.connect(masterGain);

        fundamentalOsc.start(now);
        overtoneOsc.start(now);
        fundamentalOsc.stop(stopTime);
        overtoneOsc.stop(stopTime);

        this.scheduleCleanup([fundamentalOsc, overtoneOsc, overtoneGain, masterGain], totalDuration);
        return true;
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
    private async resolveAudioContext(): Promise<AudioContext | null> {
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
