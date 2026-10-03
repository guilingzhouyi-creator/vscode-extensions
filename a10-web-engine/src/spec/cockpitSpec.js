/**
 * Cockpit (A-10C precision-engagement layout, der from public cockpit photos & Smithsonian
 * imagery): ACES II seat, 2× MFD, HUD, HOTAS, rudder pedals, side consoles, canopy frame.
 * Positions in aircraft axes [m]; all conservative shapes, no invented avionics.
 */
import { REF } from './referenceDimensions.js';
const C = REF.cockpit;

export const COCKPIT = {
  floor: { x: [3.95, 6.15], z: C.floorZ, material: 'antislip' },
  seat: {
    kind: C.seat, x: 4.62, z: 1.585, reclineDeg: 14,
    panW: 0.52, panD: 0.50, backH: 0.78, headH: 0.16, orange: true // ACES II seat pans famously orange
  },
  rudderPedals: { x: 4.18, spreadY: 0.30, z: 1.635, plate: 0.17 },
  stick: { x: 4.47, y: 0.27, z: 1.94, len: 0.31, gripLen: 0.13 }, // right-side stick (F-16 style [doc S2])
  throttle: { x: 5.36, y: -0.42, z: 1.90, len: 0.26, quadrant: true },
  mainPanel: { x: 3.98, z: 2.16, w: 1.18, h: 0.50, gauges: 18, mfd: 2 },
  leftConsole: { x: [3.9, 5.3], y: -0.72, z: 1.875, h: 0.16 },
  rightConsole: { x: [3.9, 5.3], y: 0.72, z: 1.875, h: 0.16 },
  hud: { x: 3.92, z: 2.52, glassW: 0.36, glassH: 0.18, combinerTilt: 20 },
  canopyFrame: {
    sill: { x: [3.62, 5.78], yHalf: 0.66, z: 2.44 },
    windscreen: { x: [3.60, 3.98], topZ: 2.66, armor: true },
    bubble: { x: [3.99, 5.72], topZ: 3.11, rear: true },
    hinge: { side: 1, x: 5.72, z: 2.46, openDeg: 62 } // opens right, rear hinge (photos)
  },
  ejectionHandles: { x: 4.55, z: 2.34, pair: true },
  fireBottle: { x: 5.95, y: 0.45, z: 1.72, r: 0.05 },
  jettisonNote: 'canopy jett handles left+right of seat (photos)'
};
