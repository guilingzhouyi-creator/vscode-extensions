/**
 * LANDING GEAR — all legs retract FORWARD (doc); nose leg offset right of the gun (doc);
 * main wheels stay half-exposed when retracted (doc) → wells modelled as shallow recesses,
 * no full wheel cut into the belly. Real oleos, torque links, brake packs, actuators, doors.
 *  rig: gearNose/gearMainR(+L) retract 0..1 · wheelSpin handles 0..2π · door pivots
 */
import * as THREE from 'three';
import { mergeGeometries, box, strut, ringBand, fastenerMatrices } from './_util.js';
import { GEAR, WHEEL_DETAILS } from '../spec/gearSpec.js';
import { REF } from '../spec/referenceDimensions.js';
import { makeRng, rad } from '../spec/constants.js';

export function build(ctx) {
  const rng = makeRng(9);

  // ══════════════════ NOSE GEAR (right of centerline) ══════════════════════
  const ng = GEAR.nose;
  const pivotN = ctx.pivot('gear.nose.strut', {
    pos: ng.pivot, handle: 'gearNose', meta: { axis: 'y', limitDeg: -ng.upRetractAngleDeg, note: 'retracts forward (doc)' }
  });
  const axle = ng.axleDown;
  // oleo: chrome cylinder + exposed sliding tube
  ctx.mesh('gear.nose.strut', {
    geomKey: 'gear.nose.leg', mat: 'bareMetal', pivot: pivotN,
    geom: () => mergeGeometries([
      strut([ng.pivot[0] - 0.02, ng.pivot[1], ng.pivot[2]], [axle[0] + 0.06, axle[1], axle[2] + ng.wheelR + 0.16], 0.075, 12),
      strut([axle[0] + 0.02, axle[1], axle[2] + ng.wheelR + 0.20], [axle[0], axle[1], axle[2]], 0.048, 10),
      box([ng.pivot[0] - 0.10, ng.pivot[1] - 0.09, ng.pivot[2] - 0.02], [ng.pivot[0] + 0.14, ng.pivot[1] + 0.09, ng.pivot[2] + 0.09])
    ])
  });
  // torque link (scissor)
  ctx.mesh('gear.nose.strut', {
    geomKey: 'gear.nose.scissor', mat: 'steelDark', pivot: pivotN,
    geom: () => mergeGeometries([
      strut([axle[0] + 0.075, axle[1] - 0.02, axle[2] + ng.wheelR + 0.185], [axle[0] + 0.02, axle[1] - 0.03, axle[2] + ng.wheelR + 0.09], ng.scissor * 0.5, 6),
      strut([axle[0] + 0.02, axle[1] - 0.03, axle[2] + ng.wheelR + 0.09], [axle[0] - 0.04, axle[1] - 0.02, axle[2] + ng.wheelR + 0.0], ng.scissor * 0.5, 6)
    ])
  });
  // steering actuator
  ctx.mesh('gear.nose.strut', {
    geomKey: 'gear.nose.steer', mat: 'steelDark', bucket: 1, pivot: pivotN,
    geom: () => strut([ng.pivot[0] + 0.10, ng.pivot[1] + 0.02, ng.pivot[2] - 0.03], [axle[0] + 0.12, axle[1] + 0.05, axle[2] + ng.wheelR + 0.20], 0.028, 8)
  });
  // wheel + tire + brake, own spin pivot (axis = lateral)
  const pivotNW = ctx.pivot('gear.nose.wheel', { pos: axle, handle: 'wheelNose', meta: { axis: 'y' }, bucket: 2 });
  ctx.mesh('gear.nose.wheel', {
    geomKey: 'gear.nose.tire', mat: 'rubber', pivot: pivotNW,
    geom: () => {
      const t = new THREE.TorusGeometry(ng.wheelR - ng.tireW * 0.32, ng.tireW * 0.42, 10, 26);
      t.rotateY(Math.PI / 2);
      t.translate(axle[0], axle[1] + ng.tireW / 2, axle[2]);
      const t2 = t.clone(); t2.translate(0, -ng.tireW, 0);
      const band = new THREE.CylinderGeometry(ng.wheelR - 0.022, ng.wheelR - 0.022, ng.tireW * 0.72, 22, 1, true);
      band.rotateZ(Math.PI / 2);
      band.translate(axle[0], axle[1], axle[2]);
      return mergeGeometries([t, t2, band]);
    }
  });
  ctx.mesh('gear.nose.wheel', {
    geomKey: 'gear.nose.hub', mat: 'bareMetal', pivot: pivotNW,
    geom: () => {
      const h = new THREE.CylinderGeometry(WHEEL_DETAILS.hubR, WHEEL_DETAILS.hubR, ng.tireW * 0.95, 14);
      h.rotateZ(Math.PI / 2); h.translate(axle[0], axle[1], axle[2]);
      const bolts = [];
      for (let i = 0; i < WHEEL_DETAILS.rimBolts; i++) {
        const a = (i / WHEEL_DETAILS.rimBolts) * Math.PI * 2;
        const b = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6);
        b.rotateZ(Math.PI / 2);
        b.translate(axle[0], axle[1] + ng.tireW * 0.5, axle[2] + 0.1 * Math.sin(a));
        bolts.push(b);
      }
      return mergeGeometries([h, ...bolts]);
    }
  });
  // nose gear door (belly panel, hinged aft)
  const doorPN = ctx.pivot('gear.nose.doors', { pos: [3.86, ng.pivot[1] - 0.10, 0.665], handle: 'doorNose', meta: { axis: 'y', limitDeg: -75 }, bucket: 1 });
  ctx.mesh('gear.nose.doors', {
    geomKey: 'gear.nose.door', mat: 'airframeBot', pivot: doorPN, bucket: 1,
    geom: () => box([3.05, ng.pivot[1] - 0.42, 0.658], [3.86, ng.pivot[1] + 0.42, 0.672])
  });
  // wheel well: shallow bay behind doors + armored liner ribs
  ctx.mesh('gear.nose.bay', {
    geomKey: 'gear.nose.bay', mat: 'bayInterior', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      geos.push(box([2.98, 0.24, 0.70], [3.92, 0.30, 1.10]));
      geos.push(box([2.98, -0.42, 0.70], [3.92, -0.36, 1.10]));
      geos.push(box([3.86, -0.42, 0.70], [3.94, 0.30, 1.10]));
      for (let x = 3.02; x < 3.86; x += 0.21) geos.push(box([x, -0.42, 1.085], [x + 0.03, 0.30, 1.10]));
      return mergeGeometries(geos);
    }
  });
  ctx.part('gear.nose.strut'); ctx.part('gear.nose.wheel'); ctx.part('gear.nose.doors'); ctx.part('gear.nose.bay');

  // ══════════════════ MAIN GEAR (starboard; mirrored to port) ══════════════
  const mg = GEAR.main;
  const pivotM = ctx.pivot('gear.main.strut.R', {
    pos: mg.pivot, handle: 'gearMainR', meta: { axis: 'y', limitDeg: -mg.upRetractAngleDeg, note: 'fwd retract, tire stays exposed (doc)' }
  });
  const mAxle = [mg.x, mg.y, mg.wheelR + 0.015];
  ctx.mesh('gear.main.strut.R', {
    geomKey: 'gear.main.leg', mat: 'bareMetal', pivot: pivotM,
    geom: () => mergeGeometries([
      strut([mg.pivot[0], mg.pivot[1], mg.pivot[2]], [mAxle[0] + 0.10, mAxle[1], mAxle[2] + mg.wheelR + 0.24], 0.088, 12),
      strut([mAxle[0] + 0.055, mAxle[1], mAxle[2] + mg.wheelR + 0.28], [mAxle[0], mAxle[1], mAxle[2]], 0.056, 10),
      box([mg.pivot[0] - 0.12, mg.pivot[1] - 0.10, mg.pivot[2] - 0.03], [mg.pivot[0] + 0.16, mg.pivot[1] + 0.10, mg.pivot[2] + 0.10])
    ])
  });
  // drag/sid braces
  ctx.mesh('gear.main.strut.R', {
    geomKey: 'gear.main.braces', mat: 'steelDark', bucket: 1, pivot: pivotM,
    geom: () => mergeGeometries([
      strut([mAxle[0] + 0.16, mg.y - 0.02, mAxle[2] + mg.wheelR + 0.20], [9.55, mg.y - 0.06, 1.30], 0.03, 8),
      strut([mAxle[0] - 0.02, mg.y + 0.02, mAxle[2] + mg.wheelR + 0.12], [8.62, mg.y + 0.06, 1.24], 0.034, 8)
    ])
  });
  const pivotMW = ctx.pivot('gear.main.wheel.R', { pos: mAxle, handle: 'wheelMainR', meta: { axis: 'y' }, bucket: 2 });
  ctx.mesh('gear.main.wheel.R', {
    geomKey: 'gear.main.tire', mat: 'rubber', pivot: pivotMW,
    geom: () => {
      const t = new THREE.TorusGeometry(mg.wheelR - mg.tireW * 0.30, mg.tireW * 0.40, 10, 28);
      t.rotateY(Math.PI / 2);
      t.translate(mAxle[0], mAxle[1] + mg.tireW / 2, mAxle[2]);
      const t2 = t.clone(); t2.translate(0, -mg.tireW, 0);
      const band = new THREE.CylinderGeometry(mg.wheelR - 0.02, mg.wheelR - 0.02, mg.tireW * 0.78, 24, 1, true);
      band.rotateZ(Math.PI / 2);
      band.translate(mAxle[0], mAxle[1], mAxle[2]);
      return mergeGeometries([t, t2, band]);
    }
  });
  ctx.mesh('gear.main.wheel.R', {
    geomKey: 'gear.main.hub', mat: 'bareMetal', pivot: pivotMW,
    geom: () => {
      const h = new THREE.CylinderGeometry(WHEEL_DETAILS.hubR, WHEEL_DETAILS.hubR, mg.tireW * 0.9, 14);
      h.rotateZ(Math.PI / 2); h.translate(mAxle[0], mAxle[1], mAxle[2]);
      return h;
    }
  });
  // brake pack (exposed outboard, doc: partial exposure philosophy)
  ctx.mesh('gear.main.brakes.R', {
    geomKey: 'gear.main.brakes', mat: 'bluedSteel', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (let i = 0; i < GEAR.brakes.discs; i++) {
        const d = new THREE.CylinderGeometry(GEAR.brakes.r, GEAR.brakes.r, 0.014, 18);
        d.rotateZ(Math.PI / 2);
        d.translate(mAxle[0], mAxle[1] - mg.tireW * 0.62 - i * 0.022, mAxle[2]);
        geos.push(d);
      }
      return mergeGeometries(geos);
    }
  });
  // retract actuator
  ctx.mesh('gear.main.actuator.R', {
    geomKey: 'gear.main.act', mat: 'steelDark', bucket: 1,
    geom: () => mergeGeometries([
      strut([9.95, mg.y + 0.05, 1.42], [mAxle[0] + 0.22, mg.y + 0.09, mAxle[2] + mg.wheelR + 0.30], 0.045, 8),
      strut([mAxle[0] + 0.22, mg.y + 0.09, mAxle[2] + mg.wheelR + 0.30], [mAxle[0] + 0.185, mg.y + 0.09, mAxle[2] + mg.wheelR + 0.14], 0.03, 6)
    ])
  });
  ctx.mesh('gear.main.torque.R', {
    geomKey: 'gear.main.torque', mat: 'steelDark', bucket: 1, pivot: pivotM,
    geom: () => mergeGeometries([
      strut([mAxle[0] + 0.12, mg.y - 0.035, mAxle[2] + mg.wheelR + 0.30], [mAxle[0] + 0.05, mg.y - 0.05, mAxle[2] + mg.wheelR + 0.15], 0.026, 6),
      strut([mAxle[0] + 0.05, mg.y - 0.05, mAxle[2] + mg.wheelR + 0.15], [mAxle[0] - 0.02, mg.y - 0.035, mAxle[2] + mg.wheelR + 0.02], 0.026, 6)
    ])
  });
  // doors: inner + outer belly panels hinged fore/aft along X (rotate about x through hinge)
  const doorIn = ctx.pivot('gear.main.doors-in.R', { pos: [mg.bayX[0], mg.bayY[0] + 0.02, 0.614], handle: 'doorMainInR', meta: { axis: 'x', limitDeg: 82 }, bucket: 1 });
  ctx.mesh('gear.main.doors-in.R', {
    geomKey: 'gear.main.door-in', mat: 'airframeBot', bucket: 1, pivot: doorIn,
    geom: () => mergeGeometries([
      box([mg.bayX[0], mg.bayY[0] - 0.02, 0.606], [mg.bayX[1] - 0.10, mg.bayY[0] + 0.40, 0.620]),
      box([mg.bayX[0] + 0.2, mg.bayY[0] + 0.05, 0.56], [mg.bayX[0] + 0.34, mg.bayY[0] + 0.12, 0.606])
    ])
  });
  const doorOut = ctx.pivot('gear.main.doors-out.R', { pos: [mg.bayX[0] + 0.1, mg.bayY[1] - 0.04, 0.616], handle: 'doorMainOutR', meta: { axis: 'x', limitDeg: -58 }, bucket: 1 });
  ctx.mesh('gear.main.doors-out.R', {
    geomKey: 'gear.main.door-out', mat: 'airframeBot', bucket: 1, pivot: doorOut,
    geom: () => box([mg.bayX[0] + 0.1, mg.bayY[1] - 0.40, 0.604], [mg.bayX[1] - 0.16, mg.bayY[1] + 0.02, 0.618])
  });
  // wheel well (shallow; tire half-exposed — door edges follow the skin, bay is a recess)
  ctx.mesh('gear.main.bay.R', {
    geomKey: 'gear.main.bay', mat: 'bayInterior', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      geos.push(box([mg.bayX[0], mg.bayY[0], mg.bayZ[1] - 0.02], [mg.bayX[1], mg.bayY[1], mg.bayZ[1] + 0.02]));
      geos.push(box([mg.bayX[0], mg.bayY[1] - 0.05, mg.bayZ[0]], [mg.bayX[0] + 0.05, mg.bayY[1], mg.bayZ[1]]));
      geos.push(box([mg.bayX[1] - 0.05, mg.bayY[1] - 0.05, mg.bayZ[0]], [mg.bayX[1], mg.bayY[1], mg.bayZ[1]]));
      for (let x = mg.bayX[0] + 0.1; x < mg.bayX[1] - 0.05; x += 0.3) {
        geos.push(box([x, mg.bayY[0], mg.bayZ[1] - 0.05], [x + 0.028, mg.bayY[1] - 0.05, mg.bayZ[1] - 0.01]));
      }
      return mergeGeometries(geos);
    }
  });
  ctx.part('gear.main.strut.R'); ctx.part('gear.main.wheel.R'); ctx.part('gear.main.brakes.R');
  ctx.part('gear.main.doors-in.R'); ctx.part('gear.main.doors-out.R'); ctx.part('gear.main.bay.R');
  ctx.part('gear.main.actuator.R'); ctx.part('gear.main.torque.R');

  // ══════════════════ belly skid strips (gear-up landings) ══════════════════
  ctx.mesh('gear.belt', {
    geomKey: 'gear.skids', mat: 'steelDark', bucket: 1,
    geom: () => {
      const geos = [];
      for (const [x0, x1, y0, y1] of [[3.0, 5.6, -0.42, -0.16], [3.0, 5.6, 0.16, 0.42], [8.5, 10.7, -0.9, -0.62], [8.5, 10.7, 0.62, 0.9]]) {
        geos.push(box([x0, y0, 0.612], [x1, y1, 0.640]));
      }
      return mergeGeometries(geos);
    }
  });
}
