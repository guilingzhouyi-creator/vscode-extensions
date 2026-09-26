/**
 * RIG — animation API driven by named pivots (never by id string concatenation hacks).
 * Commands map 0..1 / -1..1 inputs to hinge angles with correct symmetry:
 *  sym (flaps, gear, elevator, doors): both sides get the same local angle
 *  anti (ailerons for roll, fans/spools for same world rotation): L side inverted
 */
import { rad, clamp } from '../spec/constants.js';
import * as THREE from 'three';

const { Quaternion, Vector3 } = THREE;

export function createRig(model) {
  const rigs = model.rigs;
  const state = {
    gear: 0, canopy: 0, flaps: 0, aileron: 0, spoileron: 0, elevator: 0, rudder: 0,
    nacelle: 0, n1: 0, gun: 0, gunBay: 0, wheelSpin: 0, time: 0, locked: {}
  };

  function setAngle(handle, angle) {
    const r = rigs[handle];
    if (!r) return;
    if (state.locked[handle]) return; // damage system can lock a control
    const m = r.meta || {};
    if (m.axisVec) {
      r.node.quaternion.setFromAxisAngle(new Vector3(...m.axisVec).normalize(), angle);
    } else if (m.axis === 'x') r.node.rotation.x = angle;
    else if (m.axis === 'z') r.node.rotation.z = angle;
    else r.node.rotation.y = angle;
  }

  /** master command entry — one function, all channels; returns applied state */
  function command(channel, v) {
    v = Number.isFinite(v) ? v : 0;
    switch (channel) {
      case 'gear': {
        state.gear = clamp(v, 0, 1);
        const g = state.gear;
        setAngle('gearNose', rad(96) * g);
        setAngle('gearMainR', rad(74) * g);
        setAngle('gearMainL', rad(74) * g);
        // doors: open through the motion window, stow with the leg (sin window)
        const dw = Math.sin(Math.PI * g);
        setAngle('doorNose', rad(-75) * g);
        setAngle('doorMainInR', rad(82) * dw * -1 + rad(82) * g);
        setAngle('doorMainInL', rad(82) * dw * -1 + rad(82) * g);
        setAngle('doorMainOutR', rad(-58) * dw * -1 + rad(-58) * g);
        setAngle('doorMainOutL', rad(-58) * dw * -1 + rad(-58) * g);
        break;
      }
      case 'canopy': state.canopy = clamp(v, 0, 1); setAngle('canopyOpen', -rad(62) * state.canopy); break;
      case 'flaps': state.flaps = clamp(v, 0, 1); setAngle('flapR', rad(40) * state.flaps); setAngle('flapL', rad(40) * state.flaps); break;
      case 'aileron': state.aileron = clamp(v, -1, 1); setAngle('aileronR', rad(20) * state.aileron); setAngle('aileronL', -rad(20) * state.aileron); break;
      case 'spoileron': state.spoileron = clamp(v, 0, 1); setAngle('spoileronR', -rad(25) * state.spoileron); setAngle('spoileronL', -rad(25) * state.spoileron); break;
      case 'elevator': state.elevator = clamp(v, -1, 1); setAngle('elevatorR', -rad(25) * state.elevator); setAngle('elevatorL', -rad(25) * state.elevator); break;
      case 'rudder': state.rudder = clamp(v, -1, 1); setAngle('rudderR', rad(30) * state.rudder); setAngle('rudderL', -rad(30) * state.rudder); break;
      case 'nacelle': state.nacelle = clamp(v, 0, 1); setAngle('nacelleDoorR', rad(55) * state.nacelle); setAngle('nacelleDoorL', rad(55) * state.nacelle); break;
      case 'gunBay': state.gunBay = clamp(v, 0, 1); setAngle('gunBayDoorR', rad(46) * state.gunBay); setAngle('gunBayDoorL', rad(46) * state.gunBay); break;
      case 'n1': state.n1 = clamp(v, 0, 1); break; // applied continuously in update()
      case 'gun': state.gun = clamp(v, 0, 1); break;
      case 'wheelSpin': state.wheelSpin = clamp(v, 0, 1); break;
      default: break;
    }
    return { ...state };
  }

  function update(dt) {
    state.time += dt;
    if (state.n1 > 0.001) {
      const ang = state.time * state.n1 * 26;
      setAngle('fanR', ang); setAngle('fanL', -ang);
      setAngle('hptR', ang * 1.7); setAngle('hptL', -ang * 1.7);
      setAngle('lptR', ang * 1.35); setAngle('lptL', -ang * 1.35);
    }
    if (state.gun > 0.001) {
      const r = rigs.gunSpin;
      if (r && !state.locked.gunSpin) {
        const a = state.time * state.gun * 9;
        if (r.meta.axisVec) r.node.quaternion.setFromAxisAngle(new Vector3(...r.meta.axisVec), a);
      }
    }
    if (state.wheelSpin > 0) {
      setAngle('wheelNose', state.time * state.wheelSpin * 12);
      setAngle('wheelMainR', state.time * state.wheelSpin * 12);
      setAngle('wheelMainL', -state.time * state.wheelSpin * 12);
    }
  }

  /** damage hook: lock a control channel */
  function lock(handle, on = true) {
    state.locked[handle] = on;
    if (!on) delete state.locked[handle];
  }
  return { command, update, lock, state, setAngle };
}
