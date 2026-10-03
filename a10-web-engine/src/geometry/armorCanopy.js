/**
 * ARMOR bathtub + canopy assembly. Both are double-shelled real geometry (inner faces are
 * actual surfaces, not black decals). Canopy uses a single parametric surface family so the
 * windscreen/bubble/frame/seal/hinge all share profile math with the design sheet.
 */
import * as THREE from 'three';
import { box, mergeGeometries, loftLoops, ringBand, strut } from './_util.js';
import { frameAt, framePoint, insetFrame } from '../math/profiles.js';
import { FUSELAGE_FRAMES } from '../spec/fuselageSpec.js';
import { COCKPIT } from '../spec/cockpitSpec.js';
import { REF } from '../spec/referenceDimensions.js';

const FR = FUSELAGE_FRAMES;

/** canopy mid-surface: returns [y,z] for longitudinal u∈[0,1] (sill→rear) and lateral v∈[0,1] (CL→side) */
export function canopySurface(u, v) {
  const { sill, bubble } = COCKPIT.canopyFrame;
  const x = sill.x[0] + (sill.x[1] - sill.x[0]) * u;
  const sideY = sill.yHalf * (0.72 + 0.28 * u);
  const y = sideY * v;
  const zBot = 2.335 + 0.11 * Math.min(1, u * 3);
  const zTop = bubble.topZ * Math.pow(Math.max(0, 1 - Math.pow(v / 1.06, 2.6)), 0.62);
  const hump = 0.10 * Math.pow(Math.max(0, 1 - ((u - 0.52) / 0.55) ** 2), 2);
  return [x, y, zBot + Math.max(0, zTop - zBot) * (1 - Math.pow(v, 2.1)) + hump * (1 - v * v)];
}
/** indexed surface over u (sill→rear) × v (−1..+1 lateral); double-sided glass */
function canopyLoft(iu, iv) {
  const pos = [], uv = [], idx = [];
  const w = iv * 2 + 1;
  for (let i = 0; i <= iu; i++) {
    const u = i / iu;
    for (let j = 0; j < w; j++) {
      const s = -1 + (2 * j) / (w - 1); // -1..1
      const [x, y, z] = canopySurface(u, Math.abs(s));
      pos.push(x, y * Math.sign(s || 1), z);
      uv.push(u, j / (w - 1));
    }
  }
  for (let i = 0; i < iu; i++) for (let j = 0; j < w - 1; j++) {
    const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
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
  // ════════════ TITANIUM BATHTUB (x 3.85–6.55, real inner+outer shell) ════════════
  const armorXs = [];
  for (let x = 3.85; x <= 6.55; x += 0.28) armorXs.push(+x.toFixed(2));
  armorXs.push(6.55);
  const armorShell = (inset) => {
    const sections = armorXs.map((x) => {
      const fr = frameAt(FR, x);
      const f = insetFrame(fr, inset, inset);
      // clip to lower 55% + sides (bathtub wraps floor/sides, not the roof)
      const loop = [];
      for (let j = 0; j < 44; j++) {
        const t = 0.16 + 0.68 * (j / 43);
        const [y, z] = framePoint(f, t);
        loop.push([y, z]);
      }
      return { center: [x, 0, 0], loop };
    });
    return loftLoops(sections);
  };
  ctx.mesh('armor.bathtub', {
    geomKey: 'armor.outer', mat: 'titanium', bucket: 1, cast: false,
    geom: () => armorShell(0.05)
  });
  ctx.mesh('armor.bathtub', {
    geomKey: 'armor.inner', mat: 'titanium', bucket: 1, cast: false,
    geom: () => armorShell(0.092)
  });
  // armor top rim (shows plate thickness — the 0.5–1.5 in story made visible)
  ctx.mesh('armor.bathtub', {
    geomKey: 'armor.rim', mat: 'titanium', bucket: 1, cast: false,
    geom: () => mergeGeometries(armorXs.map((x) => {
      const fr = frameAt(FR, x);
      return ringBand(
        (t) => framePoint(insetFrame(fr, 0.05, 0.05), t),
        (t) => framePoint(insetFrame(fr, 0.092, 0.092), t),
        x, x + 0.02, 12
      );
    }).filter((_, i) => i % 4 === 0))
  });
  // spall liner: nylon fabric innermost surface
  ctx.mesh('armor.spall-liner', {
    geomKey: 'armor.spall', mat: 'cockpitDark', bucket: 0, cast: false,
    geom: () => {
      const sections = armorXs.map((x) => {
        const f = insetFrame(frameAt(FR, x), 0.10, 0.10);
        const loop = [];
        for (let j = 0; j < 40; j++) { const [y, z] = framePoint(f, 0.17 + 0.66 * (j / 39)); loop.push([y, z]); }
        return { center: [x, 0, 0], loop };
      });
      return loftLoops(sections);
    }
  });
  // windscreen armor backing frame
  ctx.mesh('armor.canopy-sill-armor', {
    geomKey: 'armor.sill-frame', mat: 'steelDark', bucket: 1,
    geom: () => mergeGeometries([
      box([3.52, -0.62, 2.24], [3.72, 0.62, 2.72]),
      box([3.66, -0.66, 2.28], [3.72, 0.66, 2.36])
    ])
  });

  // ════════════ CANOPY ════════════
  const glass = canopyLoft(26, 12);
  // open-to-the-right hinge (photos): rear-right axis, bubble + seal + frame follow it
  const h = COCKPIT.canopyFrame.hinge;
  const canopyPivot = ctx.pivot('canopy.bubble', { pos: [h.x, 0.64, h.z], handle: 'canopyOpen', meta: { axis: 'x', limitDeg: 62, note: 'rear-right hinge, opens right (photos)' } });
  ctx.mesh('canopy.bubble', {
    geomKey: 'canopy.bubble-glass', mat: 'glass', cast: false, receive: false, order: 2, pivot: canopyPivot,
    geom: () => glass
  });
  // windscreen: separate armored panel with flat slope (own small loft)
  ctx.mesh('canopy.windscreen', {
    geomKey: 'canopy.windscreen', mat: 'glass', bucket: 2, cast: false, order: 2,
    geom: () => {
      const sections = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const x = 3.60 + 0.385 * u;
        const zw = 2.42 + 0.235 * u;
        const loop = [];
        const half = 0.585 - 0.04 * u;
        for (let j = 0; j <= 16; j++) {
          const v = -1 + (2 * j) / 16;
          loop.push([v * half, zw + 0.05 * (1 - v * v) * u]);
        }
        sections.push({ center: [x, 0, 0], loop });
      }
      const g = loftLoops(sections, { closeLoop: false });
      return g;
    }
  });
  // jettison frame: tube following perimeter of bubble base + top bow line
  ctx.mesh('canopy.frame', {
    geomKey: 'canopy.frame', mat: 'steelDark',
    geom: () => {
      const geos = [];
      const ring = [];
      for (let j = 0; j <= 20; j++) { const [x, y, z] = canopySurface(0.02, j / 20); void x; ring.push([3.68, y, z - 0.008]); }
      for (let i = 0; i < ring.length - 1; i++) geos.push(strut(ring[i], ring[i + 1], 0.03, 6));
      // rear bow
      const bow = [];
      for (let j = 0; j <= 16; j++) { const [, y, z] = canopySurface(0.985, j / 16); bow.push([y, z]); }
      for (let i = 0; i < bow.length - 1; i++) geos.push(strut([5.745, bow[i][0], bow[i][1]], [5.745, bow[i + 1][0], bow[i + 1][1]], 0.026, 6));
      return mergeGeometries(geos);
    }
  });
  // hinge + actuator on right rear
  ctx.mesh('canopy.hinge', {
    geomKey: 'canopy.hinge', mat: 'bareMetal', bucket: 0,
    geom: () => {
      const h = COCKPIT.canopyFrame.hinge;
      const bar = new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10);
      bar.rotateZ(Math.PI / 2);
      bar.translate(h.x, 0.66, h.z);
      return mergeGeometries([bar,
        strut([h.x - 0.02, 0.63, h.z - 0.02], [h.x - 0.3, 0.6, h.z - 0.16], 0.022, 8),
        box([5.60, 0.55, 2.30], [5.80, 0.72, 2.36])
      ]);
    }
  });
  // seal landing (rubber ring following the bubble perimeter on the sill)
  ctx.mesh('canopy.seal', {
    geomKey: 'canopy.seal', mat: 'rubberBlackMatte', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      const N = 26;
      for (let i = 0; i < N; i++) {
        const u = 0.02 + (i / N) * 0.96;
        const [x, y, z] = canopySurface(u, 1.0);
        const [x2, y2, z2] = canopySurface(Math.min(1, u + 0.96 / N), 1.0);
        geos.push(strut([x, y, z - 0.02], [x2, y2, z2 - 0.02], 0.018, 5));
      }
      return mergeGeometries(geos);
    }
  });
}
