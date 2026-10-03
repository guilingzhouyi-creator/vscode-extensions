/**
 * TF34-GE-100 internal architecture (per-side, nacelle-local X along thrust axis).
 * Stage counts documented [REF.engine]; axial distribution & diameters eng (from cutaway
 * references of the TF34 family), modelled as concentric modules with real geometry.
 */
import { REF } from './referenceDimensions.js';

export const ENGINE_AXIS = {
  xFront: 9.35, xRear: 12.85, // engine core module limits in aircraft X
  rFan: REF.engine.fanDia / 2,
  stations: {
    fan:        { x: 9.62, len: 0.30, rTip: 0.560, rHub: 0.205 },
    booster:    { x: 9.98, len: 0.30, rTip: 0.545, rHub: 0.215 }, // der: fan/booster shared LP shaft
    hpComp:     { x: 10.42, len: 0.92, rO: 0.330, rI0: 0.250, rI1: 0.130, bands: REF.engine.hpStagesShown },
    combustor:  { x: 11.46, len: 0.46, rO: 0.300, rI: 0.140, injectors: REF.engine.combustorNozzles },
    hpt:        { x: 12.00, len: 0.22, rTip: 0.285, rHub: 0.150, stages: REF.engine.hptStages },
    lpt:        { x: 12.30, len: 0.42, rTip: 0.385, rHub: 0.180, stages: REF.engine.lptStages },
    coreNozzle: { x: 12.78, len: 0.30, rTip: 0.175 },
    plug:       { x: 12.82, len: 0.34, r0: 0.150, r1: 0.060 },
    exhaustLip: { x: 13.10, r0: 0.395, r1: 0.462 }
  },
  bypass: { splitterX: 10.12, cowlGapR: 0.55, exitX: 13.02 },
  accessory: { x: 10.05, azDeg: -118, gearboxR: 0.13, gearboxLen: 0.30, starterR: 0.085, starterLen: 0.34 },
  mountPylon: { x: [10.2, 11.9], bolts: REF.nacelle.pylonBolts }
};

export const NACELLE = {
  ...REF.nacelle,
  // nacelle envelope: lofted rounded shell, D-section at front, circular aft
  cowlSegments: 9,
  doorHingeY: -1, // outboard lower hinge line for the field-access doors [photos: both sides clamshell]
  heatShield: 0.02
};
