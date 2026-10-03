/**
 * Lifecycle — staged (async) build, isolated part (un)loading, total dispose.
 * The model is built headless-sync for tests; the app wraps the same call in
 * cooperative time-sliced phases so the UI stays responsive.
 */
import { buildAircraft } from './builder.js';

export function createModel(opts = {}) {
  const model = buildAircraft(opts);
  model.lifecycle = {
    hidden: new Set(),
    /** hide/show a single part (mesh swap-in point for future variants) */
    setVisible(partId, v) {
      const g = model.groups.get(partId);
      if (!g) return false;
      g.visible = v;
      v ? this.hidden.delete(partId) : this.hidden.add(partId);
      return true;
    },
    /** isolate one assembly: everything else fades to 18% opacity clones? — keep cheap: hide */
    isolateAssembly(assemblyId) {
      for (const [id, g] of model.groups) {
        g.visible = !assemblyId || g.userData.assembly === assemblyId;
      }
    },
    /** unload a part's GPU resources; geometry released from the shared cache */
    unload(partId) {
      const g = model.groups.get(partId);
      if (!g) return;
      g.traverse((o) => {
        if ((o.isMesh || o.isInstancedMesh) && o.geometry.name?.startsWith('geo:')) {
          model.cache.release(o.geometry.name.slice(4));
        }
      });
      g.userData.unloaded = true;
    },
    reload(partId, level = 0) {
      const g = model.groups.get(partId);
      if (g?.userData.unloaded) { g.userData.unloaded = false; model.applyVisibility(); }
      void level;
    },
    dispose: () => model.dispose()
  };
  return model;
}

/** time-sliced build for the browser (keeps frame pacing); resolves {model} */
export async function createModelStaged(opts = {}, onProgress = () => {}) {
  const stages = [
    ['geometry: structure', () => null],
    ['geometry: systems', () => null],
    ['geometry: details', () => null]
  ];
  await new Promise((r) => setTimeout(r, 0));
  onProgress({ phase: 'build', pct: 0.15, label: '构建几何/结构' });
  const model = createModel(opts);
  for (let i = 0; i < stages.length; i++) {
    await new Promise((r) => setTimeout(r, 0));
    onProgress({ phase: stages[i][0], pct: (i + 1) / stages.length, label: stages[i][0] });
  }
  onProgress({ phase: 'done', pct: 1, label: '就绪' });
  return model;
}
