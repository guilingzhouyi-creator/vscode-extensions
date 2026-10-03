/**
 * ModelBuilder — turns spec + geometry modules into the scene graph.
 *
 *  Hierarchy:  modelRoot
 *               └ assembly:<id>                    (assembly explode base)
 *                   └ part:<id>  (Group + metadata)(per-part explode vector)
 *                       └ b2 ─┐ buckets: content tiers
 *                         b1 ─┤  visible while (currentLod <= bucket) ; b0 needs rivets on
 *                         b0 ─┘
 *                           └ pivot:<handle> └ meshes   (rig nodes; absolute-coords meshes
 *                                                        carry −pivot offset so the pivot
 *                                                        rotation is the hinge transform)
 *
 *  Part lifecycle: part.lod = max LOD level at which it exists (default 2 = all levels).
 *  Mirror: ids ending .R with mirror:'LR' are authored starboard; the builder twin-generates
 *  the .L part by wrapping each bucket clone in scale(1,-1,1) with winding-fixed shared
 *  geometry clones (cache key mirrorOf:<src> — still one clone per unique geometry).
 *  All geometry → ref-counted cache; all materials → shared factory.
 */
import * as THREE from 'three';
import { ASSEMBLIES, flattenParts } from '../spec/partTree.js';
import { createGeometryCache } from './geometryCache.js';
import { createMaterialFactory } from './materialFactory.js';

import * as airframe from '../geometry/airframe.js';
import * as armorCanopy from '../geometry/armorCanopy.js';
import * as cockpit from '../geometry/cockpit.js';
import * as gunBay from '../geometry/gunBay.js';
import * as wing from '../geometry/wing.js';
import * as tail from '../geometry/tail.js';
import * as nacelleEngine from '../geometry/nacelleEngine.js';
import * as landingGear from '../geometry/landingGear.js';
import * as systems from '../geometry/systems.js';
import * as stores from '../geometry/stores.js';

const MODULES = [airframe, armorCanopy, cockpit, gunBay, wing, tail, nacelleEngine, landingGear, systems, stores];

