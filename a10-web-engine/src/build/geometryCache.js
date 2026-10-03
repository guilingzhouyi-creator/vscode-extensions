/**
 * Ref-counted geometry cache: identical construction parameters share one GPU buffer.
 * Mirror-clone geometries register against their source so dispose is total (tests assert
 * refs hit zero after lifecycle.dispose()).
 */
export function createGeometryCache() {
  const map = new Map(); // key -> { geom, refs }
  let created = 0, hits = 0;

  function get(key, factory) {
    let e = map.get(key);
    if (e) { e.refs++; hits++; return e.geom; }
    const geom = factory();
    geom.name = `geo:${key}`;
    e = { geom, refs: 1 };
    map.set(key, e);
    created++;
    return geom;
  }
  function release(key) {
    const e = map.get(key);
    if (!e) return false;
    if (--e.refs <= 0) {
      e.geom.dispose();
      map.delete(key);
      return true;
    }
    return false;
  }
  function disposeAll() {
    for (const e of map.values()) e.geom.dispose();
    map.clear();
  }
  return {
    get, release, disposeAll,
    stats: () => ({ live: map.size, created, sharedHits: hits }),
    _map: map,
    /** total triangle count of live geometries (unique, not per-instance) */
    triangles: () => {
      let t = 0;
      for (const { geom } of map.values()) {
        const idx = geom.getIndex();
        t += (idx ? idx.count : (geom.getAttribute('position')?.count || 0)) / 3;
      }
      return Math.round(t);
    }
  };
}
