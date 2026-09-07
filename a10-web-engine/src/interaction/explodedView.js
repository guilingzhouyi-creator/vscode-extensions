/**
 * EXPLODED VIEW — deterministic separation along registry-declared vectors.
 * Assembly-level base offset + per-part vector, eased; frozen matrices updated explicitly.
 */
export function createExplodedView(model) {
  const factor = { v: 0, target: 0 };
  const parts = [...model.groups.values()];
  const assemblies = [...model.assemblyRoots.values()];

  function apply(f) {
    for (const a of assemblies) {
      const [dx, dy, dz] = a.userData.explode || [0, 0, 0];
      a.position.set(dx * f, dy * f, dz * f);
      a.matrixAutoUpdate = false;
      a.updateMatrix();
    }
    for (const g of parts) {
      const [dx, dy, dz] = g.userData.explode || [0, 0, 0];
      g.position.set(dx * f, dy * f, dz * f);
      g.updateMatrix();
    }
  }
  function set(v) { factor.target = Math.min(1, Math.max(0, v)); }
  function tick(dt) {
    if (Math.abs(factor.v - factor.target) > 1e-3) {
      factor.v += (factor.target - factor.v) * Math.min(1, dt * 6.5);
      apply(factor.v);
      return true;
    } else if (factor.v !== factor.target) { factor.v = factor.target; apply(factor.v); return true; }
    return false;
  }
  return { set, get value() { return factor.v; }, apply, tick };
}
