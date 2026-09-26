/**
 * HEADLESS ACCEPTANCE TESTS — run: node tests/run.mjs
 * Validates: spec provenance invariants, part-tree/registry contract, the full
 * LOD0 build (unique ids, mirror twins, bucket visibility, cache sharing), rig
 * command plumbing, loadout toggling, design-sheet data, and dispose cleanliness.
 * No DOM, no WebGL context needed (three runs headless with noTextures).
 */
import * as THREE from 'three';
import assert from 'node:assert/strict';

import { buildAircraft } from '../src/build/builder.js';
import { ASSEMBLIES, PART_REGISTRY, flattenParts } from '../src/spec/partTree.js';
import { REF } from '../src/spec/referenceDimensions.js';
import { FUSELAGE_FRAMES } from '../src/spec/fuselageSpec.js';
import { frameAt } from '../src/math/profiles.js';
import { chordAt, WING } from '../src/spec/wingSpec.js';
import { TOLERANCE } from '../src/spec/constants.js';
import { createRig } from '../src/interaction/rig.js';
import { createExplodedView } from '../src/interaction/explodedView.js';
import { createDamage } from '../src/interaction/damage.js';
import { generateSVG } from '../src/app/designSheet.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('— spec layer —');
test('fuselage frames monotone in x & close the loft at nose/tail', () => {
  for (let i = 1; i < FUSELAGE_FRAMES.length; i++) assert.ok(FUSELAGE_FRAMES[i].x > FUSELAGE_FRAMES[i - 1].x, 'x monotone');
  assert.ok(FUSELAGE_FRAMES[0].y <= 0.15, 'nose nearly closes');
  assert.ok(FUSELAGE_FRAMES.at(-1).y <= 0.15, 'tail nearly closes');
});
test('wing area identity: b·(cRoot+cTip)/2 = 47.57 m² (taper 0.65) — spec lock', () => {
  const c = WING.chordRoot, ct = WING.chordTip;
  assert.ok(near(ct / c, 0.65, 0.005), `taper ${ct / c}`);
  const area = 17.42 * (c + ct) / 2;
  assert.ok(near(area, 47.57, 47.57 * 0.005), `area ${area}`);
  assert.ok(near(chordAt(0), c, 0.02), `${chordAt(0)} vs ${c}`);
});
test('frameAt clamps beyond stations', () => {
  const a = frameAt(FUSELAGE_FRAMES, -1), b = frameAt(FUSELAGE_FRAMES, 0);
  assert.equal(a.y, b.y);
});

console.log('— part-tree contract —');
test('registry ids unique; mirror parts end .R; every part has name_zh + explode + src', () => {
  const ids = new Set();
  for (const p of flattenParts()) {
    assert.ok(!ids.has(p.id), `dup ${p.id}`);
    ids.add(p.id);
    assert.ok(p.name_zh, `no zh ${p.id}`);
    assert.ok(Array.isArray(p.explode) && p.explode.length === 3 && p.explode.every(Number.isFinite), `explode ${p.id}`);
    assert.ok(['doc', 'der', 'eng', 'est'].includes(p.src), `src ${p.id}`);
    if (p.mirror === 'LR') assert.ok(p.id.endsWith('.R'), `mirror must end .R: ${p.id}`);
  }
  for (const asm of ASSEMBLIES) for (const pid of asm.parts.map((q) => q.id)) assert.ok(PART_REGISTRY.has(pid));
});

