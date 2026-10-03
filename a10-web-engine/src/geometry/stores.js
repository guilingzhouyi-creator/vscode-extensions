/**
 * WEAPONS STATIONS & STORES — 11 stations (8 wing + 3 fuselage, doc). One pylon/rail mesh
 * per station (shared geometry via cache), store meshes tagged {group:'stores', kind}.
 * loadout presets (spec/storesSpec.js) toggle visibility — swapping stores never touches
 * geometry or material creation (load/unload logic is pure visibility + parenting).
 */
import * as THREE from 'three';
import { mergeGeometries, box, strut } from './_util.js';
import { REF } from '../spec/referenceDimensions.js';
import { LOADOUTS, STORES } from '../spec/storesSpec.js';
import { chordAt, wingZAt, thicknessAt } from '../spec/wingSpec.js';

const pylonGeoCache = new Map();

function pylonGeo(ctx) {
  if (!pylonGeoCache.has('pylon')) {
    pylonGeoCache.set('pylon', mergeGeometries([
      box([1.30, -0.09, 0.10], [2.05, 0.09, 0.30]),          // fore post
      box([1.35, -0.11, 0.00], [1.95, 0.11, 0.11]),           // upper carry beam
      box([1.50, -0.055, -0.34], [1.98, 0.055, 0.02]),        // store beam
      (() => { const g = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10); g.rotateZ(Math.PI / 2); g.translate(1.28, 0, 0.20); return g; })()
    ]));
  }
  return pylonGeoCache.get('pylon');
}

