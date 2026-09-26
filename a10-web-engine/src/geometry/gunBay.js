/**
 * GAU-8/A AVENGER installation — fuselage designed around the gun (doc).
 *  • gun axis offset left so the FIRING barrel traces the aircraft centerline (doc)
 *  • 7-barrel bundle instanced; carrier ring is the spin pivot (rig: gunSpin)
 *  • linkless double-ended feed from the transverse drum; 1,174 rounds (doc) as an
 *    instanced helical coil inside a real drum shell
 *  • twin hydraulic motors on the receiver (doc)
 */
import * as THREE from 'three';
import { box, mergeGeometries, strut, loftLoops, fastenerMatrices } from './_util.js';
import { GUN, drumRoundTransform } from '../spec/gunSpec.js';
import { frameAt, framePoint, insetFrame } from '../math/profiles.js';
import { FUSELAGE_FRAMES } from '../spec/fuselageSpec.js';
import { makeRng } from '../spec/constants.js';

const FR = FUSELAGE_FRAMES;

/** unit axis: gun axis direction (muzzle → receiver), pitched slightly up aft */
const AX = new THREE.Vector3(...GUN.receiverEnd).sub(new THREE.Vector3(...GUN.muzzle)).normalize();
const Q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), AX);
const MUZZLE = new THREE.Vector3(...GUN.muzzle);

/** local (along-axis s, radial offset [ry,rz]) → aircraft point; bundle roll puts firing barrel down */
function gunPoint(s, ry = 0, rz = 0, roll = 0) {
  const a = new THREE.Vector3(rz, ry, 0).applyAxisAngle(AX, roll);
  return MUZZLE.clone().addScaledVector(AX, s).add(a);
}

