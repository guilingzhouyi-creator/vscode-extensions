/**
 * WINGS — built starboard, mirrored to port by the builder (mirror:'LR').
 *   planform: straight LE, tapered TE; chord derived from documented area/AR (lock)
 *   structure: 2 spars (web+caps), ribs @0.62 m, honeycomb LE core, foam-lined fuel cell
 *   surfaces: double-slotted flap (constant hinge x), split aileron w/ true swept hinge
 *             (custom-axis pivot), upper spoileron, track fairings, Hoerner tip
 * Hinge lines: where the physical hinge is straight (flap — inboard of anhedral break)
 * a plain Y-axis pivot is used; where it sweeps in plan (aileron/spoileron over the
 * tapered region) the pivot rotates about the actual hinge unit vector (meta.axis='custom').
 */
import * as THREE from 'three';
import { loftSpanwise, mergeGeometries, box, strut, fastenerMatrices, loftLoops } from './_util.js';
import {
  chordAt, leXAt, wingZAt, thicknessAt,
  WING, FLAP_FRAC, AILERON_FRAC, SPAR_FRAC, RIB_PITCH, WING_STATIONS_M, TIP_HOERNER
} from '../spec/wingSpec.js';
import { airfoilLoop } from '../math/profiles.js';
import { makeRng } from '../spec/constants.js';

const N_AF = 26, HALF = N_AF / 2;

/** per-station airfoil slices in absolute x; returns { up:[[x,zD]...], lo:[[x,zD]...] } */
function slices(y, f0, f1) {
  const c = chordAt(y), x0 = leXAt(y);
  const pts = airfoilLoop(c, thicknessAt(y) / c, N_AF, 0.02);
  const i0 = Math.round(f0 * HALF), i1 = Math.round(f1 * HALF);
  const up = pts.slice(i0, i1 + 1).map(([u, v]) => [x0 + u, v]);
  const j1 = N_AF - 1 - Math.round(f1 * HALF);
  const lo = pts.slice(N_AF - 1 - i1, j1 + 1).map(([u, v]) => [x0 + u, v]);
  return { up, lo };
}