export function build(ctx) {
  const st = REF.hardpoints.stations;
  const wingYs = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'L5', 'L4', 'L3', 'L2', 'L1']);

  // ── pylons / rails (each station gets its own node; geometry shared) ──────
  const stationNodes = {};
  for (const s of st) {
    const onWing = wingYs.has(s.id);
    const yAbs = Math.abs(s.y);
    const zRoot = onWing ? wingZAt(yAbs) - thicknessAt(yAbs) / 2 - 0.02 : bellyZ();
    const holder = new THREE.Group();
    holder.name = `station:${s.id}`;
    holder.position.set(s.x - 1.32, yAbs * Math.sign(s.y === 0 ? 1 : Math.sign(s.y)), zRoot);
    holder.userData.station = s.id;
    const isRail = s.kind === 'rail';
    const pid = isRail ? 'hp.rail' : 'hp.pylon';
    ctx.mesh(pid, {
      geomKey: isRail ? 'st.rail' : 'st.pylon', mat: 'bareMetal', bucket: 2, name: `pylon-${s.id}`,
      geom: () => {
        if (!isRail) return pylonGeo(ctx);
        return mergeGeometries([
          box([1.35, -0.045, -0.02], [2.32, 0.045, 0.075]),
          box([1.45, -0.10, -0.06], [1.70, 0.10, 0.0]),
          box([2.05, -0.10, -0.06], [2.30, 0.10, 0.0])
        ]);
      }
    });
    // reparent the freshly created pylon mesh into its station holder (local coords)
    const pg = ctx.part(pid);
    const meshes = [];
    pg.traverse((o) => { if (o.isMesh && o.name === `pylon-${s.id}`) meshes.push(o); });
    for (const m of meshes) { m.parent.remove(m); m.position.set(0, 0, 0); holder.add(m); }
    pg.add(holder);
    stationNodes[s.id] = holder;
  }
  ctx.part('hp.pylon'); ctx.part('hp.rail');

  // ── store factory (all geometry keys shared per kind, per-instance transform only) ──
  const storeGeos = {};
  const G = {
    mk82: () => {
      const s = STORES.mk82;
      const body = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, s.len * 0.62, 14);
      body.rotateZ(Math.PI / 2);
      const nose = new THREE.SphereGeometry(s.dia / 2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      nose.rotateZ(-Math.PI / 2);
      nose.translate(-s.len * 0.31 - 0.02, 0, 0);
      const ogv = nose.clone(); ogv.rotateY(0);
      void ogv;
      const tail = box([s.len * 0.31 - 0.02, -0.02, -0.02], [s.len * 0.42, 0.02, 0.02]);
      const fins = [];
      for (let i = 0; i < 4; i++) {
        const f = box([s.len * 0.30, -0.37, -0.006], [s.len * 0.42, 0.37, 0.006]);
        f.rotateX((i * Math.PI) / 2);
        fins.push(f);
      }
      const snake = [];
      for (let i = 0; i < 4; i++) {
        const a = new THREE.CylinderGeometry(s.len * 0.21, s.len * 0.21, 0.01, 3, 1, true);
        a.rotateY(Math.PI / 2);
        a.rotateX((i * Math.PI) / 2);
        a.translate(s.len * 0.36, 0, 0);
        void a;
      }
      void snake;
      return mergeGeometries([body, nose, tail, ...fins]);
    },
    ter: () => mergeGeometries([
      box([-0.10, -0.34, -0.12], [0.12, 0.34, 0.02]),
      box([-0.06, -0.30, -0.30], [0.02, -0.26, -0.12]),
      box([-0.06, 0.26, -0.30], [0.02, 0.30, -0.12])
    ]),
    aim9: () => {
      const s = STORES.aim9;
      const b = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, s.len, 12);
      b.rotateZ(Math.PI / 2);
      b.translate(0, 0, 0);
      const cap = new THREE.SphereGeometry(s.dia / 2, 10, 6);
      cap.translate(-s.len / 2, 0, 0);
      const fins = [];
      for (let i = 0; i < 4; i++) {
        const f = box([s.len * 0.14, -s.fin / 2, -0.004], [s.len * 0.30, s.fin / 2, 0.004]);
        f.rotateX(i * Math.PI / 2);
        f.translate(s.len * 0.32, 0, 0);
        fins.push(f);
      }
      return mergeGeometries([b, cap, ...fins]);
    },
    pod: () => {
      const s = STORES.rocketPod;
      const tube = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, s.len, 16);
      tube.rotateZ(Math.PI / 2);
      const nose = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, 0.05, 16);
      nose.rotateZ(Math.PI / 2); nose.translate(-s.len / 2 - 0.025, 0, 0);
      return mergeGeometries([tube, nose]);
    },
    alq: () => {
      const s = STORES.alqPod;
      const b = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, s.len * 0.8, 16);
      b.rotateZ(Math.PI / 2);
      const fin = box([-s.len * 0.46, -0.01, s.dia / 2 - 0.02], [-s.len * 0.3, 0.01, s.dia / 2 + 0.24]);
      const nose = new THREE.ConeGeometry(s.dia / 2, s.len * 0.2, 16);
      nose.rotateZ(Math.PI / 2); nose.translate(-s.len / 2 - s.len * 0.1, 0, 0);
      return mergeGeometries([b, fin, nose]);
    },
    litening: () => {
      const s = STORES.liteningPod;
      const b = box([-s.len / 2, -s.dia / 2, -s.dia / 2], [s.len / 2, s.dia / 2, s.dia / 2 * 0.9]);
      const gimbal = new THREE.CylinderGeometry(0.115, 0.115, 0.12, 14);
      gimbal.rotateZ(Math.PI / 2); gimbal.translate(-s.len / 2 - 0.04, 0, -0.04);
      return mergeGeometries([b, gimbal]);
    },
    maverick: () => {
      const s = STORES.maverick;
      const b = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, s.len, 12);
      b.rotateZ(Math.PI / 2);
      const nose = new THREE.ConeGeometry(s.dia / 2, 0.32, 12);
      nose.rotateZ(Math.PI / 2); nose.translate(-s.len / 2 - 0.16, 0, 0);
      const wings = [];
      for (const sy of [-1, 1]) {
        const w = box([-0.18, 0, -0.006], [0.30, sy * s.wing / 2, 0.006]);
        w.translate(0.3, 0, sy * 0.001);
        wings.push(w);
      }
      for (let i = 0; i < 4; i++) {
        const f = box([-s.len * 0.42, -0.14, -0.005], [-s.len * 0.30, 0.14, 0.005]);
        f.rotateX(i * Math.PI / 2);
        f.translate(-s.len * 0.36, 0, 0);
        wings.push(f);
      }
      return mergeGeometries([b, nose, ...wings]);
    },
    tank: () => {
      const s = STORES.tank600;
      const b = new THREE.CylinderGeometry(s.dia / 2, s.dia / 2, s.len * 0.82, 16);
      b.rotateZ(Math.PI / 2);
      const n1 = new THREE.SphereGeometry(s.dia / 2, 12, 8);
      n1.scale(0.6, 1, 1); n1.translate(-s.len * 0.45, 0, 0);
      const n2 = n1.clone(); n2.translate(s.len * 0.9, 0, 0);
      return mergeGeometries([b, n1, n2]);
    }
  };
  storeGeos.mk82 = 'st.mk82'; storeGeos.ter = 'st.ter'; storeGeos.aim9 = 'st.aim9';
  storeGeos.pod = 'st.pod'; storeGeos.alq = 'st.alq'; storeGeos.litening = 'st.litening';
  storeGeos.maverick = 'st.maverick'; storeGeos.tank = 'st.tank';

  // per-kind parent part ids (registry contract)
  const KIND_PART = { mk82: 'hp.store.mk82', ter: 'hp.store.ter', aim9: 'hp.store.aim9', pod: 'hp.store.rocket-pod', alq: 'hp.store.alq131', litening: 'hp.store.litening', maverick: 'hp.store.maverick', tank: 'hp.store.tank600' };
  const HANG = { mk82: 0.50, ter: 0.0, aim9: 0.13, pod: 0.53, alq: 0.57, litening: 0.45, maverick: 0.50, tank: 0.72 };

  function addStore(kind, stationId, offset = [0, 0, 0]) {
    const holder = stationNodes[stationId];
    if (!holder) return null;
    const pid = KIND_PART[kind];
    ctx.part(pid);
    const mesh = ctx.mesh(pid, {
      bucket: 2,
      geomKey: storeGeos[kind] || `st.${kind}`,
      mat: kind === 'mk82' ? 'OrdnanceGreen' : kind === 'aim9' || kind === 'maverick' ? 'missileWhite' : 'podGrey',
      name: `store:${stationId}:${kind}`,
      geom: () => G[kind] ? G[kind]() : box([-0.4, -0.1, -0.1], [0.4, 0.1, 0.1])
    });
    // station-local placement: hang from pylon store beam (local z ≈ −0.34) / rail (z ≈ 0)
    const stDef = st.find((q) => q.id === stationId);
    const isRail = stDef.kind === 'rail';
    const R_HANG = { mk82: 0.37, ter: 0.12, aim9: 0.20, pod: 0.19, alq: 0.235, litening: 0.16, maverick: 0.27, tank: 0.385 }; // includes tailfin radius
    const x0 = kind === 'aim9' ? 1.84 : 1.55;
    let z0 = (isRail ? 0.01 : -0.355) - HANG[kind] * (isRail ? 0.28 : 1);
    // all stations: guarantee ground clearance (store bottom ≥ +0.14 m — the loaded
    // A-10 sits on its gear, big bombs just kiss the tarmac, doc photos; never below)
    const absZ = holder.position.z + z0;
    const minAbs = 0.14 + R_HANG[kind];
    if (absZ < minAbs) z0 = minAbs - holder.position.z;
    mesh.position.set(x0 + offset[0], offset[1], z0 + offset[2]);
    mesh.userData.loadoutKind = kind;
    mesh.userData.station = stationId;
    mesh.visible = false;
    holder.add(mesh);
    return mesh;
  }

  // build the full catalogue at each station (config decides which becomes visible)
  const catalog = new Map(); // `${station}:${kind}` -> mesh
  for (const s of st) {
    const dual = (s.kind === 'pylon' && !s.id.startsWith('F'));
    catalog.set(`${s.id}:mk82pair`, [
      addStore('mk82', s.id, [0, dual ? -0.28 : 0, 0], 'mk82'),
      addStore('mk82', s.id, [0, dual ? 0.28 : 0, 0], 'mk82')
    ].filter(Boolean));
    catalog.set(`${s.id}:mk82`, [addStore('mk82', s.id, [0, 0, 0], 'mk82')].filter(Boolean));
    catalog.set(`${s.id}:maverick2`, [
      addStore('maverick', s.id, [0, -0.26, 0], 'maverick'),
      addStore('maverick', s.id, [0, 0.26, 0], 'maverick')
    ].filter(Boolean));
    catalog.set(`${s.id}:aim9`, [addStore('aim9', s.id, [0, s.id.startsWith('L') ? -0.06 : 0.06, 0.05], 'aim9')].filter(Boolean));
    catalog.set(`${s.id}:rocketpod`, [addStore('pod', s.id, [0, 0, 0], 'pod')].filter(Boolean));
    catalog.set(`${s.id}:alq131`, [addStore('alq', s.id, [0, 0, 0], 'alq')].filter(Boolean));
    catalog.set(`${s.id}:litening`, [addStore('litening', s.id, [0, 0, 0], 'litening')].filter(Boolean));
    if (s.kind === 'centerline') catalog.set(`${s.id}:fuelTank600`, [addStore('tank', s.id, [0, 0, -0.16], 'tank')].filter(Boolean));
    if (dual) {
      const ter = addStore('ter', s.id, [0, 0, 0.06], 'ter');
      if (ter) ter.userData.loadoutKind = 'ter';
      catalog.set(`${s.id}:ter`, [ter].filter(Boolean));
    }
  }
  ctx.part('hp.store.mk82'); ctx.part('hp.store.ter'); ctx.part('hp.store.aim9');
  ctx.part('hp.store.rocket-pod'); ctx.part('hp.store.alq131'); ctx.part('hp.store.litening'); ctx.part('hp.store.maverick');

  /** apply a preset; unknown keys ignored; returns applied station count */
  function applyLoadout(preset) {
    const L = LOADOUTS[preset] || LOADOUTS.cas;
    let n = 0;
    for (const [sid, kind] of Object.entries(L.stations)) {
      if (!kind) continue;
      const arr = catalog.get(`${sid}:${kind}`);
      if (!arr) continue;
      for (const m of arr) { m.visible = true; n++; }
    }
    return n;
  }
  function clearLoadout() {
    for (const arr of catalog.values()) for (const m of arr) if (m && m.isMesh) m.visible = false;
  }

  ctx.loadout = { applyLoadout, clearLoadout, catalog, stations: stationNodes };

  void strut; void box;
}
/** belly height under wing box (fuselage frames are ~flat there; der from FUSELAGE_FRAMES) */
function bellyZ() {
  return 0.66;
}
