/**
 * DAMAGE SYSTEM (interface + baseline visuals):
 *  applyHit(point?, partId?, energyJ) → per-part hit points, scorched entry/exit decals
 *  (real cone/ring geometry, not flat black textures), HP depletion; when HP → 0 the
 *  functional consequence runs through the rig (locked control surfaces) and material
 *  (hotMetal darkening) hooks. Extensible for fire/spall — no ad-hoc hacks in geometry modules.
 */
import * as THREE from 'three';

const DECAL_IN = new THREE.ConeGeometry(0.055, 0.05, 9, 1, true);
const DECAL_OUT = new THREE.ConeGeometry(0.075, 0.06, 9, 1, true);
const matScorch = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1, metalness: 0, side: THREE.DoubleSide });
const matEdge = new THREE.MeshStandardMaterial({ color: 0x53331d, roughness: 0.85, metalness: 0.25, side: THREE.DoubleSide });

export function createDamage(model, rig) {
  const root = new THREE.Group();
  root.name = 'damage';
  model.root.add(root);
  const hitsByPart = new Map();

  function hpFor(d) {
    const m = d.mass || 30;
    return 90 + Math.min(400, m * 0.4);
  }
  function randomTarget(rng) {
    const ids = [...model.groups.keys()].filter((id) => !id.startsWith('hp.store'));
    return ids[Math.floor(rng() * ids.length)];
  }
  function applyHit({ partId, point, normal, energyJ = 2.4e6, rng = Math.random }) {
    if (!partId) partId = randomTarget(rng);
    const g = model.groups.get(partId);
    if (!g) return null;
    const def = model.partDefs.get(partId);
    if (!def) return null;
    if (!hitsByPart.has(partId)) hitsByPart.set(partId, { hp: hpFor(g.userData), hits: 0 });
    const rec = hitsByPart.get(partId);
    rec.hits++; rec.hp -= energyJ / 3e4;

    // choose impact point: pick ray point if given, else sample the part bbox corner
    let p = point, n = normal;
    if (!p) {
      const box = new THREE.Box3().setFromObject(g);
      if (!box.isEmpty()) {
        p = box.getCenter(new THREE.Vector3()).add(new THREE.Vector3((rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6).clampLength(0, 1.2));
        n = new THREE.Vector3(rng() - 0.5, rng(), rng() - 0.5).normalize();
      } else return null;
    }
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const in1 = new THREE.Mesh(DECAL_IN, matEdge);
    in1.quaternion.copy(q); in1.position.copy(p).addScaledVector(n, 0.012); in1.scale.setScalar(0.6 + rng() * 0.7);
    const in2 = new THREE.Mesh(DECAL_IN, matScorch);
    in2.quaternion.copy(q); in2.position.copy(p).addScaledVector(n, 0.004); in2.scale.setScalar(0.9 + rng() * 0.9);
    const out = new THREE.Mesh(DECAL_OUT, matScorch);
    out.quaternion.copy(q); out.position.copy(p).addScaledVector(n, -0.10 - rng() * 0.1); out.scale.setScalar(0.7 + rng() * 0.8);
    root.add(in1, in2, out);
    // dent the geometry locally? — displacement on a SHARED cached buffer would corrupt siblings;
    // per-hit we therefore clone into an overlay patch only for hull skins:
    if (['fuselage.skin-upper', 'fuselage.skin-lower', 'wing.skin-upper.R', 'nose.shell'].includes(partId)) {
      // overlay dimple: tiny inverted cone sunk into skin (cheap, no shared-buffer mutation)
      const dimple = new THREE.Mesh(DECAL_IN, matScorch);
      dimple.quaternion.copy(q); dimple.position.copy(p).addScaledVector(n, -0.006);
      dimple.scale.set(1.6, 0.35, 1.6);
      root.add(dimple);
    }
    if (rec.hp <= 0) knockOut(partId);
    return { partId, hits: rec.hits, hpLeft: Math.max(0, rec.hp), knockedOut: rec.hp <= 0 };
  }

  function knockOut(partId) {
    const g = model.groups.get(partId);
    if (!g || g.userData.destroyed) return;
    g.userData.destroyed = true;
    // functional consequences via rig locks + material darkening on hull
    const lockMap = {
      'wing.flap.R': 'flapR', 'wing.flap.L': 'flapL', 'wing.aileron.R': 'aileronR', 'wing.aileron.L': 'aileronL',
      'tail.elevator.R': 'elevatorR', 'tail.elevator.L': 'elevatorL', 'tail.rudder.R': 'rudderR', 'tail.rudder.L': 'rudderL'
    };
    if (lockMap[partId]) rig.lock(lockMap[partId], true);
    if (partId.startsWith('engine.fan')) {
      const h = partId.includes('L') ? 'fanL' : 'fanR';
      rig.lock(h, true); rig.lock(h.replace('fan', 'lpt'), true); rig.lock(h.replace('fan', 'hpt'), true);
    }
    g.traverse((o) => {
      if (o.isMesh && o.material?.color && o.userData.partId === partId && !o.userData._dmaged) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.62);
        o.material.emissive = new THREE.Color(0x1a0800);
        o.userData._dmaged = true;
        o.userData._dmageMat = o.material;
      }
    });
  }

  function clear() {
    for (const o of [...root.children]) root.remove(o);
    hitsByPart.clear();
    for (const [, g] of model.groups) {
      if (g.userData.destroyed) {
        g.userData.destroyed = false;
        g.traverse((o) => { if (o.userData._dmaged) { o.material.dispose(); o.userData._dmaged = false; } });
      }
    }
    for (const k of Object.keys(rig.state.locked)) rig.lock(k, false);
  }
  function count() { let c = 0; for (const r of hitsByPart.values()) c += r.hits; return c; }
  function dispose() {
    clear();
    DECAL_IN.dispose(); DECAL_OUT.dispose(); matScorch.dispose(); matEdge.dispose();
    root.removeFromParent();
  }
  return { applyHit, clear, count, dispose, hitsByPart };
}
