/**
 * Shared geometry utilities. ONE low-level path for every structural surface so that
 * skins, frames, ribs, ducts all share topology quality & winding conventions.
 *  - all custom geometry is indexed (needed for clean mirroring)
 *  - mirrorDeep flips index winding + normal.y so mirrored children stay front-facing
 *  - geometry creation is delegated to the ref-counted cache (ctx.cache.get)
 */
import * as THREE from 'three';
import { framePoint, frameAt } from '../math/profiles.js';

/**
 * Spanwise loft for wings/tail: sections = [{ y, z, loop:[[x,zDelta],...] }].
 * Loop x entries are ABSOLUTE aircraft x; z entries are offsets from the section z.
 */
export function loftSpanwise(sections, { closeLoop = false } = {}) {
  const n = sections[0].loop.length;
  const cols = closeLoop ? n + 1 : n;
  const pos = [], uv = [], idx = [];
  sections.forEach((s, i) => {
    for (let j = 0; j < cols; j++) {
      const [ux, uz] = s.loop[j % n];
      pos.push(ux, s.y, s.z + uz);
      uv.push(j / cols, i / (sections.length - 1 || 1));
    }
  });
  const w = cols - 1;
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < w; j++) {
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

/**
 * Closed-loop loft through sections: [{ center:[x,y,z], loop:[[dy,dz]...] (same length) }]
 * returns closed tube BufferGeometry. Rows are wrapped; end caps are real bulkhead parts.
 */
export function loftLoops(sections, { closeLoop = true } = {}) {
  const n = sections[0].loop.length;
  const cols = closeLoop ? n + 1 : n;
  const pos = [], uv = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    for (let j = 0; j < cols; j++) {
      const jj = j % n;
      const [dy, dz] = s.loop[jj];
      pos.push(s.center[0] + (s.axis === 'y' ? dy : 0), s.center[1] + (s.axis === 'y' ? 0 : dy), s.center[2] + dz);
      uv.push(j / cols, i / (sections.length - 1 || 1));
    }
  }
  const idx = [];
  const rows = sections.length, C = cols;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < (closeLoop ? n : n - 1); j++) {
    const a = i * C + j, b = i * C + j + 1, c = (i + 1) * C + j, d = (i + 1) * C + j + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** open-band loft between two t-ranges of fuselage frames: upper/lower skin split */
export function loftFuselageSkin(frames, xs, tRange, { perim = 40 } = {}) {
  const [t0, t1] = tRange;
  const n = Math.max(6, Math.round(perim * (t1 - t0)));
  const sections = xs.map((x) => {
    // frame at x: build loop over requested t window
    const fr = frameAt(frames, x);
    const loop = [];
    for (let j = 0; j < n; j++) {
      const t = t0 + (t1 - t0) * (j / n);
      const [y, z] = framePoint(fr, t);
      loop.push([y, z - fr.zc]);
    }
    return { center: [x, 0, fr.zc], loop };
  });
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  sections.forEach((s, i) => s.loop.forEach(([y, z], j) => {
    pos.push(s.center[0], s.center[1] + y, s.center[2] + z);
    uv.push(j / n, i / (sections.length - 1 || 1));
  }));
  const C = n;
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Closed structural ring (frame/rib): band between outer and inner (inset) loops at x..x+t.
 * Produces a real 3D ring — visible through skin in cutaway.
 */
export function ringBand(outerFn, innerFn, x0, x1, perim = 24, axis = 'x') {
  const loop = (fn) => {
    const pts = [];
    for (let j = 0; j < perim; j++) pts.push(fn(j / perim));
    return pts;
  };
  const o0 = loop(outerFn), o1 = loop(outerFn);
  const i1 = loop(innerFn), i0 = loop(innerFn);
  const sections = [
    { center: sectX(x0, axis), loop: o0 },
    { center: sectX(x0, axis), loop: i0 },
    { center: sectX(x1, axis), loop: i1 },
    { center: sectX(x1, axis), loop: o1 },
    { center: sectX(x0, axis), loop: o0 }
  ];
  return loftLoops(sections);
}
function sectX(v, axis) { return axis === 'x' ? [v, 0, 0] : [0, v, 0]; }

/** planar plate (bulkhead / floor / web) from (u,v) polygon, extruded along axis x or y or z */
export function plate(poly, { thick = 0.02, axis = 'x', at = 0, uvScale = 1 } = {}) {
  const shape = new THREE.Shape(poly.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const hole of (poly.holes || [])) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  if (axis === 'x') { g.rotateY(Math.PI / 2); g.translate(at, 0, 0); g.scale(uvScale, 1, uvScale); }
  else if (axis === 'z') { g.translate(0, 0, at); }
  else { g.rotateX(-Math.PI / 2); g.translate(0, at, 0); }
  return g;
}

/** cylinder between two points (struts, rods, chutes) */
export function strut(p0, p1, r, seg = 10, r1 = null) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1 ?? r, r, len, seg, 1, false);
  g.rotateX(Math.PI / 2); // align along Z first for easy quaternion
  const geo = g;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  geo.applyQuaternion(q);
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

/** box with explicit aircraft-axes placement: from=[x,y,z] to=[x,y,z], optional rotation about axes */
export function box(from, to, { rot = [0, 0, 0] } = {}) {
  const w = to[0] - from[0], h = to[1] - from[1], d = to[2] - from[2];
  const g = new THREE.BoxGeometry(Math.abs(w), Math.abs(h), Math.abs(d));
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  g.translate(from[0] + w / 2, from[1] + h / 2, from[2] + d / 2);
  return g;
}

/**
 * Instanced fastener field along seam polylines. Returns an array of Matrix4-like arrays
 * (position+scale); builder packages into InstancedMesh. `paths`: arrays of [x,y,z].
 */
export function fastenerMatrices(paths, { pitch = 0.075, r = 0.006, h = 0.004, rng = null } = {}) {
  const mats = [];
  for (const p of paths) {
    for (let s = 0; s < p.length - 1; s++) {
      const a = p[s], b = p[s + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const n = Math.max(1, Math.round(len / pitch));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const jitter = rng ? (rng() - 0.5) * 0.004 : 0;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        const up = Math.abs(dir.z) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        m.compose(
          new THREE.Vector3(a[0] + (b[0] - a[0]) * t + jitter, a[1] + (b[1] - a[1]) * t + jitter, a[2] + (b[2] - a[2]) * t),
          q, new THREE.Vector3(r + (rng ? rng() * 0.0012 : 0), h, r)
        );
        mats.push(m);
      }
    }
  }
  return mats;
}

/**
 * Concatenate indexed BufferGeometry list into one buffer (attribute union kept simple:
 * position/normal/uv only — all our custom+primitive geos provide them).
 */
export function mergeGeometries(geos) {
  let pc = 0, ic = 0;
  for (const g of geos) {
    if (!g.getAttribute('position') || !g.getAttribute('normal')) g.computeVertexNormals();
    pc += g.getAttribute('position').count;
    ic += g.getIndex() ? g.getIndex().count : 0;
  }
  const pos = new Float32Array(pc * 3), nrm = new Float32Array(pc * 3), uv = new Float32Array(pc * 2);
  const idx = new Uint32Array(ic);
  let po = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    pos.set(p.array, po * 3); nrm.set(n.array, po * 3);
    if (u && u.count === p.count) uv.set(u.array, po * 2);
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx[io + i] = gi.array[i] + po;
    io += gi ? gi.count : 0;
    po += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** deep clone + winding/normal fix for mirror groups (scale(1,-1,1) parents) */
export function mirrorDeep(obj) {
  obj.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      const g = o.geometry;
      if (!g.userData._mirrored) {
        const m = g.clone();
        const gi = m.getIndex();
        if (gi) {
          const arr = gi.array.slice();
          for (let i = 0; i < arr.length; i += 3) { const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t; }
          m.setIndex(new THREE.BufferAttribute(arr, 1));
          const nm = m.getAttribute('normal');
          for (let i = 0; i < nm.count; i++) nm.setY(i, -nm.getY(i));
          nm.needsUpdate = true;
        }
        m.userData._mirrored = true;
        m.userData._mirrorOf = g;
        o.geometry = m;
        o.userData._isMirrorGeo = true; // cache: disposed with source
      }
    }
  });
  return obj;
}

export { THREE };