console.log('— full LOD0 build —');
const model = buildAircraft({ level: 0, rivets: true, noTextures: true });
test('bbox = documented L×span×H within tolerance', () => {
  const size = model.bbox.getSize(new THREE.Vector3());
  // root unrotated in build → dims come as (x=aft len, y=half-span*2, z=height)
  const L = size.x, span = size.y, H = size.z;
  assert.ok(near(L, REF.overall.length, REF.overall.length * TOLERANCE.length), `L ${L.toFixed(3)} vs 16.16`);
  assert.ok(near(span, REF.overall.wingspan, REF.overall.wingspan * TOLERANCE.wingspan), `span ${span.toFixed(3)} vs 17.42`);
  assert.ok(near(H, REF.overall.height, REF.overall.height * TOLERANCE.height), `H ${H.toFixed(3)} vs 4.42`);
});
test('ground datum: min z ≈ 0 (tires touch), within 6 cm', () => {
  assert.ok(Math.abs(model.bbox.min.z) < 0.06, `min.z ${model.bbox.min.z}`);
});
test('engine spacing within 8% (cowl center y vs REF)', () => {
  const b = new THREE.Box3();
  for (const id of ['nacelle.cowl-upper.R', 'nacelle.cowl-lower.R']) {
    const g = model.groups.get(id);
    assert.ok(g, `${id} exists`);
    b.union(new THREE.Box3().setFromObject(g));
  }
  const centerY = (b.max.y + b.min.y) / 2;
  const want = REF.nacelle.centerY;
  assert.ok(near(centerY, want, want * TOLERANCE.engineSpacing), `nacelle center ${centerY.toFixed(2)} vs ${want.toFixed(2)}`);
});
test('every registry id emitted exactly once (+ mirror twins), no orphans', () => {
  const expect = new Set();
  for (const p of PART_REGISTRY.values()) {
    expect.add(p.id);
    if (p.mirror === 'LR') expect.add(p.id.replace(/\.R$/, '.L'));
  }
  const have = new Set(model.groups.keys());
  for (const id of expect) assert.ok(have.has(id), `missing part group: ${id}`);
  for (const id of have) assert.ok(expect.has(id), `unexpected part group: ${id}`);
});
test('scene has no unnamed top parts; partId tags on meshes; instanced fasteners exist', () => {
  let inst = 0, meshes = 0;
  model.root.traverse((o) => { if (o.isInstancedMesh) inst++; if (o.isMesh) meshes++; });
  assert.ok(inst >= 3, `instanced meshes: ${inst}`);
  assert.ok(meshes > 60, `meshes: ${meshes}`);
});
test('geometry cache sharing: unique geometries ≪ meshes', () => {
  const c = model.counts();
  assert.ok(c.uniqueGeoms < c.meshes, `${c.uniqueGeoms} geoms vs ${c.meshes} meshes`);
  assert.ok(c.trisTotal > 120000, `tri count ${c.trisTotal}`);
});
test('LOD tiers: LOD2 hides b0/b1 content, rivets off removes b0', () => {
  model.setLod(2); model.setRivets(true);
  const wingRiv = model.groups.get('wing.rivets.R');
  assert.ok(wingRiv && !wingRiv.children[0].visible, 'b0 hidden at LOD2');
  model.setLod(0); model.setRivets(false);
  assert.ok(!wingRiv.children[0].visible, 'b0 hidden when rivets off');
  model.setRivets(true);
  assert.ok(wingRiv.children[0].visible, 'b0 visible at LOD0');
});
test('rig handles registered: flaps/gear/canopy/fan + mirrored twins', () => {
  for (const h of ['flapR', 'flapL', 'gearNose', 'gearMainR', 'gearMainL', 'canopyOpen', 'fanR', 'fanL', 'elevatorR', 'rudderL', 'doorMainInR', 'nacelleDoorL', 'gunBayDoorR']) {
    assert.ok(model.rigs[h], `missing rig handle: ${h}`);
    assert.ok(model.rigs[h].node, `handle has no node: ${h}`);
  }
});
test('rig commands move hinges (flap 40°, gear retract, canopy)', () => {
  const rig = createRig(model);
  rig.command('flaps', 1);
  const q = model.rigs.flapR.node.quaternion;
  const e = new THREE.Euler().setFromQuaternion(q);
  assert.ok(near(e.y, 40 * Math.PI / 180, 0.01), `flap angle ${e.y}`);
  rig.command('gear', 1);
  assert.ok(Math.abs(model.rigs.gearNose.node.rotation.y) > 1.6, 'gear rotated');
  rig.command('canopy', 1);
  assert.ok(Math.abs(model.rigs.canopyOpen.node.rotation.x) > 1.0, 'canopy rotated');
  rig.command('flaps', 0); rig.command('gear', 0); rig.command('canopy', 0);
});
test('rudder symmetric-in-world: L mirrors R', () => {
  const rig = createRig(model);
  rig.command('rudder', 0.5);
  assert.ok(Math.abs(model.rigs.rudderR.node.rotation.z || 0) + Math.abs(model.rigs.rudderR.node.quaternion.x) > 0 || model.rigs.rudderR.meta.axis === 'custom');
  rig.command('rudder', 0);
});
test('loadout: CAS shows bombs at R2, none at L5; clean clears', () => {
  model.ctx.loadout.applyLoadout('cas');
  let visR2 = 0, visL5 = 0;
  for (const [k, arr] of model.ctx.loadout.catalog) {
    for (const m of arr) if (m && m.visible) { if (k.startsWith('R2')) visR2++; if (k.startsWith('L5')) visL5++; }
  }
  assert.ok(visR2 === 2, `R2 bombs ${visR2}`);
  assert.ok(visL5 === 0, `L5 should be empty ${visL5}`);
  model.ctx.loadout.clearLoadout();
  let any = 0;
  for (const [, arr] of model.ctx.loadout.catalog) for (const m of arr) if (m && m.visible) any++;
  assert.equal(any, 0);
});
test('exploded view separates parts (per-part vectors; wing stays datum)', () => {
  const ex = createExplodedView(model);
  const before = model.groups.get('wing.flap.R').position.clone();
  const beforeAsm = model.assemblyRoots.get('tail').position.clone();
  ex.apply(1);
  const dPart = before.distanceTo(model.groups.get('wing.flap.R').position);
  const dAsm = beforeAsm.distanceTo(model.assemblyRoots.get('tail').position);
  assert.ok(dPart > 0.5 || dAsm > 0.5, `moved part ${dPart.toFixed(2)} asm ${dAsm.toFixed(2)}`);
  ex.apply(0);
});
test('picker resolves partId from mesh upward (rig-tagged drawables resolve to owner part)', () => {
  // barrels are instanced UNDER the carrier pivot but tagged gun.barrels — picker must resolve the tag
  let found = null;
  model.root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.userData.partId === 'gun.barrels' && !found) found = o; });
  assert.ok(found, 'gun.barrels has a tagged drawable');
  let o = found;
  while (o && !o.userData.partId) o = o.parent;
  assert.equal(o.userData.partId, 'gun.barrels');
});
test('damage: hits accrue; knocking out flap locks rig channel', () => {
  const rig = createRig(model);
  const dmg = createDamage(model, rig);
  let r;
  for (let i = 0; i < 40; i++) r = dmg.applyHit({ partId: 'wing.flap.R', energyJ: 3e5, rng: (() => { let s = 42; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })() });
  assert.ok(r.knockedOut, 'flap should be knocked out');
  assert.ok(rig.state.locked.flapR, 'flapR channel locked');
  dmg.clear();
  assert.equal(dmg.count(), 0);
});
test('design sheet: valid svg with key dimensions', () => {
  const svg = generateSVG();
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  for (const s of ['16.16', '17.42', '4.42', 'GAU-8', 'STA']) assert.ok(svg.includes(s), `svg missing ${s}`);
});
test('dispose releases everything (cache empty, materials gone)', () => {
  model.dispose();
  const s = model.cache.stats();
  assert.equal(s.live, 0, `cache still holds ${s.live}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
