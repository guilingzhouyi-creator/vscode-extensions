/**
 * Loadout presets — pure config (station id → store kind). Geometry module instantiates.
 * Counts follow documented carriage patterns; shapes conservative (lengths from public data).
 */
export const LOADOUTS = {
  clean: { name: 'Clean', stations: {} },
  cas: {
    name: 'CAS Standard (8×Mk82 + 2×AIM-9 + ALQ-131)',
    stations: {
      R1: 'aim9', R2: 'mk82pair', R3: 'mk82pair', R4: 'mk82pair', R5: 'mk82pair',
      F1: 'litening', F0: null, F2: 'alq131',
      L5: 'empty', L4: 'empty', L3: 'empty', L2: 'empty', L1: 'aim9'
    }
  },
  max: {
    name: 'Max (16,000 lb mixed)',
    stations: {
      R1: 'aim9', R2: 'maverick2', R3: 'maverick2', R4: 'mk82pair', R5: 'mk82pair',
      F1: 'rocketpod', F0: 'fuelTank600', F2: 'alq131',
      L1: 'aim9', L2: 'rocketpod', L3: 'mk82pair', L4: 'maverick2', L5: 'mk82pair'
    }
  },
  training: {
    name: 'Training (inert Mk-82 + pods)',
    stations: {
      R1: 'empty', R2: 'mk82pair', R3: 'mk82pair', L1: 'empty', L2: 'mk82pair', L3: 'mk82pair', F1: 'litening'
    }
  }
};

/** store catalogue entries (meters, kg) — public-shape approximations, see docs/01 */
export const STORES = {
  mk82: { len: 2.18, dia: 0.273, mass: 227, finSpan: 0.738, snakeye: true },
  maverick: { len: 2.49, dia: 0.30, mass: 305, wing: 0.54 },
  aim9: { len: 2.87, dia: 0.127, mass: 86.5, fin: 0.40 },
  rocketPod: { len: 1.96, dia: 0.375, mass: 216, tubes: 19 },
  alqPod: { len: 5.18, dia: 0.46, mass: 1089 },
  liteningPod: { len: 1.73, dia: 0.30, mass: 132 },
  tank600: { len: 4.42, dia: 0.76, mass: 2271, note: '600-gal test tank — flight-tested config only (doc)' }
};
