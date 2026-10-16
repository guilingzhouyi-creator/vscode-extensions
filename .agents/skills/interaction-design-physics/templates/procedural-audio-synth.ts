/**
 * Module: Procedural Web Audio Synthesizer
 * File Path: templates/procedural-audio-synth.ts
 * Architecture Role: Zero-asset procedural acoustic synthesis system providing subtle
 *   micro-haptic feedback without external audio files.
 * Dependencies & Triggers: Consumes browser Web Audio API (AudioContext); triggered by UI events.
 * Responsibilities:
 *   1. Enforce a strict safe volume ceiling (max gain 0.3) to protect auditory comfort.
 *   2. Synthesize dual-resonance carrier-modulator wave shapes.
 *   3. Apply pop-free exponential attack/decay envelope curves.
 *   4. Provide zero-dependency presets for click, success, warning, and toggle.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4, lazy context initialization, no memory leaks.
 */

export interface ToneEnvelope {
    readonly attackSec: number;
    readonly decaySec: number;
    readonly peakGain: number; // 严格 <= 0.3
}

export interface DualToneConfig {
    readonly baseFreq: number;
    readonly harmonicFreq: number;
    readonly baseType?: OscillatorType;
    readonly harmonicType?: OscillatorType;
    readonly envelope: ToneEnvelope;
}

export class ProceduralAudioSynth {
    private static readonly MAX_SAFE_GAIN = 0.3;
    private audioCtx: AudioContext | null = null;

    private getContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;

        if (!this.audioCtx) {
            const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!AudioCtor) return null;
            this.audioCtx = new AudioCtor();
        }

        if (this.audioCtx.state === 'suspended') {
            void this.audioCtx.resume();
        }

        return this.audioCtx;
    }

    public playDualTone(config: DualToneConfig): void {
        const ctx = this.getContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const env = config.envelope;
        const clampedGain = Math.min(ProceduralAudioSynth.MAX_SAFE_GAIN, Math.max(0.01, env.peakGain));

        const masterGain = ctx.createGain();
        masterGain.connect(ctx.destination);

        // 消除 pop 底噪的线性微瞬态 + 指数平滑衰减
        masterGain.gain.setValueAtTime(0.0001, now);
        masterGain.gain.linearRampToValueAtTime(clampedGain, now + Math.max(0.003, env.attackSec));
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + env.attackSec + env.decaySec);

        // 载波振荡器 (Carrier)
        const carrier = ctx.createOscillator();
        carrier.type = config.baseType ?? 'sine';
        carrier.frequency.setValueAtTime(config.baseFreq, now);
        carrier.connect(masterGain);

        // 次级泛音谐波振荡器 (Harmonic)
        const harmonic = ctx.createOscillator();
        harmonic.type = config.harmonicType ?? 'triangle';
        harmonic.frequency.setValueAtTime(config.harmonicFreq, now);
        harmonic.connect(masterGain);

        const stopTime = now + env.attackSec + env.decaySec + 0.05;
        carrier.start(now);
        harmonic.start(now);

        carrier.stop(stopTime);
        harmonic.stop(stopTime);
    }

    public playClick(): void {
        this.playDualTone({
            baseFreq: 800,
            harmonicFreq: 1200,
            baseType: 'sine',
            harmonicType: 'triangle',
            envelope: {
                attackSec: 0.005,
                decaySec: 0.035,
                peakGain: 0.15,
            },
        });
    }

    public playSuccess(): void {
        this.playDualTone({
            baseFreq: 523.25, // C5
            harmonicFreq: 659.25, // E5
            baseType: 'sine',
            harmonicType: 'sine',
            envelope: {
                attackSec: 0.01,
                decaySec: 0.18,
                peakGain: 0.22,
            },
        });
    }

    public playWarning(): void {
        this.playDualTone({
            baseFreq: 330,
            harmonicFreq: 311.13, // 微失谐警示双音
            baseType: 'triangle',
            harmonicType: 'sine',
            envelope: {
                attackSec: 0.008,
                decaySec: 0.12,
                peakGain: 0.2,
            },
        });
    }

    public playToggle(active: boolean): void {
        const base = active ? 440 : 330;
        const harmonic = active ? 880 : 220;
        this.playDualTone({
            baseFreq: base,
            harmonicFreq: harmonic,
            baseType: 'sine',
            harmonicType: 'triangle',
            envelope: {
                attackSec: 0.004,
                decaySec: 0.06,
                peakGain: 0.18,
            },
        });
    }
}

