/**
 * Landing-gear geometry (all retract FORWARD [doc S2]; nose gear offset right [doc S2]).
 * Oleo lengths/wheel sizes: wheel dia der from tire size class (26.5×6.5-10 main, exposed
 * half-tire when stowed [doc S2]); strut dimensions eng.
 */
import { REF } from './referenceDimensions.js';
const GR = REF.gear;

export const GEAR = {
  nose: {
    wheelR: GR.nose.wheelDia / 2, tireW: GR.nose.tireW,
    pivot: [3.62, GR.nose.y, 1.18],            // retraction hinge (upper forward)
    axleDown: [GR.nose.x - 0.10, GR.nose.y, GR.nose.wheelDia / 2], // geometry of strut when extended
    strutR: 0.085, scissor: 0.052,
    steer: true, doorCount: 1,
    upRetractAngleDeg: 96                     // swing forward/up to nest in the bay
  },
  main: {
    x: GR.main.x, y: GR.main.y,                      // wheel/axle stations from REF (doc)
    wheelR: GR.main.wheelDia / 2, tireW: GR.main.tireW,
    pivot: [9.62, GR.main.y, 1.30],
    trackY: GR.main.y,
    strutR: 0.105, scissor: 0.06,
    upRetractAngleDeg: 74,                    // rotate forward+inboard into fuselage wells
    exposedAfterRetract: GR.main.exposedAfterRetract,
    bayX: [8.35, 10.55], bayY: [0.62, 1.62], bayZ: [0.52, 1.38],
    doors: { inner: true, outer: true }
  },
  brakes: { discs: 2, r: 0.21 },
  tirePressureNote: 'low pressure 24 psi class (rough-field design, doc)'
};

export const WHEEL_DETAILS = {
  hubR: 0.155, hubL: 0.16, rimBolts: 8, brakeCaliper: true, skidPad: false
};