export function build(ctx) {
  const rng = makeRng(57);
  const ys = WING_STATIONS_M;

  // ── skins (split upper/lower so each carries its own paint + explode) ───
  ctx.mesh('wing.skin-upper.R', {
    geomKey: 'wing.skin-up', mat: 'airframeTop',
    geom: () => loftSpanwise(ys.map((y) => ({ y, z: wingZAt(y), loop: slices(y, 0, 1).up })))
  });
  ctx.mesh('wing.skin-lower.R', {
    geomKey: 'wing.skin-lo', mat: 'airframeBot',
    geom: () => loftSpanwise(ys.map((y) => ({ y, z: wingZAt(y), loop: slices(y, 0, 1).lo.reverse() })))
  });

  // ── center box through the fuselage (not mirrored — symmetric by build) ──
  ctx.mesh('wing.center-box', {
    geomKey: 'wing.center-box', mat: 'structurePrimer', bucket: 1, cast: false,
    geom: () => {
      const z = WING.zPlane;
      const mk = (y) => {
        const pts = airfoilLoop(WING.chordRoot, 0.19, 22, 0.02);
        return { y, z, loop: pts.map(([u, v]) => [WING.xLE + u, v]) };
      };
      const order = [0, 0.29, 0.584];
      return loftSpanwise([...order.map(mk).reverse(), ...order.map(mk)]);
    }
  });

  // ── LE honeycomb solid core (0…0.14c closed lens, fixed thick LE — doc) ──
  ctx.mesh('wing.le-honeycomb.R', {
    geomKey: 'wing.le-hc', mat: 'structurePrimer', bucket: 1, cast: false,
    geom: () => loftSpanwise(ys.map((y) => {
      const { up, lo } = slices(y, 0, 0.14);
      return { y, z: wingZAt(y), loop: [...up, ...lo.slice(1).reverse()] };
    }), { closeLoop: true })
  });

  // ── spars (web + caps) ──────────────────────────────────────────────────
  for (const [frac, key, id] of [[SPAR_FRAC[0], 'front', 'wing.spar-front.R'], [SPAR_FRAC[1], 'rear', 'wing.spar-rear.R']]) {
    ctx.mesh(id, {
      geomKey: `wing.spar-${key}`, mat: 'interiorStructure', bucket: 1, cast: false,
      geom: () => {
        const geos = [];
        const line = (f) => ys.map((y) => {
          const c = chordAt(y), t = thicknessAt(y) / 2;
          return [leXAt(y) + f * c, y, wingZAt(y), t];
        });
        const A = line(frac);
        for (let i = 0; i < A.length - 1; i++) {
          const a = A[i], b = A[i + 1], th = 0.016, h0 = a[3] * 0.86, h1 = b[3] * 0.86;
          const web = new THREE.BufferGeometry();
          web.setAttribute('position', new THREE.Float32BufferAttribute([
            a[0] - th, a[1], a[2] - h0, a[0] + th, a[1], a[2] - h0,
            b[0] - th, b[1], b[2] - h1, b[0] + th, b[1], b[2] - h1
          ], 3));
          web.setIndex([0, 2, 1, 1, 2, 3, 0, 1, 2, 2, 1, 3]);
          web.computeVertexNormals();
          geos.push(web);
          geos.push(strut([a[0], a[1], a[2] + h0 - 0.012], [b[0], b[1], b[2] + h1 - 0.012], 0.021, 5));
          geos.push(strut([a[0], a[1], a[2] - h0 + 0.012], [b[0], b[1], b[2] - h1 + 0.012], 0.021, 5));
        }
        return mergeGeometries(geos);
      }
    });
  }

  // ── ribs: closed airfoil rings (visible in cutaway / open bays) ──────────
  ctx.mesh('wing.ribs.R', {
    geomKey: 'wing.ribs', mat: 'interiorStructure', bucket: 1, cast: false,
    geom: () => {
      const rings = [];
      const outer = (y) => airfoilLoop(chordAt(y), thicknessAt(y) / chordAt(y), 24, 0.02);
      for (let y = 0.86; y < WING.bTip - 0.2; y += RIB_PITCH) {
        const o = outer(y), i = outer(y).map(([u, v]) => [u * 0.94 + chordAt(y) * 0.03, v * 0.8]);
        const zc = wingZAt(y), x0 = leXAt(y);
        const secs = [
          { y, z: zc, loop: o.map(([u, v]) => [x0 + u, v]) },
          { y, z: zc, loop: i.map(([u, v]) => [x0 + u, v]) },
          { y: y + 0.028, z: zc, loop: i.map(([u, v]) => [x0 + u, v]) },
          { y: y + 0.028, z: zc, loop: o.map(([u, v]) => [x0 + u, v]) },
          { y, z: zc, loop: o.map(([u, v]) => [x0 + u, v]) }
        ];
        rings.push(loftSpanwise(secs, { closeLoop: true }));
      }
      return mergeGeometries(rings);
    }
  });

  // ── foam-lined main fuel cell in root (tank isolated from skin — doc) ────
  ctx.mesh('wing.fuel-cell.R', {
    geomKey: 'wing.fuel-cell', mat: 'structurePrimer', bucket: 1, cast: false,
    geom: () => {
      const z = wingZAt(0.9);
      const foam = box([7.15, 0.60, z - 0.225], [9.95, 1.26, z + 0.225]);
      const bladder = box([7.18, 0.63, z - 0.20], [9.92, 1.23, z + 0.20]);
      void bladder;
      return mergeGeometries([foam]);
    }
  });

  // ── FLAP — constant hinge line x (inboard of anhedral break) ────────────
  const [fy0, fy1] = WING.flapY;
  const flapHingeX = leXAt(0) + 0.60 * chordAt((fy0 + fy1) / 2);
  const flapZ = wingZAt(0) - thicknessAt((fy0 + fy1) / 2) * 0.30;
  const flapPivot = ctx.pivot('wing.flap.R', {
    pos: [flapHingeX, (fy0 + fy1) / 2, flapZ],
    handle: 'flapR', meta: { axis: 'y', limitDeg: 40, note: 'double-slotted inboard flap' }
  });
  ctx.mesh('wing.flap.R', {
    geomKey: 'wing.flap-body', mat: 'airframeBot', pivot: flapPivot,
    geom: () => loftSpanwise(range(fy0, fy1, 0.45).map((y) => {
      const c = chordAt(y);
      const fc = leXAt(y) + 0.965 * c - flapHingeX;
      const pts = airfoilLoop(fc, 0.15, 14, 0.02);
      return { y, z: flapZ - 0.01, loop: pts.map(([u, v]) => [flapHingeX + u, v]) };
    }))
  });
  // flap track fairings under fixed skin
  ctx.mesh('wing.flap-tracks.R', {
    geomKey: 'wing.flap-fairings', mat: 'airframeBot', bucket: 1,
    geom: () => {
      const geos = [];
      for (const y of range(fy0 + 0.5, fy1 - 0.3, 1.1)) {
        const c = chordAt(y);
        for (const f of [0.615, 0.745]) {
          const x = leXAt(y) + f * c;
          const z = wingZAt(y) - thicknessAt(y) / 2;
          geos.push(box([x - 0.10, y - 0.034, z - 0.10], [x + 0.16, y + 0.034, z + 0.005]));
        }
      }
      return mergeGeometries(geos);
    }
  });

  // ── AILERON — split (deceleron), swept true hinge ⇒ custom-axis pivot ───
  const [ay0, ay1] = WING.aileronY;
  const ailHinge = (y) => leXAt(y) + AILERON_FRAC.hinge * chordAt(y);
  const ax0 = [ailHinge(ay0), ay0, wingZAt(ay0) - 0.02];
  const ax1 = [ailHinge(ay1), ay1, wingZAt(ay1) - 0.02];
  const dir = new THREE.Vector3(ax1[0] - ax0[0], ay1 - ay0, ax1[2] - ax0[2]).normalize();
  const midY = (ay0 + ay1) / 2;
  const ailPivot = ctx.pivot('wing.aileron.R', {
    pos: [(ax0[0] + ax1[0]) / 2, midY, (ax0[2] + ax1[2]) / 2],
    handle: 'aileronR', meta: { axis: 'custom', axisVec: dir.toArray(), limitDeg: 20, note: 'split deceleron; symmetric pair w/ roll inversion' }
  });
  {
    const mkLeaves = (sign) => loftSpanwise(range(ay0, ay1, 0.4).map((y) => {
      const c = chordAt(y);
      const hx = ailHinge(y);
      const ac = 0.965 * c - AILERON_FRAC.hinge * c;
      const pts = airfoilLoop(ac, 0.14, 12, 0);
      return {
        y, z: wingZAt(y),
        loop: pts.map(([u, v]) => [hx + u, v + sign * 0.006])
      };
    }));
    ctx.mesh('wing.aileron.R', { geomKey: 'wing.ail-up', mat: 'airframeTop', pivot: ailPivot, geom: () => mkLeaves(+1) });
    ctx.mesh('wing.aileron.R', { geomKey: 'wing.ail-lo', mat: 'airframeBot', pivot: ailPivot, geom: () => mkLeaves(-1) });
  }

  // ── SPOILERON — upper surface plate, same custom-axis treatment ─────────
  const [sy0, sy1] = WING.spoileronY;
  const spHinge = (y) => leXAt(y) + 0.60 * chordAt(y);
  const sx0 = [spHinge(sy0), wingZAt(sy0) + thicknessAt(sy0) / 2];
  const sx1 = [spHinge(sy1), wingZAt(sy1) + thicknessAt(sy1) / 2];
  const spDir = new THREE.Vector3(sx1[0] - sx0[0], sy1 - sy0, sx1[1] - sx0[1]).normalize();
  const spPivot = ctx.pivot('wing.spoileron.R', {
    pos: [(sx0[0] + sx1[0]) / 2, (sy0 + sy1) / 2, (sx0[1] + sx1[1]) / 2],
    handle: 'spoileronR', meta: { axis: 'custom', axisVec: spDir.toArray(), limitDeg: 25 }
  });
  ctx.mesh('wing.spoileron.R', {
    geomKey: 'wing.sp-plate', mat: 'airframeTop', pivot: spPivot,
    geom: () => {
      const secs = range(sy0, sy1, 0.3).map((y) => {
        const hx = spHinge(y), z = wingZAt(y) + thicknessAt(y) / 2 + 0.006;
        const L = 0.30 * chordAt(y);
        const loop = [];
        for (let j = 0; j < 8; j++) { const u = j / 7; loop.push([hx + u * L, 0.010 * Math.sin(u * Math.PI) + 0.004]); }
        return { y, z, loop };
      });
      return loftSpanwise(secs);
    }
  });

  // ── Hoerner tip (dropped flat plate — photos) ───────────────────────────
  ctx.mesh('wing.tip.R', {
    geomKey: 'wing.tip', mat: 'airframeTop', bucket: 1,
    geom: () => {
      const y = WING.bTip - 0.005;
      const c = chordAt(y), z = wingZAt(y);
      return mergeGeometries([
        box([leXAt(y), y, z - TIP_HOERNER], [leXAt(y) + c * 0.30, y + 0.03, z + TIP_HOERNER]),
        box([leXAt(y), y, z - 0.011], [leXAt(y) + c * 0.94, y + 0.03, z + 0.011])
      ]);
    }
  });

  // ── panel traces + fasteners (LOD0) ────────────────────────────────────
  const pLine = range(1.2, 8.3, 0.9).map((y) => { const c = chordAt(y); return [leXAt(y) + 0.35 * c, y, wingZAt(y) + thicknessAt(y) / 2 + 0.004]; });
  if (pLine.length > 2) ctx.line('wing.panel-lines.R', { pts: pLine, name: 'wing.span-line' });
  if (ctx.rivets) {
    const paths = [];
    for (const yy of [1.15, 2.7, 4.2, 5.7, 7.0]) {
      const pts = [];
      for (let y = yy; y < yy + 0.85 && y < WING.bTip - 0.1; y += 0.085) {
        const c = chordAt(y);
        pts.push([leXAt(y) + 0.35 * c, y, wingZAt(y) + thicknessAt(y) / 2 + 0.005]);
      }
      if (pts.length > 2) paths.push(pts);
    }
    ctx.inst('wing.rivets.R', {
      geomKey: 'fastener.head', mat: 'bareMetal', bucket: 0, cast: false,
      matrices: fastenerMatrices(paths, { pitch: 0.09, r: 0.005, h: 0.004, rng }),
      geom: () => new THREE.CylinderGeometry(1, 0.7, 1, 6)
    });
  } else ctx.part('wing.rivets.R');
}

function range(a, b, step) { const r = []; for (let v = a; v < b - 1e-6; v += step) r.push(+v.toFixed(3)); r.push(+b.toFixed(3)); return r; }
