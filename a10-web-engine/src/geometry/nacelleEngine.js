/**
 * NACELLE + TF34-GE-100 — starboard built, mirrored.
 *  • cowl: superellipse loft (D inlet → circular exhaust), split upper/lower + real
 *    clamshell access doors on aft-lower hinge (rig)
 *  • inlet: D-lip + lofted duct + fan/core splitter
 *  • engine: fan 24 blades (instanced), 14-stage HP shown as 5 bands, annular combustor
 *    with 18 injectors (instanced), 2-stg HPT + 4-stg LPT bladed discs, cone + plug,
 *    AGB/starter/pump pack, mount cradle with 4 bolts (doc)
 * Nacelle centre: y=1.60, z=2.02 (der from front view), exhaust canted +3° (IR masking).
 */
import * as THREE from 'three';
import { loftLoops, mergeGeometries, box, strut, ringBand, fastenerMatrices } from './_util.js';
import { REF } from '../spec/referenceDimensions.js';
import { ENGINE_AXIS, NACELLE } from '../spec/engineSpec.js';
import { roundedRectLoop } from '../math/profiles.js';
import { makeRng, rad, clamp } from '../spec/constants.js';

const N = REF.nacelle;
const AXZ = N.centerZ, AXY = N.centerY;
const THRUST_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -rad(N.exhaustRiseDeg));

/** profile pair: superellipse with boxier lower flank (D inlet forward, round aft) */
function cowlLoop(t01, u) {
  // u: 0..1 nacelle axial fraction; t01: 0..1 perimeter
  const n = 26, pts = [];
  const w = lerp(1.30, 1.16, u), hU = lerp(0.63, 0.60, u), hL = lerp(0.58, 0.60, u);
  const eU = lerp(1.75, 2.1, u), eL = lerp(2.4, 2.05, u);
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const up = s >= 0;
    const y = Math.pow(Math.abs(c), 2 / (up ? 2.15 : 2.3)) * w * (c < 0 ? -1 : 1);
    const z = Math.pow(Math.abs(s), 2 / (up ? eU : eL)) * (up ? hU : hL) * (up ? 1 : -1);
    void t01;
    pts.push([y, z]);
  }
  return pts;
}
const lerp = (a, b, t) => a + (b - a) * t;

