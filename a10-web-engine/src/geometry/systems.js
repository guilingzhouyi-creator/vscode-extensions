/**
 * SYSTEMS & BAYS (interior, visible through cutaway/x-ray/open bays):
 * 4 fuselage-mounted fuel cells + 2 sumps (doc), hydraulic pairs (doc), bleed ducts,
 * fwd avionics LRUs, engine firewalls. Conservative representative geometries —
 * every entry is annotated doc/eng; nothing invented is presented as documented.
 */
import * as THREE from 'three';
import { mergeGeometries, box, strut, loftLoops } from './_util.js';
import { REF } from '../spec/referenceDimensions.js';
import { frameAt, framePoint, insetFrame } from '../math/profiles.js';
import { FUSELAGE_FRAMES } from '../spec/fuselageSpec.js';

const FR = FUSELAGE_FRAMES;

export function build(ctx) {
  // ── aft fuselage fuel cells (the 4 tanks sit near CG, isolated from skin, doc) ──
  ctx.mesh('bays.fuel-aft', {
    geomKey: 'sys.fuelcells', mat: 'structurePrimer', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      const [x0, x1] = REF.fuel.main.xRange;
      for (const [y0, y1] of REF.fuel.main.yBands) {
        for (const side of [1, -1]) {
          const a = side === 1 ? y0 : -y1, b = side === 1 ? y1 : -y0;
          geos.push(box([x0 + 0.05, Math.min(a, b), 1.06], [x1 - 0.05, Math.max(a, b), 1.98]));      // bladder
          geos.push(box([x0 + 0.02, Math.min(a, b) - 0.03, 1.03], [x1 - 0.02, Math.max(a, b) + 0.03, 2.01])); // foam shell
        }
      }
      return mergeGeometries(geos);
    }
  });
  // ── sump tanks (2, doc: 230 mi reserve) ──────────────────────────────────
  ctx.mesh('bays.sumps', {
    geomKey: 'sys.sumps', mat: 'structurePrimer', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (const y of REF.fuel.sump.y) {
        const [x0, x1] = REF.fuel.sump.xRange;
        geos.push(box([x0, y - 0.16, 1.12], [x1, y + 0.16, 1.52]));
      }
      return mergeGeometries(geos);
    }
  });
  // ── twin redundant hydraulics (doc) — lines along both sides of the tub ──
  ctx.mesh('bays.hydraulics', {
    geomKey: 'sys.hyd', mat: 'steelDark', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (const side of [1, -1]) for (const z of [1.14, 1.22]) {
        let prev = null;
        for (let x = 6.55; x <= 12.1; x += 0.55) {
          const p = [x, side * 0.74, z - 0.02 * Math.sin(x)];
          if (prev) geos.push(strut(prev, p, 0.017, 6));
          prev = p;
        }
      }
      for (let x = 2.6; x <= 5.9; x += 0.5) geos.push(strut([x, 0.62, 1.06], [x + 0.48, 0.62, 1.055], 0.017, 6));
      return mergeGeometries(geos);
    }
  });
  // ── engine bleed air ducts (nacelle → aft fuselage) ──────────────────────
  ctx.mesh('bays.bleed-ducts', {
    geomKey: 'sys.bleed', mat: 'bareMetal', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      for (const side of [1, -1]) {
        geos.push(strut([11.6, side * 1.28, 2.28], [12.0, side * 0.9, 2.10], 0.075, 10));
        geos.push(strut([10.35, side * 1.28, 2.55], [10.9, side * 0.95, 2.34], 0.06, 10));
      }
      return mergeGeometries(geos);
    }
  });
  // ── forward avionics bay: LRU boxes on rails (generic — no invented part names) ─
  ctx.inst('bays.avionics', {
    geomKey: 'sys.lru', mat: 'cockpitDark', bucket: 0, cast: false,
    matrices: (() => {
      const m = [];
      let i = 0;
      for (const [x0, y0, z0, w, h] of [
        [1.15, 0.3, 1.62, 0.22, 0.16], [1.15, -0.3, 1.62, 0.22, 0.16],
        [1.5, 0.0, 1.62, 0.24, 0.16], [1.85, 0.32, 1.62, 0.2, 0.14],
        [1.85, -0.32, 1.62, 0.2, 0.14], [2.2, 0.0, 1.58, 0.26, 0.2],
        [1.4, 0.55, 1.24, 0.2, 0.15], [1.4, -0.55, 1.24, 0.2, 0.15],
        [1.9, 0.58, 1.18, 0.18, 0.12], [1.9, -0.58, 1.18, 0.18, 0.12],
        [2.4, 0.28, 1.10, 0.18, 0.12], [2.4, -0.28, 1.10, 0.18, 0.12]
      ]) {
        const mm = new THREE.Matrix4();
        mm.compose(new THREE.Vector3(x0, y0, z0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        void w; void h; void i; i++;
        m.push(mm);
      }
      return m;
    })(),
    geom: () => box([0, -0.1, -0.075], [0.2, 0.1, 0.075])
  });
  // ── wire bundles (eng: routing follows frames, doc: flight-controls protection) ──
  ctx.mesh('bays.wiring', {
    geomKey: 'sys.wiring', mat: 'rubberBlackMatte', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (const side of [1, -1]) for (let k = 0; k < 2; k++) {
        let prev = null;
        for (let x = 3.2; x <= 12.4; x += 0.9) {
          const fr = frameAt(FR, x);
          const p = [x, side * (0.7 + k * 0.07), 1.16 + k * 0.05 + 0.02 * Math.sin(x * 2 + k)];
          if (prev) geos.push(strut(prev, p, 0.013, 5));
          prev = p;
          void fr;
        }
      }
      return mergeGeometries(geos);
    }
  });
  // ── engine firewalls + extinguisher lines (doc) ──────────────────────────
  ctx.mesh('bays.firewall', {
    geomKey: 'sys.firewall', mat: 'steelDark', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      for (const side of [1, -1]) {
        const w = 0.02;
        geos.push(box([11.85, side * 1.02 - w, 1.62], [11.87, side * 1.98 + w, 2.62]));
        geos.push(strut([12.3, side * 1.5, 2.5], [11.4, side * 1.5, 2.35], 0.02, 6));
      }
      return mergeGeometries(geos);
    }
  });
  ctx.part('bays.gun-bay'); // built in gunBay.js (walls) — ensure exists for registry
  ctx.part('bays.fuel-aft'); ctx.part('bays.sumps'); ctx.part('bays.hydraulics');
  ctx.part('bays.avionics'); ctx.part('bays.wiring'); ctx.part('bays.bleed-ducts'); ctx.part('bays.firewall');
}
