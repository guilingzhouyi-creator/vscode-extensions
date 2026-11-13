/**
 * Module: Interaction Design Physics — Second-Order Damped Harmonic Oscillator Presets
 * File Path: .agents/skills/interaction-design-physics/templates/spring-physics-presets.ts
 * Architecture Role: Analytic spring-mass-damper motion solver and canonical preset catalog.
 * Dependencies & Triggers: Pure mathematical utility module; imported by UI transition controllers.
 * Responsibilities: Solve normalized displacement for underdamped, critically damped, and overdamped regimes.
 * Exit Semantics & Design Rationale: Closed-form analytical solution avoiding frame-rate-dependent Euler integration drift.
 */

export interface SpringConfig {
    readonly stiffness: number; // k: elastic stiffness (N/m)
    readonly damping: number;   // c: damping coefficient (N*s/m)
    readonly mass: number;      // m: body mass (kg)
}

/** Solves normalized spring displacement (0 -> 1+) at elapsed seconds t. */
export function solveHarmonicOscillator(config: SpringConfig, t: number): number {
    const { stiffness: k, damping: c, mass: m } = config;
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(m * k));

    if (zeta < 1.0) {
        const wd = w0 * Math.sqrt(1.0 - zeta * zeta);
        const decay = Math.exp(-zeta * w0 * t);
        const oscillation = Math.cos(wd * t) + (zeta / Math.sqrt(1.0 - zeta * zeta)) * Math.sin(wd * t);
        return 1.0 - decay * oscillation;
    }

    if (Math.abs(zeta - 1.0) < 1e-4) {
        return 1.0 - Math.exp(-w0 * t) * (1.0 + w0 * t);
    }

    const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1.0));
    const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1.0));
    return 1.0 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

/** Preset 1: Snappy underdamped rebound (+8.8% overshoot, zeta = 0.612, ~0.22s). */
export const SPRING_SNAPPY: SpringConfig = Object.freeze({
    stiffness: 600,
    damping: 30,
    mass: 1.0,
});

/** Preset 2: Gentle smooth settle (+1.8% overshoot, zeta = 0.783, ~0.35s). */
export const SPRING_GENTLE: SpringConfig = Object.freeze({
    stiffness: 320,
    damping: 28,
    mass: 1.0,
});

/** Preset 3: Expressive bouncy micro-motion (+19.4% overshoot, zeta = 0.462, ~0.58s). */
export const SPRING_BOUNCY: SpringConfig = Object.freeze({
    stiffness: 380,
    damping: 18,
    mass: 1.0,
});

/** Preset 4: Overdamped magnetic snap (zero overshoot, zeta = 3.650, ~0.14s). */
export const SPRING_HEAVY_SNAP: SpringConfig = Object.freeze({
    stiffness: 1200,
    damping: 80,
    mass: 0.1,
});
