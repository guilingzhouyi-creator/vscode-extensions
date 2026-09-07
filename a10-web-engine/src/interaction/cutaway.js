/**
 * CUTAWAY — global renderer clipping planes in WORLD axes; the UI exposes aircraft axes.
 * aircraft x ↔ world x · aircraft z ↔ world y · aircraft y ↔ world −z (root rot −90°X).
 * X/Z cuts keep the lower/forward remainder (n·p + d ≥ 0 visible); Y cut is a symmetric
 * centre band (two planes) so both halves open like a clamshell section.
 */
import * as THREE from 'three';

export function createCutaway(renderer) {
  const px = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100);
  const pyA = new THREE.Plane(new THREE.Vector3(0, 0, 1), 100);
  const pyB = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100);
  const pz = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  const state = { x: { on: false, v: 16.2 }, y: { on: false, v: 9 }, z: { on: false, v: 4.6 }, pair: false };

  function refresh() {
    const planes = [];
    if (state.x.on) { px.constant = state.x.v; planes.push(px); }
    if (state.y.on) {
      if (state.pair) {
        pyA.constant = Math.abs(state.y.v); pyB.constant = Math.abs(state.y.v);
        planes.push(pyA, pyB);
      } else if (state.y.v >= 0) {
        pyA.constant = state.y.v; planes.push(pyA);            // cut port half beyond −v… keeps y ≥ −v
      } else {
        pyB.constant = -state.y.v; planes.push(pyB);           // starboard cut
      }
    }
    if (state.z.on) { pz.constant = state.z.v; planes.push(pz); }
    renderer.clippingPlanes = planes.length ? planes : null;
    renderer.localClippingEnabled = planes.length > 0;
  }
  function set(axis, v) { if (state[axis]) { state[axis].v = v; refresh(); } }
  function toggle(axis, on) { state[axis].on = on ?? !state[axis].on; if (axis === 'y') state.pair = false; refresh(); return state[axis].on; }
  function toggleYPair(on) { state.pair = on ?? !state.pair; if (state.pair) state.y.on = true; refresh(); return state.pair; }
  function clear() { state.x.on = state.y.on = state.z.on = false; refresh(); }
  return { set, toggle, toggleYPair, clear, state, refresh };
}
