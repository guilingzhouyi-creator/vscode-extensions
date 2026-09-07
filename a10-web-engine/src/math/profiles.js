/**
 * Pure profile math (headless, unit-testable, shared by 3D loft AND the 2D design sheet).
 * No three.js imports here.
 */
import { clamp, frameEase, lerp } from '../spec/constants.js';

/**
 * Superellipse-ish fuselage frame: returns (y, z) of a perimeter point for t∈[0,1).
 * Asymmetric upper/lower heights, exponent controls boxiness. y: -1..1 param maps around loop.
 */
export function framePoint(fr, t) {
  const a = t * Math.PI * 2;
  const c = Math.cos(a), s = Math.sin(a);
  const up = s >= 0;
  const n = up ? fr.nu : fr.nl;
  const h = up ? fr.zu : fr.zl;
  const pw = Math.pow(Math.abs(c), 2 / n) * fr.y * Math.sign(c || 1);
  const ph = Math.pow(Math.abs(s), 2 / n) * h * Math.sign(s || 1);
  return [pw, fr.zc + (up ? ph : -ph)];
}

/** interpolate two frames in t (0..1) with cosine easing at the ends */
export function blendFrames(fa, fb, tRaw) {
  const t = frameEase(tRaw);
  return {
    x: lerp(fa.x, fb.x, t),
    y: lerp(fa.y, fb.y, t),
    zu: lerp(fa.zu, fb.zu, t),
    zl: lerp(fa.zl, fb.zl, t),
    zc: lerp(fa.zc, fb.zc, t),
    nu: lerp(fa.nu, fb.nu, t),
    nl: lerp(fa.nl, fb.nl, t)
  };
}

/** find bracketing frames for x and return interpolated frame (or extrapolated ends clamped) */
export function frameAt(frames, x) {
  if (x <= frames[0].x) return { ...frames[0], x };
  const last = frames[frames.length - 1];
  if (x >= last.x) return { ...last, x };
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    if (x >= a.x && x <= b.x) return blendFrames(a, b, (x - a.x) / (b.x - a.x));
  }
  return { ...last, x };
}

/** shrink a frame laterally/vertically for inner shells (frames, liners) */
export function insetFrame(fr, dy, dz) {
  return { ...fr, y: Math.max(0.01, fr.y - dy), zu: Math.max(0.01, fr.zu - dz), zl: Math.max(0.01, fr.zl - dz), zc: fr.zc };
}

/**
 * NACA-4-digit style symmetric thickness + light camber — used for wing/tail sections.
 * Returns [xc, zc] offset from chord line, chord-normalized. (doc-style airfoil, thickness real)
 */
export function airfoilYt(xc, tOverC) {
  const x = clamp(xc, 0, 1);
  const a = 0.2969, b = -0.126, c = -0.3516, d = 0.2843, e = -0.1015;
  return 5 * tOverC * (a * Math.sqrt(x) + b * x + c * x * x + d * x ** 3 + e * x ** 4);
}
export function camber(xc, m = 0.02, p = 0.4) {
  const x = clamp(xc, 0, 1);
  return x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * ((1 - 2 * p) + 2 * p * x - x * x);
}

/**
 * Sample the airfoil loop: n points around upper (LE→TE) then back along lower.
 * Returns array of [u,v] in chord coords (u along chord 0..1, v normal) and normals for skins.
 */
export function airfoilLoop(chord, tOverC, n = 24, camberAmt = 0.02) {
  const pts = [];
  const half = Math.max(6, Math.floor(n / 2));
  const up = [], lo = [];
  for (let i = 0; i <= half; i++) {
    const xc = 0.5 - 0.5 * Math.cos((i / half) * Math.PI); // cosine spacing
    const yt = airfoilYt(xc, tOverC);
    const zc2 = camber(xc, camberAmt);
    up.push([xc * chord, (zc2 + yt) * chord]);
    lo.push([xc * chord, (zc2 - yt) * chord]);
  }
  for (let i = 0; i <= half; i++) pts.push(up[i]);
  for (let i = half - 1; i >= 0; i--) pts.push(lo[i]);
  return pts;
}

/**
 * Rounded-rectangle loop for nacelle/intake/duct profiles.
 * Walks the perimeter of a box (w×h) with corner radius r, sampling `n` points
 * proportionally to arc length. Returns closed polyline [[y,z],...] centered at 0.
 */
export function roundedRectLoop(w, h, r, n = 32) {
  const ew = w / 2, eh = h / 2;
  r = Math.max(1e-4, Math.min(r, ew * 0.98, eh * 0.98));
  const E = 2 * (eh - r), H = 2 * (ew - r), A = (Math.PI / 2) * r;
  const seg = [E, A, H, A, E, A, H, A]; // R-edge, arcBR, bottom, arcBL, L-edge, arcTL, top, arcTR
  const per = seg.reduce((a, b) => a + b, 0);
  const pts = [];
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per;
    let s = 0;
    while (s < 7 && d > seg[s]) { d -= seg[s]; s++; }
    const u = seg[s] > 1e-9 ? d / seg[s] : 0;
    pts.push(rectSegPoint(s, u, ew, eh, r));
  }
  return pts;
}
function rectSegPoint(s, u, ew, eh, r) {
  const HA = Math.PI / 2;
  switch (s) {
    case 0: return [ew, eh - r - u * 2 * (eh - r)];
    case 1: { const a = -u * HA; return [ew - r + Math.cos(a) * r, -(eh - r) + Math.sin(a) * r]; }
    case 2: return [ew - r - u * 2 * (ew - r), -eh];
    case 3: { const a = -HA - u * HA; return [-(ew - r) + Math.cos(a) * r, -(eh - r) + Math.sin(a) * r]; }
    case 4: return [-ew, -(eh - r) + u * 2 * (eh - r)];
    case 5: { const a = -2 * HA - u * HA; return [-(ew - r) + Math.cos(a) * r, (eh - r) + Math.sin(a) * r]; }
    case 6: return [-(ew - r) + u * 2 * (ew - r), eh];
    default: { const a = -3 * HA - u * HA; return [ew - r + Math.cos(a) * r, (eh - r) + Math.sin(a) * r]; }
  }
}

export const PROFILE_VERSION = 2;
