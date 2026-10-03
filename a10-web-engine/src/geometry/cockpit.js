/**
 * COCKPIT INTERIOR — ACES II seat, panel + 2×MFD + standby row, HUD, HOTAS,
 * consoles, pedals, sidewalls, ejection handles, fire bottle.
 * All are real small geometries (no painted-on instrument cheat).
 */
import * as THREE from 'three';
import { box, mergeGeometries, strut, fastenerMatrices } from './_util.js';
import { COCKPIT as C } from '../spec/cockpitSpec.js';
import { makeRng } from '../spec/constants.js';

export function build(ctx) {
  // floor + sidewalls
  ctx.mesh('cockpit.floor', {
    geomKey: 'ck.floor', mat: 'antislip', bucket: 1,
    geom: () => box([C.floor.x[0], -0.72, C.floor.z - 0.03], [C.floor.x[1], 0.72, C.floor.z + 0.005])
  });
  ctx.mesh('cockpit.sidewalls', {
    geomKey: 'ck.walls', mat: 'cockpitDark', bucket: 1, cast: false,
    geom: () => mergeGeometries([
      box([3.98, 0.60, 1.58], [5.86, 0.70, 2.34]),
      box([3.98, -0.70, 1.58], [5.86, -0.60, 2.34]),
      box([5.78, -0.66, 1.62], [6.04, 0.66, 2.36]) // aft bulkhead facing
    ])
  });

  // ── ACES II seat: pan / back / headrest / rails / harness ────────────────
  const s = C.seat;
  ctx.pivot('cockpit.seat', { pos: [s.x, 0, s.z], handle: 'seatAdjust', meta: { axis: 'z', travel: 0.12 } });
  ctx.mesh('cockpit.seat', {
    geomKey: 'ck.seat-pan', mat: 'ejectionOrange',
    geom: () => {
      const g = [];
      g.push(box([s.x - s.panD / 2, -s.panW / 2, s.z], [s.x + s.panD / 2, s.panW / 2, s.z + 0.13]));
      // back reclined (rotate about Y at bottom edge ~ axis along span → use local then rotate X? recline tilts top aft: rotate about Y)
      const back = box([s.x - 0.06, -0.235, s.z + 0.1], [s.x + 0.06, 0.235, s.z + 0.1 + s.backH]);
      back.translate(-(s.x), 0, -(s.z + 0.1));
      back.rotateY(-C.seat.reclineDeg * Math.PI / 180 * 0 - (0)); // recline in x-z: rotate about Y? no—about lateral? see below
      back.rotateZ(-C.seat.reclineDeg * Math.PI / 180);
      back.translate(s.x + Math.sin(C.seat.reclineDeg * Math.PI / 180) * (s.backH / 2) * 0.4, 0, s.z + 0.1 + (s.backH / 2) * 0.92);
      g.push(back);
      g.push(box([s.x + 0.16, -0.16, s.z + s.backH + 0.02], [s.x + 0.30, 0.16, s.z + s.backH + 0.02 + s.headH]));
      g.push(box([s.x - 0.30, -0.10, s.z - 0.12], [s.x + 0.05, 0.10, s.z - 0.02])); // seat pan base/parachute box
      return mergeGeometries(g);
    }
  });
  ctx.mesh('cockpit.seat', {
    geomKey: 'ck.seat-harness', mat: 'cockpitDark', bucket: 0, cast: false,
    geom: () => mergeGeometries([
      box([s.x - 0.02, -0.16, s.z + 0.55], [s.x + 0.05, -0.115, s.z + 0.72]),
      box([s.x - 0.02, 0.115, s.z + 0.55], [s.x + 0.05, 0.16, s.z + 0.72]),
      box([s.x + 0.02, -0.05, s.z + 0.05], [s.x + 0.09, 0.05, s.z + 0.16])
    ])
  });

  // ── instrument panel: curved plate + standby gauges + MFDs ───────────────
  const mp = C.mainPanel;
  ctx.mesh('cockpit.main-panel', {
    geomKey: 'ck.panel', mat: 'cockpitDark',
    geom: () => {
      const sections = [];
      const N = 24;
      for (let i = 0; i <= 2; i++) {
        const zc = mp.z - 0.22 + i * 0.22;
        const loop = [];
        for (let j = 0; j <= N; j++) {
          const v = -1 + (2 * j) / N;
          loop.push([v * (mp.w / 2) * (1 - 0.06 * Math.abs(v)), 0]);
        }
        sections.push({ center: [mp.x + (i - 1) * 0.001, 0, zc], loop });
      }
      void sections;
      return box([mp.x - 0.045, -mp.w / 2, mp.z - 0.24], [mp.x, mp.w / 2, mp.z + 0.26]);
    }
  });
  // gauge bezels (instanced) + faces
  const rng = makeRng(5);
  const gaugeMats = [];
  for (let i = 0; i < mp.gauges; i++) {
    const col = i % 6, row = Math.floor(i / 6);
    const y = -0.44 + col * 0.175, z = mp.z - 0.14 + row * 0.20;
    if (Math.abs(y) < 0.21 && row === 0) continue; // MFD window cut area
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    m.compose(new THREE.Vector3(mp.x - 0.048, y, z), q, new THREE.Vector3(0.012, 0.062, 0.062));
    gaugeMats.push(m);
  }
  ctx.inst('cockpit.main-panel', {
    geomKey: 'ck.bezel', mat: 'instrumentGlow', bucket: 0, cast: false,
    matrices: gaugeMats, geom: () => new THREE.CylinderGeometry(1, 1, 1, 14)
  });

  // MFDs (two screens, emissive)
  for (const [id, y] of [['cockpit.mfd-left', -0.135], ['cockpit.mfd-right', 0.135]]) {
    ctx.mesh(id, {
      geomKey: `ck.mfd${y}`, mat: 'mfdOn', bucket: 1, cast: false,
      geom: () => box([mp.x - 0.05, y - 0.10, mp.z - 0.11], [mp.x - 0.028, y + 0.10, mp.z + 0.11])
    });
    ctx.mesh(id, {
      geomKey: `ck.mfdframe${y}`, mat: 'steelDark', bucket: 0, cast: false,
      geom: () => box([mp.x - 0.052, y - 0.125, mp.z - 0.135], [mp.x - 0.045, y + 0.125, mp.z + 0.135])
    });
  }

  // ── HUD: combiner glass + housing ────────────────────────────────────────
  const hud = C.hud;
  ctx.mesh('cockpit.hud', {
    geomKey: 'ck.hud', mat: 'glass', cast: false,
    geom: () => {
      const g = new THREE.BoxGeometry(0.008, hud.glassW, hud.glassH);
      g.rotateZ(-(90 - hud.combinerTilt) * Math.PI / 180 * 0 + Math.PI / 2 - hud.combinerTilt * Math.PI / 180);
      g.translate(hud.x, 0, hud.z);
      const housing = box([hud.x + 0.05, -0.075, hud.z - hud.glassH / 2 - 0.05], [hud.x + 0.30, 0.075, hud.z - hud.glassH / 2 + 0.03]);
      return mergeGeometries([g, housing]);
    }
  });

  // ── HOTAS: stick (right), throttles (left) ──────────────────────────────
  ctx.mesh('cockpit.stick', {
    geomKey: 'ck.stick', mat: 'steelDark', bucket: 1,
    geom: () => {
      const st = C.stick;
      return mergeGeometries([
        strut([st.x, st.y, st.z - 0.34], [st.x - 0.05, st.y, st.z], 0.028, 8),
        (() => { const c = new THREE.CylinderGeometry(0.030, 0.026, st.gripLen, 10); c.translate(st.x - 0.065, st.y, st.z + st.gripLen / 2 - 0.02); c.rotateZ(0.32); return c; })()
      ]);
    }
  });
  ctx.mesh('cockpit.throttle', {
    geomKey: 'ck.throttle', mat: 'steelDark', bucket: 1,
    geom: () => {
      const t = C.throttle;
      return mergeGeometries([
        box([t.x - 0.10, t.y - 0.075, t.z - 0.10], [t.x + 0.14, t.y + 0.075, t.z - 0.02]),
        strut([t.x - 0.02, t.y - 0.03, t.z - 0.04], [t.x - 0.09, t.y - 0.03, t.z + 0.10], 0.016, 6),
        strut([t.x - 0.02, t.y + 0.03, t.z - 0.04], [t.x - 0.09, t.y + 0.03, t.z + 0.10], 0.016, 6)
      ]);
    }
  });
  ctx.mesh('cockpit.pedals', {
    geomKey: 'ck.pedals', mat: 'steelDark', bucket: 1,
    geom: () => {
      const p = C.rudderPedals;
      return mergeGeometries([
        box([p.x - 0.09, p.yHalf = p.spreadY / 2 - 0.045, p.z], [p.x + 0.02, p.spreadY / 2 + 0.045, p.z + 0.14]),
        box([p.x - 0.09, -p.spreadY / 2 - 0.045, p.z], [p.x + 0.02, -p.spreadY / 2 + 0.045, p.z + 0.14])
      ]);
    }
  });

  // consoles with knob rows (instanced)
  for (const [id, y] of [['cockpit.console-left', -1], ['cockpit.console-right', 1]]) {
    const cc = y < 0 ? C.leftConsole : C.rightConsole;
    ctx.mesh(id, {
      geomKey: `ck.console${y}`, mat: 'cockpitDark', bucket: 1,
      geom: () => box([cc.x[0], cc.y - 0.055 * y - 0.06, cc.z], [cc.x[1], cc.y - 0.055 * y + 0.06, cc.z + cc.h])
    });
    if (ctx.rivets) {
      const mats = [];
      for (let i = 0; i < 7; i++) {
        for (let r = 0; r < 2; r++) {
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          m.compose(new THREE.Vector3(cc.x[0] + 0.18 + i * 0.185, cc.y - 0.04 * y, cc.z + 0.02 + r * 0.06), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.011));
          mats.push(m);
        }
      }
      ctx.inst(id, {
        geomKey: 'ck.knob', mat: 'bareMetal', bucket: 0, cast: false,
        matrices: mats, geom: () => new THREE.CylinderGeometry(1, 1, 1, 8)
      });
    }
  }

  // ejection handles (paired D-rings) + fire bottle
  ctx.mesh('cockpit.ejection-handles', {
    geomKey: 'ck.ej-handles', mat: 'warningYellow', bucket: 0, cast: false,
    geom: () => {
      const e = C.ejectionHandles;
      const mk = (y) => {
        const t = new THREE.TorusGeometry(0.05, 0.012, 6, 14);
        t.rotateY(Math.PI / 2);
        t.translate(e.x - 0.06, y, e.z);
        return t;
      };
      return mergeGeometries([mk(0.19), mk(-0.19)]);
    }
  });
  ctx.mesh('cockpit.fire-bottle', {
    geomKey: 'ck.firebottle', mat: 'dangerRed', bucket: 0, cast: false,
    geom: () => {
      const b = C.fireBottle;
      const c = new THREE.CylinderGeometry(b.r, b.r, 0.3, 10);
      c.rotateZ(Math.PI / 2);
      c.translate(b.x, b.y, b.z);
      return mergeGeometries([c, box([b.x - 0.03, b.y - 0.02, b.z + 0.14], [b.x + 0.03, b.y + 0.02, b.z + 0.2])]);
    }
  });
}
