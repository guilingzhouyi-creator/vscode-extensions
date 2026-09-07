/**
 * Wing geometry spec (planform + structure stations). All planform values are
 * DERIVED from documented area/AR/span (see referenceDimensions) and validated by tests.
 */
import { REF } from './referenceDimensions.js';

const W = REF.wing;

/** spanwise station table (metres from centreline). Junction at WS23 = 0.584 m [doc S2]. */
export const WING_STATIONS_M = (() => {
  const y0 = W.yJunction, y1 = 4.70, y2 = W.bTip; // center box / inner panel / outer panel break at anhedral break
  const arr = [];
  for (let y = y0; y <= y1 + 1e-6; y += 0.26) arr.push(y);
  for (let y = y1 + 0.26; y < y2; y += 0.31) arr.push(y);
  arr.push(y2);
  return arr;
})();

/** chord(y): constant root inside fuselage box, linear taper out to tip */
export function chordAt(y) {
  const ay = Math.min(Math.abs(y), W.bTip);
  if (ay <= W.yJunction) return W.chordRoot;
  const t = (ay - W.yJunction) / (W.bTip - W.yJunction);
  return W.chordRoot + (W.chordTip - W.chordRoot) * t;
}
/** x of leading edge (straight, unswept) */
export const leXAt = () => W.xLE;
/** panel angle of incidence (anhedral break) */
export function wingZAt(y) {
  const ay = Math.abs(y);
  if (ay <= W.yAnhedralBreak) return W.zPlane;
  return W.zPlane + Math.tan((W.anhedralOuter * Math.PI) / 180) * (ay - W.yAnhedralBreak);
}
export function thicknessAt(y) {
  const t = Math.min(1, Math.abs(y) / W.bTip);
  return chordAt(y) * (W.tOverC_root + (W.tOverC_tip - W.tOverC_root) * t);
}
/** control-surface hinge lines (fraction of local chord) */
export const FLAP_FRAC = { hinge: 0.585, outboard: 0.965 };   // double-slotted flap segment
export const AILERON_FRAC = { hinge: 0.635, outboard: 0.965 };
export const SPOILER_FRAC = { chord: 0.30 };                  // upper-surface spoileron chord fraction

/** structural stations (eng): two main spars — A-10 uses a two-spr wing per design refs */
export const SPAR_FRAC = [0.28, 0.72];
export const RIB_PITCH = 0.62;
export const FUEL_Y_BAND = [0.30, 1.24];
export const TIP_HOERNER = 0.115; // Hoerner-type dropped tip plate depth (photos)

export { W as WING };
