/**
 * Fuselage frame station table (x, half-width, upper/lower height from centre, z centre).
 * Derivation: silhouette measured proportionally from USAF 3-views, forced to match
 * documented overall length 16.16 m [REF.overall] and bathtub/cockpit stations.
 * Sections between stations are cosine-blended (frameEase) by the loft builder.
 *   source class: der (outer shape) / eng (frame spacing, internals)
 */
export const FUSELAGE_FRAMES = [
  { x: 0.00, y: 0.095, zu: 0.085, zl: 0.080, zc: 1.315, nu: 2.05, nl: 2.05 },
  { x: 0.34, y: 0.280, zu: 0.245, zl: 0.235, zc: 1.315, nu: 2.10, nl: 2.10 },
  { x: 0.85, y: 0.455, zu: 0.395, zl: 0.385, zc: 1.335, nu: 2.15, nl: 2.35 }, // gun muzzle brow
  { x: 1.55, y: 0.585, zu: 0.520, zl: 0.525, zc: 1.365, nu: 2.20, nl: 2.45 },
  { x: 2.35, y: 0.700, zu: 0.635, zl: 0.655, zc: 1.405, nu: 2.25, nl: 2.55 }, // forward av Bay
  { x: 3.10, y: 0.790, zu: 0.730, zl: 0.760, zc: 1.440, nu: 2.30, nl: 2.60 },
  { x: 3.85, y: 0.880, zu: 0.850, zl: 0.830, zc: 1.490, nu: 2.35, nl: 2.55 }, // cockpit start / armor tub
  { x: 4.60, y: 0.955, zu: 0.960, zl: 0.880, zc: 1.545, nu: 2.40, nl: 2.45 }, // max cockpit
  { x: 5.30, y: 0.990, zu: 0.990, zl: 0.900, zc: 1.575, nu: 2.35, nl: 2.40 },
  { x: 5.95, y: 0.995, zu: 0.970, zl: 0.905, zc: 1.575, nu: 2.30, nl: 2.40 }, // drum bay / tub aft bulkhead
  { x: 6.90, y: 0.965, zu: 0.900, zl: 0.895, zc: 1.555, nu: 2.30, nl: 2.50 }, // wing LE
  { x: 8.15, y: 0.930, zu: 0.850, zl: 0.875, zc: 1.535, nu: 2.35, nl: 2.60 }, // wing box fuel cell
  { x: 9.60, y: 0.895, zu: 0.810, zl: 0.865, zc: 1.525, nu: 2.40, nl: 2.65 }, // wing TE
  { x: 10.85, y: 0.835, zu: 0.815, zl: 0.840, zc: 1.545, nu: 2.45, nl: 2.60 }, // main-gear wells
  { x: 11.90, y: 0.755, zu: 0.830, zl: 0.790, zc: 1.575, nu: 2.45, nl: 2.55 },
  { x: 12.62, y: 0.675, zu: 0.840, zl: 0.735, zc: 1.615, nu: 2.45, nl: 2.55 }, // h-stab root
  { x: 13.60, y: 0.545, zu: 0.775, zl: 0.640, zc: 1.690, nu: 2.40, nl: 2.50 },
  { x: 14.60, y: 0.385, zu: 0.625, zl: 0.500, zc: 1.790, nu: 2.35, nl: 2.45 },
  { x: 15.40, y: 0.235, zu: 0.470, zl: 0.360, zc: 1.880, nu: 2.30, nl: 2.40 },
  { x: 16.16, y: 0.048, zu: 0.140, zl: 0.098, zc: 1.965, nu: 2.20, nl: 2.30 }
];

/** Structural frame stations (eng: representative spacing 0.38–0.44 m, A-10 is densely framed) */
export const FRAME_PITCH = 0.40;

/** Major bulkheads — real floor/pressure & structural terminations [eng, structurally motivated] */
export const BULKHEADS = [
  { x: 2.30, name: 'forward-equipment-bulkhead', holes: [{ y: 0, z: 1.30, r: 0.24 }] },
  { x: 3.85, name: 'cockpit-forward-bulkhead',  holes: [{ y: 0, z: 2.05, r: 0.30 }] },
  { x: 6.35, name: 'aft-cockpit-bulkhead',      holes: [{ y: 0.0, z: 1.9, r: 0.26 }, { y: 0, z: 1.15, r: 0.18 }] },
  { x: 6.90, name: 'wing-box-forward-web',      holes: [] },
  { x: 10.21, name: 'wing-box-aft-web',         holes: [] },
  { x: 11.85, name: 'firewall-aft-fuselage',    holes: [{ y: 0.85, z: 1.9, r: 0.12 }, { y: -0.85, z: 1.9, r: 0.12 }] },
  { x: 14.95, name: 'tailcone-bulkhead',        holes: [] }
];

/** Longeron/stringer count on upper + lower skin (eng; skin non-load-bearing w/ integral stiffeners [S2]) */
export const STRINGERS = { upper: 7, lower: 5 };

/** Nose-gear bay + gun bay openings in the belly (used by skin builder to cut nothing —
 *  bays are separately modelled cavities behind removable doors, matching the A-10
 *  “replaceable skin panels” maintenance philosophy [S2]). */
export const NOSE_Z = { bellyMin: 0.615 };
