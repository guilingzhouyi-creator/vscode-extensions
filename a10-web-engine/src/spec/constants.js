/**
 * Global conventions & tolerances (headless — no three.js import here).
 *
 * COORDINATE SYSTEM (aircraft axes, used by ALL spec/geometry modules):
 *   +X = aft (nose tip at x=0),  +Y = starboard/right,  +Z = up.
 *   Datum: z=0 is the ground plane ("waterline"); y=0 fuselage station centerline.
 *   The renderer applies ONE root rotation to convert to three.js Y-up world axes.
 *
 * UNITS: metres, kilograms, radians unless suffixed otherwise.
 */
export const AXIS = { forward: -1 }; // +X is aft in aircraft drawing convention

/** Root transform aircraft-axes -> world (three.js Y-up): x_w=x, y_w=z, z_w=-y */
export const AIRCRAFT_TO_WORLD = { rotX: -Math.PI / 2 };

/** Tolerances used by the acceptance tests (proportion validation vs public data). */
export const TOLERANCE = {
  length: 0.02,   // ±2% vs 16.16 m
  wingspan: 0.02, // ±2% vs 17.42 m
  height: 0.025,  // ±2.5% vs 4.42 m (antennas/fin fairing blend vary by source)
  engineSpacing: 0.08
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rad = (deg) => (deg * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const smoothstep = (t) => t * t * (3 - 2 * t);
/** cosine ease used between fuselage frames so the loft stays organic */
export const frameEase = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/** deterministic PRNG (mulberry32) — all “detail scatter” must be reproducible */
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
