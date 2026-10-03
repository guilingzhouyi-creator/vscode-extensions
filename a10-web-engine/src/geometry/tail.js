/**
 * EMPENNAGE — h-stab + elevators (LR mirror), twin fins + rudders, tail cone,
 * dischargers, root fairings. Fins loft vertically (sections in x–y plane per z-row).
 * Elevators/rudders hinge about their true (swept) hinge lines via custom-axis pivots.
 */
import * as THREE from 'three';
import { loftSpanwise, mergeGeometries, box, strut } from './_util.js';
import { airfoilLoop } from '../math/profiles.js';
import { REF } from '../spec/referenceDimensions.js';
import { makeRng } from '../spec/constants.js';

const T = REF.tail;

/** vertical loft: sections [{ z, loop:[[x,y],...] }] → world (x, y, z) */
function loftVert(sections) {
  const n = sections[0].loop.length;
  const cols = n + 1;
  const pos = [], uv = [], idx = [];
  sections.forEach((s, i) => {
    for (let j = 0; j < cols; j++) {
      const [ux, uy] = s.loop[j % n];
      pos.push(ux, uy, s.z);
      uv.push(j / cols, i / (sections.length - 1 || 1));
    }
  });
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function build(ctx) {
  const rng = makeRng(91);
  void rng;

  // ══════════ HORIZONTAL STABILIZER (per side, root inside fuselage) ══════════
  const hStations = [];
  for (let y = 0; y <= T.hStabSpanHalf + 1e-6; y += 0.42) hStations.push(+y.toFixed(3));
  hStations.push(T.hStabSpanHalf);
  const hChord = (y) => T.hStabChordRoot + (T.hStabChordTip - T.hStabChordRoot) * (y / T.hStabSpanHalf);
  const hLe = () => T.hStabX;
  const hSec = (y) => airfoilLoop(hChord(y), 0.12, 16, 0.0).map(([u, v]) => [hLe() + u, v]);
  ctx.mesh('tail.hstab.R', {
    geomKey: 'tail.hstab-skin', mat: 'airframeTop',
    geom: () => {
      const up = loftSpanwise(hStations.map((y) => ({ y, z: T.hStabZ, loop: hSec(y).slice(0, 9) })));
      const lo = loftSpanwise(hStations.map((y) => ({ y, z: T.hStabZ, loop: hSec(y).slice(7).reverse() })));
      const tip = box([hLe() + hChord(T.hStabSpanHalf) * 0.2, T.hStabSpanHalf - 0.03, T.hStabZ - 0.06],
        [hLe() + hChord(T.hStabSpanHalf) * 0.8, T.hStabSpanHalf + 0.012, T.hStabZ + 0.06]);
      return mergeGeometries([up, lo, tip]);
    }
  });
  // internal ribs for the h-stab (L0/L1)
  ctx.line('tail.root-fairings.R', {
    pts: hStations.filter((_, i) => i % 2 === 0).map((y) => [hLe() + 0.3 * hChord(y), y, T.hStabZ + 0.075]),
    name: 'hstab-ribtrace'
  });

  // ══════════ ELEVATOR (true hinge line, custom-axis) ══════════
  const [ey0, ey1] = T.elevatorY;
  const eHinge = (y) => hLe() + 0.68 * hChord(y);
  const a0 = [eHinge(ey0), T.hStabZ + 0.005], a1 = [eHinge(ey1), T.hStabZ + 0.005];
  const eDir = new THREE.Vector3(a1[0] - a0[0], ey1 - ey0, a1[1] - a0[1]).normalize();
  const ePivot = ctx.pivot('tail.elevator.R', {
    pos: [(a0[0] + a1[0]) / 2, (ey0 + ey1) / 2, a0[1]],
    handle: 'elevatorR', meta: { axis: 'custom', axisVec: eDir.toArray(), limitDeg: 25, symmetric: true }
  });
  ctx.mesh('tail.elevator.R', {
    geomKey: 'tail.elevator', mat: 'airframeBot', pivot: ePivot,
    geom: () => {
      const ys = [];
      for (let y = ey0; y <= ey1 + 1e-6; y += 0.4) ys.push(y);
      ys.push(ey1);
      return loftSpanwise(ys.map((y) => {
        const hx = eHinge(y);
        const ec = hLe() + hChord(y) - hx + 0.03;
        const pts = airfoilLoop(ec, 0.13, 12, 0);
        return { y, z: T.hStabZ, loop: pts.map(([u, v]) => [hx + u, v]) };
      }));
    }
  });

  // ══════════ VERTICAL FINS (trapezoidal with root/tip fairings) ══════════
  const finH = T.finTipZ - T.finBaseZ;
  const finLe = (z) => {
    const t = (z - T.finBaseZ) / finH;
    return lerp(T.finRootX[0], T.finTipX[0], t);
  };
  const finTe = (z) => {
    const t = (z - T.finBaseZ) / finH;
    return lerp(T.finRootX[1], T.finTipX[1], t);
  };
  const finThk = (z) => 0.17 * (1 - 0.55 * (z - T.finBaseZ) / finH) + 0.02;
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  const finSec = (z, yC) => {
    const le = finLe(z), te = finTe(z), th = finThk(z);
    const loop = [];
    for (let j = 0; j < 18; j++) {
      const u = j / 17;
      const x = te - (te - le) * u;
      const w = Math.pow(Math.sin(u * Math.PI), 0.55) * th;
      loop.push([x, yC + (u < 0.5 ? w : w) * (j % 2 ? 1 : 1) * 0 + w]);
    }
    // build closed profile around the section (LE round, TE sharp): loop over full
    const pts = [];
    for (let j = 0; j <= 9; j++) { const u = j / 9; pts.push([te - (te - le) * u, yC + Math.pow(Math.sin(Math.PI * Math.min(1, u + 0.06)) * 1.06, 0.75) * w2(u, th)]); }
    for (let j = 9; j >= 0; j--) { const u = j / 9; pts.push([te - (te - le) * u, yC - Math.pow(Math.sin(Math.PI * Math.min(1, u + 0.06)) * 1.06, 0.75) * w2(u, th)]); }
    return pts;
  };
  const w2 = (u, th) => th * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(Math.min(1, u + 0.04), 0.8))), 0.8);
  void finSec;
  const finRows = [];
  for (let z = T.finBaseZ; z <= T.finTipZ + 1e-6; z += 0.16) finRows.push(z);
  finRows.push(T.finTipZ);
  const finLoop = (z) => {
    const le = finLe(z), te = finTe(z), th = finThk(z);
    const pts = [];
    for (let j = 0; j <= 10; j++) { const u = j / 10; pts.push([lerp(te, le, u), T.finCenterY + w2(u, th)]); }
    for (let j = 10; j >= 0; j--) { const u = j / 10; pts.push([lerp(te, le, u), T.finCenterY - w2(u, th)]); }
    return pts;
  };
  ctx.mesh('tail.fin.R', {
    geomKey: 'tail.fin-skin', mat: 'airframeTop',
    geom: () => loftVert(finRows.map((z) => ({ z, loop: finLoop(z) })))
  });
  // internal rib traces (L1)
  ctx.mesh('tail.fin.R', {
    geomKey: 'tail.fin-ribs', mat: 'interiorStructure', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      for (let z = T.finBaseZ + 0.3; z < T.finTipZ - 0.1; z += 0.55) {
        const le = finLe(z), te = finTe(z);
        geos.push(box([le + 0.1, T.finCenterY - 0.012, z], [te - 0.06, T.finCenterY + 0.012, z + 0.028]));
      }
      return mergeGeometries(geos);
    }
  });
  // tip cap
  ctx.mesh('tail.tip-fin-cap.R', {
    geomKey: 'tail.fin-tip', mat: 'airframeTop', bucket: 1,
    geom: () => box([finLe(T.finTipZ) - 0.02, T.finCenterY - 0.075, T.finTipZ - 0.04], [finTe(T.finTipZ) + 0.03, T.finCenterY + 0.075, T.finTipZ])
  });

  // ══════════ RUDDERS (hinge at rear chord of fin — custom axis along z-ish line) ══
  const rH0 = finTe(T.finBaseZ) - 0.30, rH1 = finTe(T.finTipZ) - 0.16;
  const rDir = new THREE.Vector3(rH1 - rH0, 0, T.finTipZ - 0.1 - T.finBaseZ).normalize();
  const rPivot = ctx.pivot('tail.rudder.R', {
    pos: [(rH0 + rH1) / 2, T.finCenterY + finThk(T.finBaseZ) * 0.2, (T.finBaseZ + T.finTipZ) / 2],
    handle: 'rudderR', meta: { axis: 'custom', axisVec: rDir.toArray(), limitDeg: 30, symmetric: true }
  });
  ctx.mesh('tail.rudder.R', {
    geomKey: 'tail.rudder', mat: 'airframeBot', pivot: rPivot,
    geom: () => {
      const rows = finRows.map((z) => {
        const te = finTe(z), th = finThk(z) * 0.9;
        const hx = lerp(te - 0.30, te - 0.16, (z - T.finBaseZ) / finH);
        const pts = [];
        const N = 8;
        for (let j = 0; j <= N; j++) { const u = j / N; pts.push([hx + (te + 0.01 - hx) * u, T.finCenterY + Math.pow(Math.sin(Math.PI * Math.min(1, u + 0.1)), 0.8) * th]); }
        for (let j = N; j >= 0; j--) { const u = j / N; pts.push([hx + (te + 0.01 - hx) * u, T.finCenterY - Math.pow(Math.sin(Math.PI * Math.min(1, u + 0.1)), 0.8) * th]); }
        return { z, loop: pts };
      });
      return loftVert(rows);
    }
  });
  // rudder hinge fittings (L1)
  ctx.mesh('tail.fin-rudder-seam.R', {
    geomKey: 'tail.rud-hinges', mat: 'bareMetal', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (let z = T.finBaseZ + 0.25; z < T.finTipZ - 0.1; z += 0.5) {
        const hx = lerp(finTe(z) - 0.30, finTe(z) - 0.16, (z - T.finBaseZ) / finH);
        geos.push(box([hx - 0.03, T.finCenterY - 0.03, z], [hx + 0.03, T.finCenterY + 0.03, z + 0.06]));
      }
      return mergeGeometries(geos);
    }
  });

  // ══════════ h-stab root fairings + fin roots ══════════
  ctx.mesh('tail.root-fairings.R', {
    geomKey: 'tail.rootfair', mat: 'airframeTop', bucket: 1,
    geom: () => {
      const fr = T.hStabZ;
      return mergeGeometries([
        box([12.35, 0.55, fr - 0.055], [13.9, 1.62, fr + 0.055]),
        box([12.35, -1.62, fr - 0.055], [13.9, -0.55, fr + 0.055])
      ]);
    }
  });

  // ══════════ tail cone + static dischargers ══════════
  ctx.mesh('tail.cone', {
    geomKey: 'tail.cone', mat: 'airframeTop',
    geom: () => {
      const geos = [];
      geos.push(box([14.6, -0.28, 1.62], [16.18, 0.28, 2.30]));
      geos.push(box([15.35, -0.14, 1.72], [16.22, 0.14, 2.12]));
      return mergeGeometries(geos);
    }
  });
  ctx.mesh('tail.dischargers', {
    geomKey: 'tail.dischargers', mat: 'steelDark', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (const [x, y, z] of [[16.22, 0, 1.98], [15.56, 2.0, 4.42], [15.56, -2.0, 4.42], [13.05, 3.45, 2.62], [13.05, -3.45, 2.62]]) {
        geos.push(strut([x - 0.12, y, z], [x + 0.06, y, z], 0.008, 5));
      }
      return mergeGeometries(geos);
    }
  });
}
