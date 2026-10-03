/**
 * AIRFRAME — nose shell + fuselage skins, frames, stringers, bulkheads, fairings,
 * antennas, fastener fields. All outer surfaces loft from FUSELAGE_FRAMES
 * (the same table feeds the 2D design sheet → proportion lock).
 */
import * as THREE from 'three';
import { loftFuselageSkin, ringBand, strut, box, fastenerMatrices, mergeGeometries } from './_util.js';
import { frameAt, framePoint, insetFrame } from '../math/profiles.js';
import { FUSELAGE_FRAMES, FRAME_PITCH, BULKHEADS } from '../spec/fuselageSpec.js';
import { REF } from '../spec/referenceDimensions.js';
import { makeRng, clamp } from '../spec/constants.js';

const FR = FUSELAGE_FRAMES;
const M_TOP = 'airframeTop', M_BOT = 'airframeBot', M_INT = 'interiorStructure', M_MET = 'bareMetal', M_PRM = 'structurePrimer';

export function build(ctx) {
  const rng = makeRng(101);
  const X0 = 2.30; // nose/fuselage split station

  // ───────────────────────── nose shell ─────────────────────────
  const xsNose = [];
  for (let x = 0; x < X0; x += 0.08) xsNose.push(+x.toFixed(3));
  xsNose.push(X0);
  ctx.mesh('nose.shell', {
    geomKey: 'nose.skin', mat: M_TOP,
    geom: () => loftFuselageSkin(FR, xsNose, [0, 1], { perim: 44 })
  });

  // ───────────────── muzzle port: collar + dark cavity disc ─────────────
  ctx.mesh('nose.muzzle-port', {
    geomKey: 'nose.muzzle-collar', mat: 'steelDark',
    geom: () => {
      const outer = (t) => [0.115 * Math.cos(t * Math.PI * 2), 1.115 + 0.115 * Math.sin(t * Math.PI * 2)];
      const inner = (t) => [0.092 * Math.cos(t * Math.PI * 2), 1.115 + 0.092 * Math.sin(t * Math.PI * 2)];
      const g = ringBand(outer, inner, 0.30, 0.62, 16);
      g.translate(0, REF.gun.muzzleY, 0);
      return g;
    }
  });
  ctx.mesh('nose.muzzle-port', {
    geomKey: 'nose.muzzle-hole', mat: 'intakeDark', cast: false,
    geom: () => {
      const g = new THREE.CircleGeometry(0.088, 16);
      g.rotateY(-Math.PI / 2);
      g.translate(0.56, REF.gun.muzzleY, 1.115);
      return g;
    }
  });

  // ───────────── forward access panels (raised landings, bucket 0) ───────
  const panels = [
    { x0: 0.95, x1: 1.75, t: 0.16, w: 0.42 },
    { x0: 1.05, x1: 1.90, t: 0.84, w: 0.40 },
    { x0: 1.40, x1: 2.15, t: 0.30, w: 0.30 },
    { x0: 1.45, x1: 2.20, t: 0.70, w: 0.30 }
  ];
  const pg = [];
  for (const p of panels) {
    const fr = frameAt(FR, (p.x0 + p.x1) / 2);
    const [py, pz] = framePoint(fr, clamp(p.t, 0.03, 0.97));
    const outward = pz >= fr.zc ? 1 : -1;
    pg.push(box([p.x0, py - p.w / 2, pz - 0.001 * outward], [p.x1, py + p.w / 2, pz + 0.014 * outward]));
  }
  ctx.mesh('nose.access-panels', {
    geomKey: 'nose.panels', mat: M_TOP, bucket: 0,
    geom: () => mergeGeometries(pg)
  });

  // ───────────────── nose rivet fields (instanced, bucket 0) ─────────────
  if (ctx.rivets) {
    const paths = [];
    for (const p of panels) {
      const fr = frameAt(FR, (p.x0 + p.x1) / 2);
      const [py, pz] = framePoint(fr, clamp(p.t, 0.03, 0.97));
      const o = pz >= fr.zc ? 0.018 : -0.018;
      paths.push([
        [p.x0 + 0.02, py - p.w / 2, pz + o], [p.x1 - 0.02, py - p.w / 2, pz + o],
        [p.x1 - 0.02, py + p.w / 2, pz + o], [p.x0 + 0.02, py + p.w / 2, pz + o],
        [p.x0 + 0.02, py - p.w / 2, pz + o]
      ]);
    }
    ctx.inst('nose.rivets', {
      geomKey: 'fastener.head', mat: M_MET, bucket: 0, cast: false,
      matrices: fastenerMatrices(paths, { pitch: 0.045, r: 0.005, h: 0.005, rng }),
      geom: () => new THREE.CylinderGeometry(1, 0.7, 1, 6)
    });
  } else ctx.part('nose.rivets');

  // ───────────────── pitot + AoA (left boom shown; right is mirror boom built here) ─
  ctx.mesh('nose.pitot', {
    geomKey: 'nose.pitot', mat: M_MET,
    geom: () => mergeGeometries([
      strut([1.32, 0.56, 1.315], [1.66, 0.635, 1.33], 0.021, 8),
      box([1.48, 0.585, 1.42], [1.58, 0.60, 1.54]),
      strut([1.32, -0.56, 1.315], [1.66, -0.635, 1.33], 0.021, 8),
      box([1.48, -0.60, 1.42], [1.58, -0.585, 1.54])
    ])
  });

  // ───────────────── refuel receptacle (right upper fwd fuselage) ────────
  ctx.mesh('nose.refuel-receptacle', {
    geomKey: 'nose.refuel', mat: 'steelDark',
    geom: () => {
      const fr = frameAt(FR, 3.02);
      const zt = fr.zc + fr.zu - 0.02;
      return mergeGeometries([
        box([2.82, 0.28, zt], [3.34, 0.62, zt + 0.035]),
        (() => { const c = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14); c.rotateX(Math.PI / 2); c.translate(3.08, 0.45, zt + 0.055); return c; })()
      ]);
    }
  });

  // ───────────────── fuselage skins (upper / lower) ──────────────────────
  const xsBody = [];
  for (let x = X0; x < REF.overall.length; x += 0.15) xsBody.push(+x.toFixed(3));
  xsBody.push(REF.overall.length);
  ctx.mesh('fuselage.skin-upper', {
    geomKey: 'fuse.skin-upper', mat: M_TOP,
    geom: () => loftFuselageSkin(FR, xsBody, [0, 0.5], { perim: 30 })
  });
  ctx.mesh('fuselage.skin-lower', {
    geomKey: 'fuse.skin-lower', mat: M_BOT,
    geom: () => loftFuselageSkin(FR, xsBody, [0.5, 1], { perim: 30 })
  });

  // ───────────────── internal frames: ONE merged mesh, real rings ────────
  ctx.mesh('fuselage.frames', {
    geomKey: 'fuse.frames', mat: M_INT, bucket: 1, cast: false, receive: false,
    geom: () => {
      const geos = [];
      for (let x = 0.9; x < 15.9; x += FRAME_PITCH) {
        const fr = frameAt(FR, x);
        geos.push(ringBand(
          (t) => framePoint(fr, t),
          (t) => framePoint(insetFrame(fr, 0.028, 0.028), t),
          +x.toFixed(2), +x.toFixed(2) + 0.034, 20
        ));
      }
      return mergeGeometries(geos);
    }
  });

  // ───────────────── stringers (L0 stiffener traces) ─────────────────────
  ctx.mesh('fuselage.stringers', {
    geomKey: 'fuse.stringers', mat: M_INT, bucket: 0, cast: false,
    geom: () => {
      const ts = [0.07, 0.15, 0.23, 0.31, 0.39, 0.45, 0.55, 0.62, 0.71, 0.8, 0.9];
      const geos = [];
      for (const t of ts) {
        let prev = null;
        for (let x = 1.0; x <= 15.7; x += 0.5) {
          const [y, z] = framePoint(frameAt(FR, x), t);
          const p = [x, y * 0.955, z + (t < 0.5 ? 0.006 : -0.006)];
          if (prev) geos.push(strut(prev[0] === p[0] ? prev : prev, p, 0.012, 5));
          prev = p;
        }
      }
      return mergeGeometries(geos);
    }
  });

  // ───────────────── bulkheads with real cut-outs ────────────────────────
  ctx.mesh('fuselage.bulkheads', {
    geomKey: 'fuse.bulkheads', mat: M_PRM, bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      for (const bh of BULKHEADS) {
        const fr = frameAt(FR, bh.x);
        const pts = [];
        for (let j = 0; j < 30; j++) { const [y, z] = framePoint(insetFrame(fr, 0.02, 0.02), j / 30); pts.push(new THREE.Vector2(z, y)); }
        const shape = new THREE.Shape(pts);
        for (const h of bh.holes) {
          const path = new THREE.Path();
          path.absarc(h.z, h.y, Math.max(0.05, h.r), 0, Math.PI * 2, true);
          shape.holes.push(path);
        }
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 10 });
        g.rotateY(-Math.PI / 2);
        g.translate(bh.x + 0.02, 0, 0);
        geos.push(g);
      }
      return mergeGeometries(geos);
    }
  });

  // ───────────────── spine fairing ────────────────────────────────────────
  ctx.mesh('fuselage.spine-fairing', {
    geomKey: 'fuse.spine', mat: M_TOP,
    geom: () => {
      const geos = [];
      let prev = null;
      for (let x = 6.15; x <= 12.6; x += 0.45) {
        const fr = frameAt(FR, x);
        const hw = 0.17 * clamp(1 - Math.abs(x - 9.4) / 3.7, 0.12, 1);
        const top = fr.zc + fr.zu - 0.008;
        if (prev) geos.push(box([prev[0], -prev[1], prev[2]], [x, hw, top + 0.028]));
        prev = [x, hw, top];
      }
      return mergeGeometries(geos);
    }
  });

  // ───────────────── ventral fairing (gun bay region) ────────────────────
  ctx.mesh('fuselage.ventral', {
    geomKey: 'fuse.ventral', mat: M_BOT, bucket: 1,
    geom: () => {
      const geos = [];
      let prev = null;
      for (let x = 1.9; x <= 4.65; x += 0.35) {
        const fr = frameAt(FR, x);
        const zb = fr.zc - fr.zl - 0.012;
        const hw = 0.58 * clamp(1 - Math.abs(x - 3.25) / 2.0, 0.25, 1);
        if (prev) geos.push(box([prev[0], -prev[1], prev[2]], [x, hw, zb]));
        prev = [x, hw, zb];
      }
      return mergeGeometries(geos);
    }
  });

  // ───────────────── panel seams + rivets ─────────────────────────────────
  const seamXs = [2.30, 3.85, 5.95, 6.90, 8.15, 9.60, 10.85, 12.62, 13.60];
  const seamGeos = [];
  const addSeam = (pts) => seamGeos.push(pts);
  for (const x of seamXs) {
    const fr = frameAt(FR, x);
    const ring = [];
    for (let j = 0; j <= 36; j++) { const [y, z] = framePoint(fr, j / 36); ring.push([x, y * 1.0035, z + (z > fr.zc ? 0.0016 : -0.0016)]); }
    addSeam(ring);
  }
  for (const t of [0.12, 0.36, 0.64, 0.88]) {
    const line = [];
    for (let x = 2.4; x <= 15.4; x += 0.24) { const [y, z] = framePoint(frameAt(FR, x), t); line.push([+x.toFixed(2), y * 1.0035, z + (t < 0.5 ? 0.0016 : -0.0016)]); }
    addSeam(line);
  }
  ctx.mesh('fuselage.panel-seams', {
    geomKey: 'fuse.seam-strips', mat: 'steelDark', bucket: 0, cast: false,
    geom: () => {
      // raised thin quads along each seam polyline (geometry seams, not decals)
      const geos = [];
      for (const pts of seamGeos) {
        for (let i = 0; i < pts.length - 1; i += 2) {
          const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], c = pts[Math.min(i + 2, pts.length - 1)];
          const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
          const nrm = dir.clone(); // seams sit ~radially out on rounded skin — approximate normal
          geos.push(box([a[0], a[1] - 0.004, a[2]], [b[0] + 0.006, b[1] + 0.004, b[2] + (nrm.y >= 0 ? 0.002 : -0.002)]));
        }
      }
      return mergeGeometries(geos);
    }
  });

  if (ctx.rivets) {
    const rp = [];
    for (const t of [0.09, 0.26, 0.44, 0.56, 0.74, 0.91]) {
      for (let seg = 0; seg < 7; seg++) {
        const pts = [];
        const xa = 2.5 + seg * 1.85;
        for (let x = xa; x < Math.min(xa + 1.5, 15.5); x += 0.16) {
          const [y, z] = framePoint(frameAt(FR, x), t);
          pts.push([+x.toFixed(2), y * 1.008, z + (t < 0.5 ? 0.005 : -0.005)]);
        }
        if (pts.length > 2) rp.push(pts);
      }
    }
    ctx.inst('fuselage.rivets', {
      geomKey: 'fastener.head', mat: M_MET, bucket: 0, cast: false,
      matrices: fastenerMatrices(rp, { pitch: 0.085, r: 0.0052, h: 0.0045, rng }),
      geom: () => new THREE.CylinderGeometry(1, 0.7, 1, 6)
    });
  } else ctx.part('fuselage.rivets');

  // ───────────────── antennas ─────────────────────────────────────────────
  ctx.mesh('fuselage.antennas', {
    geomKey: 'fuse.antennas', mat: 'steelDark',
    geom: () => {
      const top = frameAt(FR, 7.4), bot = frameAt(FR, 11.6);
      return mergeGeometries([
        box([7.28, 0.10, top.zc + top.zu - 0.012], [7.64, 0.135, top.zc + top.zu + 0.115]),
        box([7.28, -0.135, top.zc + top.zu - 0.012], [7.64, -0.10, top.zc + top.zu + 0.115]),
        box([11.48, 0.05, bot.zc - bot.zl - 0.105], [11.86, 0.085, bot.zc - bot.zl + 0.004]),
        box([9.02, 0.5, top.zc + top.zu - 0.012], [9.5, 0.53, top.zc + top.zu + 0.085])
      ]);
    }
  });

  // ───────────────── aft side fairings (mirror LR) ────────────────────────
  ctx.mesh('fuselage.fairing-aft.R', {
    geomKey: 'fuse.aft-fairing', mat: M_TOP,
    geom: () => {
      const a = frameAt(FR, 10.9), b = frameAt(FR, 12.75), c = frameAt(FR, 13.55);
      return mergeGeometries([
        box([10.9, a.y - 0.06, a.zc - a.zl + 0.1], [12.75, b.y + 0.2, b.zc + b.zu - 0.15]),
        box([12.75, b.y - 0.02, b.zc - b.zl + 0.05], [13.55, c.y + 0.1, c.zc + c.zu - 0.25])
      ]);
    }
  });
}
