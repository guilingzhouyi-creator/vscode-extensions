# 架构 · Architecture

Five strictly downward layers. Higher layers never import from lower ones; all numbers live
in `spec/` and are imported, never re-derived, downstream.

```
spec/      constants · referenceDimensions · fuselageSpec · wingSpec · gunSpec · engineSpec
           gearSpec · cockpitSpec · materialsSpec · partTree · storesSpec      ← ALL numbers
math/      profiles.js — frame interpolation, superellipse points, airfoil loops
geometry/  _util (loft/ring/plate/strut/box/mirror/fasteners) · airframe · armorCanopy ·
           cockpit · gunBay · wing · tail · nacelleEngine · landingGear · systems · stores
build/     materialFactory (shared PBR + canvas camo/stencil textures) · geometryCache
           (ref-counted) · builder (scene graph, mirror pass, LOD buckets, rig pivots) · lifecycle
interaction/ rig · picker · explodedView · cutaway · damage
app/       viewer (renderer/camera/lights) · ui (DOM↔API) · designSheet (SVG 3-view) · main
```

## The scene graph contract

`modelRoot → assembly:<id> → part:<id> → bucket b2/b1/b0 → pivot:<handle> → meshes`

- **Part registry is an ID contract.** `partTree.js` declares every part; the builder verifies
  at build time that every id is emitted **exactly once** and no unregistered group appears
  (tests re-verify from the scene side).
- **Mirror discipline.** Starboard parts are authored once with id `…​.R` + `mirror:'LR'`;
  the builder generates the port twin: reflection across `y=0` (scale(1,−1,1) + winding-fixed
  geometry clone, cached as `mirrorOf:<key>`), with rig handles renamed `*R → *L`.
- **Absolute-coordinate authoring.** Every mesh/instance geometry is authored in absolute
  aircraft coordinates; the builder compensates pivot parenting by `mesh.position −= pivot.position`,
  so a pivot rotation *is* the hinge transform. (Rationale: shared geometry + ref-counted cache —
  a locally-authored part can't reuse its buffer across pivots.)
- **LOD buckets.** Every part's content lands in b0 (rivets/fastener fields), b1 (hinges,
  fairings, interiors) or b2 (primary surfaces). Visibility rule: bucket visible while
  `lod ≤ bucket`, b0 additionally gated by the rivets switch. Auto-LOD by camera distance
  (thresholds 14 / 34 m), forceable per LOD. Geometry *buffers* are always shared — LOD
  removes draw content, never re-tessellates.

## Rig model

`ctx.pivot(partId, { pos, handle, meta })` registers named handles; `interaction/rig.js` maps
**commands** (`gear/flaps/canopy/nacelle/rudder/elevator/aileron/spoileron/n1/gun/wheelSpin/
gunBay`) to angles, with symmetry rules applied in the command layer:
- symmetric channels (flaps, gear, elevator, doors) push the same local angle to both mirrors;
- antisymmetric channels (ailerons for roll, fan/spool rotation for same-world-direction)
  negate the L side, compensating the mirror node's flipped rotation;
- custom hinge axes: `meta.axisVec` (aileron/spoileron/rudder swept hinges) → quaternion
  `setFromAxisAngle`; plain `x/y/z` for everything else; limits stored in `meta.limitDeg` (data, not clamps-in-shader).

## Interaction systems

- **picker** — raycast → nearest visible → `userData.partId` walk-up → highlight via one shared
  override material + metadata card; rig-owned drawables resolve to their logical part.
- **explodedView** — pure function of factor f: `pos = (assembly.explode + part.explode) · f`;
  vectors declared in the registry (data), eased in `tick`.
- **cutaway** — global renderer clipping planes in world axes, exposed as aircraft X / Y(band
  or half) / Z cuts; internal buckets always exist so a cut reveals real interiors.
- **damage** — `applyHit({partId?, point?, normal?, energyJ})`: HP bookkeeping, entry/exit scorch
  decals (real cones, no texture fakery), knock-out consequences routed through public hooks:
  `rig.lock(handle)` + material darkening. `clear()` restores. No geometry module special-cases damage.

## Performance & lifecycle discipline

- One `MeshStandardMaterial` per material key; livery swap mutates map/color in place.
- All rivets/fasteners: single geometry + instance matrices (deterministic `makeRng` seed).
- `counts()` reports meshes/instances/triangles/unique geometries — the "geometry cache" test
  asserts `uniqueGeoms ≪ meshes`; `dispose()` must return the cache to zero live entries.
- `createModelStaged()` wraps the headless build for the browser (async phases + progress);
  `lifecycle.setVisible / unload` are the hot-swap points for future variants.

## Public surface (console)

```js
__A10.model.setLod(1); __A10.model.setRivets(false); __A10.model.materials.setLivery('grey')
__A10.rig.command('gear', 1); __A10.rig.command('n1', 0.85)
__A10.exploded.set(0.6); __A10.cutaway.toggle('x', true); __A10.cutaway.set('x', 9.4)
__A10.model.ctx.loadout.applyLoadout('max')
__A10.damage.applyHit({}); // random target
```