export function buildAircraft(opts = {}) {
  const { level = 0, rivets = true, noTextures = false, livery = 'europe1' } = opts;
  const cache = createGeometryCache();
  const matFactory = createMaterialFactory({ noTextures, livery });
  const rigs = {};
  const partDefs = new Map();
  const root = new THREE.Group();
  root.name = 'A10-THUNDERBOLT-II';
  const assemblyRoots = new Map();
  const groups = new Map();
  const bucketNodes = new Map();   // partId -> [b0,b1,b2]
  const builtIds = new Set();
  const lineMats = new Map();
  let handleSeq = 0;

  // ── registry expansion (mirror twins are implicit ids) ────────────────────
  for (const p of flattenParts()) {
    if (p.mirror === 'LR' && !p.id.endsWith('.R')) throw new Error(`mirror parts must end with .R : ${p.id}`);
    if (!p.mirror && p.id.endsWith('.R')) throw new Error(`.R suffix requires mirror:'LR' : ${p.id}`);
    partDefs.set(p.id, p);
    if (p.mirror === 'LR') {
      partDefs.set(p.id.replace(/\.R$/, '.L'), {
        ...p, id: p.id.replace(/\.R$/, '.L'), side: 'L',
        name: p.name + ' (L)', name_zh: p.name_zh + '（左）', rig: p.rig
      });
    }
  }

  // ── groups ────────────────────────────────────────────────────────────────
  for (const a of ASSEMBLIES) {
    const g = new THREE.Group();
    g.name = `assembly:${a.id}`;
    g.userData = { assembly: a.id, name: a.name, name_zh: a.name_zh, explode: a.explode };
    root.add(g);
    assemblyRoots.set(a.id, g);
  }
  for (const [id, p] of partDefs) {
    const g = new THREE.Group();
    g.name = `part:${id}`;
    g.userData = {
      partId: id, name: p.name, name_zh: p.name_zh, assembly: p.assembly,
      station: p.station, src: p.src, mass: p.mass, desc: p.desc,
      bucket: p.bucket, lod: p.lod, optional: p.optional, group: p.group,
      explode: p.explode, rigHandle: p.rig || null
    };
    groups.set(id, g);
  }
  for (const [id, g] of groups) {
    const par = partDefs.get(id).parent;
    (groups.get(par) || assemblyRoots.get(par) || root).add(g);
  }
  for (const id of groups.keys()) {
    const bs = [0, 1, 2].map((b) => {
      const n = new THREE.Group();
      n.name = `b${b}`;
      n.userData.bucket = b;
      groups.get(id).add(n);
      return n;
    });
    bucketNodes.set(id, bs);
  }

  // ── geometry-module context ───────────────────────────────────────────────
  const ctx = {
    THREE, level, rivets, rigs, cache, materials: matFactory,
    slot(partId, bucket) { return bucketNodes.get(partId)[bucket]; },
    part(id) {
      if (!groups.has(id)) throw new Error(`part not in registry: ${id}`);
      builtIds.add(id);
      return groups.get(id);
    },
    mesh(partId, { bucket, geomKey, geom, mat, pivot = null, name = '', cast = true, receive = true, order = 0, matOverride = null }) {
      builtIds.add(partId);
      const g = cache.get(geomKey, geom);
      const m = new THREE.Mesh(g, matOverride || matFactory.material(mat));
      m.name = name || partId;
      m.userData.partId = partId;
      m.renderOrder = order;
      if (pivot) m.position.sub(pivot.position);
      m.castShadow = cast; m.receiveShadow = receive;
      (pivot ? pivot : bucketNodes.get(partId)[bucket ?? partDefs.get(partId).bucket ?? 2]).add(m);
      return m;
    },
    inst(partId, { bucket, geomKey, geom, mat, matrices, name = '', cast = true, pivot = null }) {
      builtIds.add(partId);
      const g = cache.get(geomKey, geom);
      const im = new THREE.InstancedMesh(g, matFactory.material(mat), matrices.length);
      for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, matrices[i]);
      im.instanceMatrix.needsUpdate = true;
      im.name = name || `${partId}:inst`;
      im.userData.partId = partId;
      im.userData.instanced = true;
      im.castShadow = cast; im.receiveShadow = false;
      if (pivot) im.position.sub(pivot.position);
      (pivot || bucketNodes.get(partId)[bucket ?? partDefs.get(partId).bucket ?? 2]).add(im);
      return im;
    },
    /** rig pivot: lives in a bucket so LOD rules apply; meshes attached with mesh({pivot}) */
    pivot(partId, { pos = [0, 0, 0], rot = null, handle = null, meta = {}, bucket = null } = {}) {
      builtIds.add(partId);
      const g = new THREE.Group();
      const h = handle || `anon_${partId}_${handleSeq++}`;
      g.name = handle ? `pivot:${handle}` : `pivot:${h}`;
      g.position.set(...pos);
      if (rot) g.rotation.set(...rot);
      g.userData.handle = h;
      g.userData.pivotBucket = bucket ?? partDefs.get(partId).bucket ?? 2;
      bucketNodes.get(partId)[g.userData.pivotBucket].add(g);
      if (handle) {
        if (rigs[handle]) throw new Error(`duplicate rig handle: ${handle}`);
        rigs[handle] = { node: g, meta, baseRot: rot ? [...rot] : [0, 0, 0] };
      }
      return g;
    },
    line(partId, { bucket = 0, pts, color = 0x111418, name }) {
      builtIds.add(partId);
      const geo = cache.get(`line:${name || partId}:${pts.length}:${color}`, () =>
        new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))));
      let lm = lineMats.get(color);
      if (!lm) { lm = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }); lineMats.set(color, lm); }
      const l2 = new THREE.Line(geo, lm);
      l2.userData.partId = partId;
      l2.name = name || 'seam';
      bucketNodes.get(partId)[bucket].add(l2);
      return l2;
    }
  };

  for (const mod of MODULES) mod.build(ctx, { level, rivets });

  // ── mirror pass ───────────────────────────────────────────────────────────
  const mirrorHandles = {};
  for (const [id, p] of partDefs) {
    if (p.side !== 'L') continue;
    const srcId = id.replace(/\.L$/, '.R');
    const src = groups.get(srcId), dst = groups.get(id);
    if (!src || !dst) throw new Error(`mirror source/dest missing for ${id}`);
    dst.userData.mirrorOf = srcId;
    builtIds.add(id);
    for (let b = 0; b <= 3 - 1; b++) {
      const srcB = src.children.find((c) => c.name === `b${b}`);
      const dstB = dst.children.find((c) => c.name === `b${b}`);
      if (!srcB.children.length) continue;
      const wrap = new THREE.Group();
      wrap.name = 'mirror';
      wrap.scale.set(1, -1, 1);
      for (const child of srcB.children) {
        const c2 = child.clone(true);
        c2.traverse((o) => {
          if (o.isMesh || o.isInstancedMesh) {
            const sg = o.geometry;
            if (!sg.userData._mirrored) {
              o.geometry = cache.get(`mirrorOf:${sg.name}`, () => {
                const c3 = sg.clone();
                const gi = c3.getIndex();
                if (gi) {
                  const arr = gi.array.slice();
                  for (let i = 0; i < arr.length; i += 3) { const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t; }
                  c3.setIndex(new THREE.BufferAttribute(arr, 1));
                  const nm = c3.getAttribute('normal');
                  if (nm) { for (let i = 0; i < nm.count; i++) nm.setY(i, -nm.getY(i)); nm.needsUpdate = true; }
                }
                c3.userData._mirrored = true;
                return c3;
              });
            } else o.geometry = sg;
            if (o.userData.handle && o.userData.handle.endsWith('R') && o.isGroup) {
              const lh = o.userData.handle.replace(/R$/, 'L');
              if (rigs[lh]) throw new Error(`duplicate rig handle (mirror): ${lh}`);
              rigs[lh] = { node: o, meta: { ...rigs[o.userData.handle]?.meta, mirrored: true }, mirrorOfHandle: o.userData.handle };
            }
          } else if (o.isGroup && o.userData.handle && o.userData.handle.endsWith('R')) {
            const lh = o.userData.handle.replace(/R$/, 'L');
            if (rigs[lh]) throw new Error(`duplicate rig handle (mirror): ${lh}`);
            rigs[lh] = { node: o, meta: { ...rigs[o.userData.handle]?.meta, mirrored: true }, mirrorOfHandle: o.userData.handle };
          }
        });
        if (c2.isGroup && c2.userData.handle && c2.userData.handle.endsWith('R')) {
          const lh = c2.userData.handle.replace(/R$/, 'L');
          if (!rigs[lh]) throw new Error(`mirror handle lost for ${lh}`);
        }
        wrap.add(c2);
      }
      dstB.add(wrap);
    }
  }

  // ── registry completeness: every non-mirror id must be built exactly once ─
  const missing = [];
  for (const [id, p] of partDefs) {
    if (p.side === 'L') continue;
    if (!builtIds.has(id)) missing.push(id);
  }
  if (missing.length) throw new Error(`registry parts not built: ${missing.join(', ')}`);

  // ── static freezing (explode/pivot update matrices explicitly) ────────────
  root.traverse((o) => {
    if (o.isGroup && o.userData.partId) { o.matrixAutoUpdate = false; }
  });

  // ── LOD / bucket visibility ──────────────────────────────────────────────
  let currentLod = 0, currentRivets = rivets;
  function applyVisibility() {
    for (const [id, g] of groups) {
      const def = partDefs.get(id);
      const exists = currentLod <= (def.lod ?? 2);
      g.visible = exists;
      if (!exists) continue;
      const bs = bucketNodes.get(id);
      for (let b = 0; b <= 2; b++) bs[b].visible = b >= currentLod && (b !== 0 || currentRivets);
    }
  }
  function setLod(l) { currentLod = l; applyVisibility(); }
  function setRivets(on) { currentRivets = on; applyVisibility(); }
  const lodPolicy = { thresholds: [14, 34], mode: 'auto' };
  function autoLod(dist) {
    if (lodPolicy.mode !== 'auto') return false;
    const l = dist < lodPolicy.thresholds[0] ? 0 : dist < lodPolicy.thresholds[1] ? 1 : 2;
    if (l !== currentLod) { setLod(l); return true; }
    return false;
  }

  // store groups (optional loadout parts) visibility handled by stores.js via ctx;
  // initial: hide every bucket of optional groups if not assigned — handled in setLoadout by app.

  // ── stats & lifecycle ────────────────────────────────────────────────────
  function counts() {
    let meshes = 0, instanced = 0, trisActive = 0, trisTotal = 0, geoLive = cache.stats().live;
    const visibleChain = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    const seen = new Set();
    root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        const idx = o.geometry.getIndex();
        const per = (idx ? idx.count : o.geometry.getAttribute('position').count) / 3;
        const mult = o.isInstancedMesh ? o.count : 1;
        trisTotal += per * mult;
        if (visibleChain(o)) { meshes++; if (o.isInstancedMesh) instanced++; trisActive += per * mult; }
        seen.add(o.geometry);
      }
    });
    return { meshes, instanced, trisActive: Math.round(trisActive), trisTotal: Math.round(trisTotal), uniqueGeoms: seen.size, geoLive };
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.traverse(() => {});
    for (const m of lineMats.values()) m.dispose();
    lineMats.clear();
    cache.disposeAll();
    matFactory.dispose();
    root.removeFromParent();
  }

  setLod(0);
  if (level >= 1) setRivets(false);
  if (level > 0) setLod(Math.min(2, level));

  const bbox = new THREE.Box3().setFromObject(root);

  return {
    root, groups, partDefs, assemblyRoots, rigs, cache, materials: matFactory, ctx, mirrorHandles,
    bbox, setLod, setRivets, autoLod, lodPolicy, counts, dispose, applyVisibility,
    get lod() { return currentLod; }, get rivetsOn() { return currentRivets; }
  };
}