export function build(ctx) {
  const rng = makeRng(31);
  const L = MUZZLE.distanceTo(new THREE.Vector3(...GUN.receiverEnd));

  // ── barrels: 1 geometry + 7 instances, rotating with carrier ────────────
  const carrier = ctx.pivot('gun.carrier', {
    pos: gunPoint(GUN.barrelLen * 0.98).toArray(),
    handle: 'gunSpin', meta: { axis: 'axis', axisVec: AX.toArray(), note: 'carrier rotates 7 barrels (rig)' }
  });
  const bLen = GUN.barrelLen;
  const barrelGeo = (() => {
    const g = new THREE.CylinderGeometry(0.0215, 0.0245, bLen, 9, 1, false);
    g.rotateX(Math.PI / 2);
    return g;
  })();
  const mats = [];
  for (let i = 0; i < GUN.barrels; i++) {
    const ang = (i / GUN.barrels) * Math.PI * 2;
    const off = new THREE.Vector3(0, GUN.bundleRadius * Math.cos(ang), GUN.bundleRadius * Math.sin(ang));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), AX);
    const start = MUZZLE.clone().add(off);
    const end = start.clone().addScaledVector(AX, bLen);
    m.compose(start.clone().add(end).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    mats.push(m);
  }
  ctx.inst('gun.barrels', {
    geomKey: 'gun.barrel-unit', mat: 'gunmetal', bucket: 2, pivot: carrier,
    matrices: mats, geom: () => barrelGeo
  });
  // muzzle flash cones on each barrel (small geometry, cheap)
  ctx.inst('gun.barrels', {
    geomKey: 'gun.muzzle-cone', mat: 'steelDark', bucket: 1, pivot: carrier,
    matrices: mats.map((mm) => {
      const c = new THREE.Vector3();
      c.setFromMatrixPosition(mm);
      const n = new THREE.Vector3(0, 0, -1).transformDirection(mm).multiplyScalar(bLen / 2);
      const m = new THREE.Matrix4();
      m.compose(c.add(n), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), AX.clone().multiplyScalar(-1)), new THREE.Vector3(0.15, 0.42, 0.15));
      return m;
    }),
    geom: () => { const g = new THREE.ConeGeometry(1, 1, 10, 1, true); g.translate(0, 0.5, 0); return g; }
  });

  // ── carrier ring + trunnion housing ──────────────────────────────────────
  ctx.mesh('gun.carrier', {
    geomKey: 'gun.carrier-ring', mat: 'steelDark', bucket: 1, pivot: carrier, cast: true,
    geom: () => {
      const outer = (t) => [0.30 * Math.cos(t * Math.PI * 2), 0.30 * Math.sin(t * Math.PI * 2)];
      const inner = (t) => [0.265 * Math.cos(t * Math.PI * 2), 0.265 * Math.sin(t * Math.PI * 2)];
      const g = new THREE.Group(); void g;
      const rg = loftLoops([
        { center: [0, 0, -0.06], loop: ringLoop(outer) }, { center: [0, 0, -0.06], loop: ringLoop(inner) },
        { center: [0, 0, 0.14], loop: ringLoop(inner) }, { center: [0, 0, 0.14], loop: ringLoop(outer) },
        { center: [0, 0, -0.06], loop: ringLoop(outer) }
      ]);
      rg.applyQuaternion(Q);
      rg.translate(gunPoint(bLen * 1.02).x, gunPoint(bLen * 1.02).y, gunPoint(bLen * 1.02).z);
      return rg;
    }
  });

  // ── receiver + feed housing (real blocky housings along the axis) ─────────
  ctx.mesh('gun.receiver', {
    geomKey: 'gun.receiver', mat: 'gunmetal', bucket: 1,
    geom: () => {
      const geos = [];
      const seg = (s0, s1, w, h) => {
        const c0 = gunPoint((s0 + s1) / 2);
        const g2 = box([- (s1 - s0) / 2, -w, -h], [(s1 - s0) / 2, w, h]);
        g2.applyQuaternion(Q);
        g2.translate(c0.x, c0.y, c0.z);
        return g2;
      };
      geos.push(seg(bLen * 0.98, bLen + 1.05, 0.245, 0.215));      // main receiver
      geos.push(seg(bLen + 0.85, bLen + 1.62, 0.27, 0.255));       // feed housing
      geos.push(seg(bLen - 0.25, bLen * 0.99, 0.24, 0.16));        // barrel shroud band
      return mergeGeometries(geos);
    }
  });

  // ── twin hydraulic motors above receiver (doc) ──────────────────────────
  const mkMotor = (yOff, id) => ctx.mesh(id, {
    geomKey: `gun.motor${yOff}`, mat: 'steelDark', bucket: 1,
    geom: () => {
      const c = new THREE.CylinderGeometry(GUN.motor.r, GUN.motor.r, GUN.motor.len, 14);
      c.rotateX(Math.PI / 2);
      const p = gunPoint(bLen + 0.55, yOff, 0.36);
      c.applyQuaternion(Q); c.translate(p.x, p.y, p.z);
      return c;
    }
  });
  mkMotor(-0.10, 'gun.motor-left');
  mkMotor(0.10, 'gun.motor-right');

  // ── linkless feed chutes: top live-feed + lower case-return ─────────────
  for (const [id, zSign] of [['gun.feed-upper', 1], ['gun.feed-lower', -1]]) {
    ctx.mesh(id, {
      geomKey: id, mat: 'bareMetal', bucket: 1, cast: false,
      geom: () => {
        const geos = [];
        const s0 = bLen + 1.35, s1 = bLen + 2.05;
        const pts = 9;
        let prev = null;
        for (let i = 0; i <= pts; i++) {
          const t = i / pts;
          const s = s0 + (GUN.drum.x - GUN.muzzle[0] - 0.2 - s0) * t;
          const zc = zSign * (0.34 + 0.14 * Math.sin(t * Math.PI));
          const p = gunPoint(s, GUN.drum.y ? 0.0 : 0.0, zc, 0);
          // re-aim into drum space (drum sits in aircraft axes, not on gun axis)
          const dz = zSign;
          const ap = new THREE.Vector3(GUN.muzzle[0] + s, GUN.feed[id === 'gun.feed-upper' ? 'chuteTopY' : 'chuteBottomY'] * 0.6, GUN.drum.z + dz * 0.28).lerp(p, 0.55);
          if (prev) geos.push(strut(prev, [ap.x, ap.y, ap.z], 0.075, 7));
          prev = [ap.x, ap.y, ap.z];
        }
        const c = new THREE.CylinderGeometry(0.075, 0.075, 0.22, 8);
        c.rotateY(Math.PI / 2);
        const end = gunPoint(s1, 0, zSign * 0.2);
        c.translate(end.x, end.y, end.z);
        geos.push(c);
        return mergeGeometries(geos);
      }
    });
  }

  // ── ammunition drum (transverse axis = aircraft Y) ──────────────────────
  const D = GUN.drum;
  ctx.mesh('gun.drum', {
    geomKey: 'gun.drum-shell', mat: 'structurePrimer', bucket: 2,
    geom: () => {
      const body = new THREE.CylinderGeometry(D.outerR, D.outerR, D.len, 26, 1, true);
      body.rotateZ(Math.PI / 2);
      body.translate(D.x, 0, D.z);
      // caps built at origin, then oriented + translated into absolute position (order matters!)
      const capL = new THREE.CircleGeometry(D.outerR, 26);
      capL.rotateY(-Math.PI / 2);
      capL.translate(D.x, -D.len / 2, D.z);
      const capR = new THREE.CircleGeometry(D.outerR, 26);
      capR.rotateY(Math.PI / 2);
      capR.translate(D.x, D.len / 2, D.z);
      // hub ring + spiral retainers (thin tori)
      const ribs = [];
      for (let i = 0; i < 4; i++) {
        const t = new THREE.TorusGeometry(D.outerR + 0.008, 0.016, 5, 26);
        t.rotateY(Math.PI / 2);
        t.translate(D.x, -D.len / 2 + (i + 0.5) * (D.len / 4), D.z);
        ribs.push(t);
      }
      return mergeGeometries([body, capL, capR, ...ribs]);
    }
  });
  ctx.mesh('gun.drum', {
    geomKey: 'gun.drum-core', mat: 'bareMetal', bucket: 1, cast: false,
    geom: () => {
      const g = new THREE.CylinderGeometry(0.30, 0.30, D.len * 0.96, 18);
      g.rotateZ(Math.PI / 2);
      g.translate(D.x, 0, D.z);
      return g;
    }
  });
  // rounds: instanced helix (1,174 — doc typical load). Geometry: case + ogive merged once.
  const roundGeo = (() => {
    const cs = new THREE.CylinderGeometry(0.0215, 0.0225, 0.245, 7);
    const og = new THREE.CylinderGeometry(0.004, 0.0215, 0.075, 7);
    og.translate(0, 0.16, 0);
    return mergeGeometries([cs, og]);
  })();
  const ROUNDS = ctx.rivets ? D.rounds : Math.round(D.rounds / 3);
  const gen = drumRoundTransform(ROUNDS);
  const rMats = [];
  const qRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  for (let i = 0; i < ROUNDS; i++) {
    const { y, a, r } = gen(i);
    const pos = new THREE.Vector3(D.x + Math.cos(a) * r * 0.0 + 0.14, y, D.z + Math.sin(a) * 0 + 0);
    // rounds lie along drum axis; ring around core at radius r: center plane = x-z
    const px = D.x + Math.sin(a) * 0, py = y, pz = 0;
    const off = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0);
    const p2 = new THREE.Vector3(D.x + off.x, py, D.z + off.z);
    const m = new THREE.Matrix4();
    const q2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a), 0.18 * (i % 2 ? 1 : -1), -Math.cos(a)));
    void pos; void px; void pz; void qRot;
    m.compose(p2, q2, new THREE.Vector3(1, 1, 1));
    rMats.push(m);
  }
  ctx.inst('gun.drum-rounds', {
    geomKey: 'gun.round-unit', mat: 'brass', bucket: 0, cast: false,
    matrices: rMats, geom: () => roundGeo
  });

  // ── mount rails + cradle ──────────────────────────────────────────────────
  ctx.mesh('gun.mount', {
    geomKey: 'gun.mount', mat: 'interiorStructure', bucket: 1,
    geom: () => {
      const geos = [];
      const x0 = 2.35, x1 = 4.55;
      for (const dy of [-0.30, 0.30]) {
        geos.push(box([x0, dy - 0.05, 0.985], [x1, dy + 0.05, 1.045]));
        for (let x = x0 + 0.25; x < x1; x += 0.5) geos.push(box([x, dy - 0.02, 1.045], [x + 0.05, dy + 0.02, 1.18]));
      }
      geos.push(box([x0 + 0.1, -0.36, 0.955], [x1 - 0.1, 0.36, 0.985])); // cradle plate
      return mergeGeometries(geos);
    }
  });
  // empty-link ejector chute down-aft
  ctx.mesh('gun.feed-lower', {
    geomKey: 'gun.link-chute', mat: 'bareMetal', bucket: 1, cast: false,
    geom: () => strut([4.9, -0.18, 1.02], [5.55, -0.30, 0.78], 0.06, 8)
  });

  // ── gun bay walls (belly cavity behind removable doors) ───────────────────
  ctx.mesh('bays.gun-bay', {
    geomKey: 'bay.gun-walls', mat: 'bayInterior', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      for (let x = 2.3; x < 6.4; x += 0.45) {
        const fr = frameAt(FR, x);
        const f2 = insetFrame(fr, 0.045, 0.045);
        const [ly, lz] = framePoint(f2, 0.62), [ry, rz] = framePoint(f2, 0.88);
        geos.push(strut([x, ly, lz - 0.06], [x, ry, rz - 0.06], 0.018, 6));
      }
      geos.push(box([2.3, -0.66, 1.06], [6.4, 0.66, 1.085])); // shelf under gun
      return mergeGeometries(geos);
    }
  });

  // belly doors (2 panels hinged outboard, with fastener fields) — bucket 1
  const doorHingeX = [1.95, 3.15];
  const doorR = ctx.pivot('gun.bay-doors', { pos: [3.10, 0.64, 0.645], handle: 'gunBayDoorR', meta: { axis: 'x', limitDeg: 46 }, bucket: 1 });
  const doorL = ctx.pivot('gun.bay-doors', { pos: [3.10, -0.64, 0.645], handle: 'gunBayDoorL', meta: { axis: 'x', limitDeg: 46 }, bucket: 1 });
  for (const [side, pv] of [[1, doorR], [-1, doorL]]) {
    ctx.mesh('gun.bay-doors', {
      geomKey: `gun.bay-door${side}`, mat: 'airframeBot', bucket: 1, pivot: pv,
      geom: () => mergeGeometries(doorHingeX.map((x0) => box([x0, side === 1 ? 0.02 : -0.66, 0.615], [x0 + 1.15, side === 1 ? 0.66 : -0.02, 0.665])))
    });
  }
  if (ctx.rivets) {
    const dp = [];
    for (const x0 of doorHingeX) for (const y of [-0.6, 0.6]) dp.push([[x0 + 0.05, y, 0.668], [x0 + 1.1, y, 0.668]]);
    ctx.inst('gun.bay-doors', {
      geomKey: 'fastener.head', mat: 'bareMetal', bucket: 0, cast: false,
      matrices: fastenerMatrices(dp, { pitch: 0.075, r: 0.005, h: 0.004, rng }),
      geom: () => new THREE.CylinderGeometry(1, 0.7, 1, 6)
    });
  }
}

function ringLoop(fn) {
  const p = [];
  for (let j = 0; j < 22; j++) p.push(fn(j / 22));
  return p;
}