export function build(ctx) {
  const rng = makeRng(211);
  const E = ENGINE_AXIS;

  // ════════════ NACELLE COWLS (upper/lower split at side seam) ════════════
  const xsC = [];
  for (let x = N.xLip; x <= N.xEnd; x += 0.17) xsC.push(x);
  xsC.push(N.xEnd);
  // open ribbons: upper = perimeter 0→14 (right-top-left), lower = 13→26 (left-bottom-right)
  const cowl = (side) => {
    const sections = xsC.map((x) => {
      const u = clamp((x - N.xLip) / (N.xEnd - N.xLip), 0, 1);
      const full = cowlLoop(0, u);
      const loop = side === 'up' ? full.slice(0, 14) : full.slice(13);
      return { center: [x, AXY, AXZ], loop };
    });
    return loftLoops(sections, { closeLoop: false });
  };
  ctx.mesh('nacelle.cowl-upper.R', {
    geomKey: 'nac.cowl-up', mat: 'airframeTop',
    geom: () => cowl('up')
  });
  ctx.mesh('nacelle.cowl-lower.R', {
    geomKey: 'nac.cowl-lo', mat: 'airframeBot',
    geom: () => cowl('lo')
  });
  // cowl split line (0.006 gap visualised as raised seam, bucket 0)
  ctx.line('nacelle.cowl-lower.R', {
    pts: xsC.filter((_, i) => i % 3 === 0).map((x) => {
      const u = clamp((x - N.xLip) / (N.xEnd - N.xLip), 0, 1);
      const [y] = cowlLoop(0, u)[0];
      return [x, AXY + y, AXZ];
    }), name: 'nac.splitline', bucket: 0
  });

  // ════════════ field access doors (hinged, open with rig 'nacelleDoorR') ════════════
  const doorPivot = ctx.pivot('nacelle.door-l.R', {
    pos: [12.1, AXY + 0.88, AXZ - 0.52],
    handle: 'nacelleDoorR', meta: { axis: 'x', limitDeg: 55, note: 'clamshell aft-lower door, opens down-outboard (photos)' }
  });
  ctx.mesh('nacelle.door-l.R', {
    geomKey: 'nac.door', mat: 'airframeBot', pivot: doorPivot, bucket: 1,
    geom: () => {
      const geos = [];
      for (let x = 10.3; x < 12.1; x += 0.22) {
        const u = clamp((x - N.xLip) / (N.xEnd - N.xLip), 0, 1);
        const [y, z] = cowlLoop(0, u)[18]; // lower-right flank point of the cowl profile
        geos.push(box([x, AXY + y - 0.004, AXZ + z - 0.012], [x + 0.19, AXY + y + 0.022, AXZ + z + 0.014]));
      }
      return mergeGeometries(geos);
    }
  });

  // ════════════ D-section inlet lip + duct + splitter ════════════
  ctx.mesh('nacelle.inlet-lip.R', {
    geomKey: 'nac.lip', mat: 'bareMetal',
    geom: () => {
      const lip = (t) => {
        const a = t * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const up = s >= 0;
        return [
          Math.pow(Math.abs(c), 2 / 2.1) * (N.inletW / 2 + 0.085) * Math.sign(c || 1),
          Math.pow(Math.abs(s), 2 / (up ? 1.75 : 2.3)) * (up ? N.inletH / 2 + 0.075 : N.inletH / 2 + 0.06) * (up ? 1 : -1)
        ];
      };
      const duct = (t) => {
        const a = t * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const up = s >= 0;
        return [
          Math.pow(Math.abs(c), 2 / 2.1) * (N.inletW / 2) * Math.sign(c || 1),
          Math.pow(Math.abs(s), 2 / (up ? 1.9 : 2.35)) * (up ? N.inletH / 2 : N.inletH / 2 - 0.03) * (up ? 1 : -1)
        ];
      };
      return ringBand(lip, duct, N.xLip - 0.02, N.xLip + 0.14, 20).translate(0, AXY, AXZ + 0.03);
    }
  });
  ctx.mesh('nacelle.inlet-duct.R', {
    geomKey: 'nac.duct', mat: 'intakeDark', bucket: 1, cast: false,
    geom: () => {
      const secs = [];
      const N2 = 10;
      for (let i = 0; i <= N2; i++) {
        const u = i / N2;
        const x = lerp(N.xLip + 0.12, E.stations.fan.x - 0.06, u);
        const sh = lerp(1, 0.92, u);
        const loop = [];
        for (let j = 0; j < 20; j++) {
          const a = (j / 20) * Math.PI * 2;
          const c = Math.cos(a), s = Math.sin(a);
          const up = s >= 0;
          loop.push([
            Math.pow(Math.abs(c), 2 / 2.15) * (N.inletW / 2) * sh * Math.sign(c || 1) * lerp(1, 0.62, u),
            Math.pow(Math.abs(s), 2 / (up ? 1.95 : 2.4)) * (up ? N.inletH / 2 : N.inletH / 2 - 0.02) * sh * (up ? 1 : -1) * lerp(1, 0.9, u)
          ]);
        }
        secs.push({ center: [x, AXY + lerp(0, 0.24, u) * 0, AXZ + 0.02 - u * 0.02], loop });
      }
      return loftLoops(secs);
    }
  });
  // fan/core splitter annulus
  ctx.mesh('nacelle.splitter.R', {
    geomKey: 'nac.splitter', mat: 'bareMetal', bucket: 1, cast: false,
    geom: () => {
      const o = (t) => { const a = t * Math.PI * 2; return [0.60 * Math.cos(a), 0.565 * Math.sin(a)]; };
      const i = (t) => { const a = t * Math.PI * 2; return [0.50 * Math.cos(a), 0.47 * Math.sin(a)]; };
      return ringBand(o, i, E.bypass.splitterX - 0.1, E.bypass.splitterX, 18).translate(0, AXY, AXZ);
    }
  });

  // ════════════ exhaust lip + heat shield + aft fairing ════════════
  ctx.mesh('nacelle.exhaust-lip.R', {
    geomKey: 'nac.exlip', mat: 'hotMetal',
    geom: () => {
      const o = (t) => { const a = t * Math.PI * 2; return [(N.nozzleD / 2 + 0.14) * Math.cos(a), (N.nozzleD / 2 + 0.14) * Math.sin(a)]; };
      const i = (t) => { const a = t * Math.PI * 2; return [(N.nozzleD / 2) * Math.cos(a), (N.nozzleD / 2) * Math.sin(a)]; };
      const g = ringBand(o, i, N.xEnd - 0.14, N.xEnd + 0.02, 20);
      g.rotateY(rad(N.exhaustRiseDeg));
      g.translate(0, AXY, AXZ);
      return g;
    }
  });
  ctx.mesh('nacelle.heatshield.R', {
    geomKey: 'nac.heatshield', mat: 'hotMetal', bucket: 1, cast: false,
    geom: () => {
      const geos = [];
      for (let i = 0; i < 5; i++) {
        const a = -0.8 + i * 0.4;
        geos.push(box([11.9, AXY + Math.cos(a) * 0.78, AXZ - Math.sin(a) * 0.74], [13.02, AXY + Math.cos(a) * 0.86, AXZ - Math.sin(a) * 0.82]));
      }
      return mergeGeometries(geos);
    }
  });
  ctx.mesh('nacelle.aft-fairing.R', {
    geomKey: 'nac.aftfair', mat: 'airframeTop',
    geom: () => {
      const geos = [];
      let prev = null;
      for (let x = 12.2; x <= 13.8; x += 0.2) {
        const hw = lerp(0.62, 0.2, clamp((x - 12.2) / 1.6, 0, 1));
        const zc = lerp(AXZ - 0.62, 1.72, clamp((x - 12.2) / 1.6, 0, 1));
        if (prev) geos.push(box([prev[0], AXY - prev[1] * 0.02, zc - 0.30], [x, AXY - hw, zc + 0.24]));
        prev = [x, hw, zc];
      }
      return mergeGeometries(geos);
    }
  });

  // ════════════ pylon + 4 bolts (doc: four bolts per pylon) ════════════
  ctx.mesh('nacelle.pylon.R', {
    geomKey: 'nac.pylon', mat: 'interiorStructure', bucket: 1,
    geom: () => {
      const [x0, x1] = E.mountPylon.x;
      const geos = [];
      geos.push(box([x0, AXY - 0.42, AXZ - 0.5], [x1, AXY - 0.34, AXZ + 0.5]));
      geos.push(box([x0, AXY + 0.34, AXZ - 0.5], [x1, AXY + 0.42, AXZ + 0.5]));
      geos.push(box([x0, AXY - 0.42, AXZ + 0.44], [x1, AXY + 0.42, AXZ + 0.52]));
      return mergeGeometries(geos);
    }
  });
  ctx.inst('nacelle.pylon-bolts.R', {
    geomKey: 'fastener.bolt', mat: 'bareMetal', bucket: 0, cast: false,
    matrices: (() => {
      const m = [];
      for (const x of [E.mountPylon.x[0] + 0.15, E.mountPylon.x[1] - 0.15]) {
        for (const y of [AXY - 0.38, AXY + 0.38]) {
          const mm = new THREE.Matrix4();
          mm.compose(new THREE.Vector3(x, y, AXZ + 0.48), new THREE.Quaternion(), new THREE.Vector3(0.035, 0.05, 0.035));
          m.push(mm);
        }
      }
      return m;
    })(),
    geom: () => new THREE.CylinderGeometry(1, 0.8, 1, 8)
  });

  // ════════════ TF34 internals (core axis = nacelle axis) ════════════
  const S = E.stations;
  const along = (x, r = 0, a = 0, len = 0) => new THREE.Vector3(x, AXY + Math.cos(a) * r, AXZ + Math.sin(a) * r);

  // fan case ring
  ctx.mesh('engine.fan.R', {
    geomKey: 'eng.fancase', mat: 'engineCase', bucket: 1,
    geom: () => {
      const o = (t) => [0.62 * Math.cos(t * Math.PI * 2), 0.62 * Math.sin(t * Math.PI * 2)];
      const i = (t) => [0.575 * Math.cos(t * Math.PI * 2), 0.575 * Math.sin(t * Math.PI * 2)];
      return ringBand(o, i, S.fan.x - 0.02, S.fan.x + S.fan.len, 20).translate(0, AXY, AXZ);
    }
  });
  // fan rotor pivot (N1 spin; mirror flips via rig sign)
  const fanPivot = ctx.pivot('engine.fan.R', {
    pos: along(S.fan.x + 0.14, 0, 0).toArray(),
    handle: 'fanR', meta: { axis: 'x', note: '1-stage fan + LP spool visual' }
  });
  // hub cone
  ctx.mesh('engine.fan.R', {
    geomKey: 'eng.fan-hub', mat: 'bladeAlloy', pivot: fanPivot,
    geom: () => {
      const g = new THREE.ConeGeometry(S.fan.rHub + 0.03, S.fan.len + 0.2, 16);
      g.rotateX(-Math.PI / 2);
      g.translate(S.fan.x + 0.14, AXY, AXZ);
      return g;
    }
  });
  // blades: ONE curved plate + 24 instances (LOD0/1 share; L0 count 24)
  {
    const blade = (() => {
      const g = new THREE.BoxGeometry(0.34, 0.012, 0.30);
      g.rotateX(0.55); // twist
      g.translate(0.2, 0, 0.135);
      return g;
    })();
    const m = [];
    for (let i = 0; i < REF.engine.fanBlades; i++) {
      const a = (i / REF.engine.fanBlades) * Math.PI * 2;
      const mm = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a));
      const pos = new THREE.Vector3(S.fan.x + 0.16, AXY + Math.sin(a) * 0.24, AXZ + Math.cos(a) * 0.24);
      void q;
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, Math.PI / 2, 0));
      mm.compose(pos, q2, new THREE.Vector3(1, 1, 1));
      m.push(mm);
    }
    ctx.inst('engine.fan.R', { geomKey: 'eng.fan-blade', mat: 'bladeAlloy', pivot: fanPivot, matrices: m, geom: () => blade, cast: false });
  }
  // booster
  ctx.mesh('engine.booster.R', {
    geomKey: 'eng.booster', mat: 'engineCase', bucket: 1,
    geom: () => {
      const g = new THREE.CylinderGeometry(S.booster.rTip, S.booster.rTip - 0.02, S.booster.len, 18);
      g.rotateZ(Math.PI / 2);
      g.translate(S.booster.x + S.booster.len / 2, AXY, AXZ);
      return g;
    }
  });
  // HP compressor: drum bands (represents 14 stages, doc stage count)
  ctx.mesh('engine.hp-compressor.R', {
    geomKey: 'eng.hp', mat: 'bladeAlloy',
    geom: () => {
      const geos = [];
      const bands = S.hpComp.bands;
      for (let i = 0; i < bands; i++) {
        const t0 = i / bands, t1 = (i + 0.62) / bands;
        const r0 = lerp(S.hpComp.rO, S.hpComp.rO * 0.62, t0), r1 = lerp(S.hpComp.rO, S.hpComp.rO * 0.62, t1);
        const g = new THREE.CylinderGeometry(r1, r0, (S.hpComp.len / bands) * 0.62, 16);
        g.rotateZ(Math.PI / 2);
        g.translate(S.hpComp.x + (t0 + 0.31 / bands) * S.hpComp.len, AXY, AXZ);
        geos.push(g);
      }
      return mergeGeometries(geos);
    }
  });
  // combustor annulus + injectors
  ctx.mesh('engine.combustor.R', {
    geomKey: 'eng.comb', mat: 'hotMetal', bucket: 1,
    geom: () => {
      const o = (t) => { const a = t * Math.PI * 2; return [S.combustor.rO * Math.cos(a), S.combustor.rO * Math.sin(a)]; };
      const i = (t) => { const a = t * Math.PI * 2; return [S.combustor.rI * Math.cos(a), S.combustor.rI * Math.sin(a)]; };
      const outer = ringBand(o, (t) => { const a = t * Math.PI * 2; return [(S.combustor.rO - 0.02) * Math.cos(a), (S.combustor.rO - 0.02) * Math.sin(a)]; }, S.combustor.x, S.combustor.x + S.combustor.len, 18);
      const inner = ringBand(i, (t) => { const a = t * Math.PI * 2; return [(S.combustor.rI + 0.02) * Math.cos(a), (S.combustor.rI + 0.02) * Math.sin(a)]; }, S.combustor.x, S.combustor.x + S.combustor.len, 18);
      outer.translate(0, AXY, AXZ); inner.translate(0, AXY, AXZ);
      return mergeGeometries([outer, inner]);
    }
  });
  ctx.inst('engine.fuel-nozzles.R', {
    geomKey: 'eng.injector', mat: 'warningYellow', bucket: 0, cast: false,
    matrices: (() => {
      const m = [];
      for (let i = 0; i < S.combustor.injectors; i++) {
        const a = (i / S.combustor.injectors) * Math.PI * 2;
        const mm = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, Math.PI / 2, 0));
        mm.compose(new THREE.Vector3(S.combustor.x - 0.045, AXY + Math.sin(a) * (S.combustor.rO + 0.02), AXZ + Math.cos(a) * (S.combustor.rO + 0.02)), q, new THREE.Vector3(0.02, 0.055, 0.02));
        m.push(mm);
      }
      return m;
    })(),
    geom: () => new THREE.CylinderGeometry(1, 1, 1, 6)
  });
  // turbines: disc + bladed rings (instanced blades per stage)
  for (const [id, stg, stages] of [['engine.hpt.R', S.hpt, S.hpt.stages], ['engine.lpt.R', S.lpt, S.lpt.stages]]) {
    const pivot = ctx.pivot(id, { pos: [stg.x + stg.len / 2, AXY, AXZ], handle: `${id.includes('hpt') ? 'hptR' : 'lptR'}`, meta: { axis: 'x' }, bucket: 1 });
    ctx.mesh(id, {
      geomKey: `${id}-discs`, mat: 'hotMetal', pivot, cast: false,
      geom: () => {
        const geos = [];
        for (let i = 0; i < stages; i++) {
          const x = stg.x + (i + 0.5) * (stg.len / stages);
          const g = new THREE.CylinderGeometry(stg.rHub + 0.012, stg.rHub + 0.012, stg.len / stages * 0.5, 14);
          g.rotateZ(Math.PI / 2); g.translate(x, AXY, AXZ);
          geos.push(g);
        }
        return mergeGeometries(geos);
      }
    });
    ctx.inst(id, {
      geomKey: `${id}-blade`, mat: 'bladeAlloy', pivot, cast: false,
      matrices: (() => {
        const m = [], blades = 32;
        for (let s = 0; s < stages; s++) for (let i = 0; i < blades; i++) {
          const a = (i / blades) * Math.PI * 2;
          const x = stg.x + (s + 0.5) * (stg.len / stages);
          const mm = new THREE.Matrix4();
          mm.compose(
            new THREE.Vector3(x, AXY + Math.sin(a) * (stg.rTip - 0.03), AXZ + Math.cos(a) * (stg.rTip - 0.03)),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0.5)),
            new THREE.Vector3(1, 0.008, stg.rTip - stg.rHub - 0.02)
          );
          m.push(mm);
        }
        return m;
      })(),
      geom: () => new THREE.BoxGeometry(1, 1, 1)
    });
  }
  // spools
  ctx.mesh('engine.core-shaft.R', {
    geomKey: 'eng.shaft', mat: 'bareMetal', bucket: 1, cast: false,
    geom: () => {
      const g1 = new THREE.CylinderGeometry(0.05, 0.05, S.lpt.x + S.lpt.len - S.fan.x, 10);
      g1.rotateZ(Math.PI / 2); g1.translate((S.fan.x + S.lpt.x + S.lpt.len) / 2, AXY, AXZ);
      const g2 = new THREE.CylinderGeometry(0.032, 0.032, S.combustor.x - S.hpComp.x, 8);
      g2.rotateZ(Math.PI / 2); g2.translate((S.hpComp.x + S.combustor.x) / 2, AXY - 0.09, AXZ + 0.09);
      return mergeGeometries([g1, g2]);
    }
  });
  // core exhaust cone / plug
  ctx.mesh('engine.nozzelext.R', {
    geomKey: 'eng.plug', mat: 'hotMetal',
    geom: () => {
      const g = new THREE.CylinderGeometry(S.plug.r1, S.plug.r0, S.plug.len, 16);
      g.rotateZ(Math.PI / 2);
      g.translate(S.plug.x + S.plug.len / 2, AXY, AXZ);
      const c = new THREE.CylinderGeometry(S.coreNozzle.rTip, S.coreNozzle.rTip + 0.06, S.coreNozzle.len, 16, 1, true);
      c.rotateZ(Math.PI / 2);
      c.translate(S.coreNozzle.x + S.coreNozzle.len / 2, AXY, AXZ);
      return mergeGeometries([g, c]);
    }
  });
  // accessories: AGB, starter, pumps
  ctx.mesh('engine.agb.R', {
    geomKey: 'eng.agb', mat: 'engineCase', bucket: 1,
    geom: () => {
      const a = rad(E.accessory.azDeg);
      const y = AXY + Math.cos(a) * (S.hpComp.rO + 0.1), z = AXZ + Math.sin(a) * (S.hpComp.rO + 0.1);
      const g = new THREE.CylinderGeometry(E.accessory.gearboxR, E.accessory.gearboxR, E.accessory.gearboxLen, 12);
      g.rotateZ(Math.PI / 2);
      g.translate(E.accessory.x + E.accessory.gearboxLen / 2, y, z);
      return g;
    }
  });
  ctx.mesh('engine.starter.R', {
    geomKey: 'eng.starter', mat: 'steelDark', bucket: 1,
    geom: () => {
      const a = rad(E.accessory.azDeg + 40);
      const y = AXY + Math.cos(a) * (S.hpComp.rO + 0.13), z = AXZ + Math.sin(a) * (S.hpComp.rO + 0.13);
      const g = new THREE.CylinderGeometry(E.accessory.starterR, E.accessory.starterR, E.accessory.starterLen, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(E.accessory.x + 0.36, y, z);
      return g;
    }
  });
  ctx.mesh('engine.pumps.R', {
    geomKey: 'eng.pumps', mat: 'steelDark', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      const a0 = rad(E.accessory.azDeg - 30);
      for (let i = 0; i < 3; i++) {
        const y = AXY + Math.cos(a0) * (S.hpComp.rO + 0.06 + i * 0.02), z = AXZ + Math.sin(a0) * (S.hpComp.rO + 0.06 + i * 0.02);
        geos.push(box([E.accessory.x - 0.02 - i * 0.14, y - 0.045, z - 0.045], [E.accessory.x + 0.14 - i * 0.14, y + 0.045, z + 0.045]));
      }
      return mergeGeometries(geos);
    }
  });
  // mount cradle
  ctx.mesh('engine.mount-frame.R', {
    geomKey: 'eng.cradle', mat: 'interiorStructure', bucket: 1,
    geom: () => {
      const geos = [];
      geos.push(box([10.28, AXY - 0.3, AXZ + 0.5], [11.9, AXY + 0.3, AXZ + 0.66]));
      for (const y of [AXY - 0.24, AXY + 0.24]) geos.push(strut([10.35, y, AXZ + 0.5], [11.85, y, AXZ + 0.52], 0.03, 6));
      return mergeGeometries(geos);
    }
  });
  // external piping (casing accessory runs)
  ctx.mesh('engine.cases.R', {
    geomKey: 'eng.pipes', mat: 'bareMetal', bucket: 0, cast: false,
    geom: () => {
      const geos = [];
      for (const [a0, x0, x1, r] of [[0.6, 10.4, 11.9, 0.028], [-1.9, 9.8, 11.2, 0.032], [2.6, 10.0, 12.0, 0.024]]) {
        geos.push(strut([x0, AXY + Math.cos(a0) * 0.6, AXZ + Math.sin(a0) * 0.5], [x1, AXY + Math.cos(a0) * 0.58, AXZ + Math.sin(a0) * 0.5], r, 6));
      }
      return mergeGeometries(geos);
    }
  });
  void THRUST_Q; void roundedRectLoop;
}
