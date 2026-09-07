/**
 * PICKER — raycast to the *visible* mesh, resolve to registry part (walk up userData.partId),
 * highlight via a SHARED override material (never clones per-mesh materials), and emit
 * the part metadata (name/station/provenance) for the inspector.
 */
import * as THREE from 'three';

export function createPicker(model, scene, camera, dom) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hiMat = new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0x8a5a00, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.96 });
  let selected = null;
  const restore = [];

  function partOf(obj) {
    let o = obj;
    while (o) { if (o.userData?.partId) return o; o = o.parent; }
    return null;
  }

  function pick(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(model.root, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const pg = partOf(h.object);
      if (pg && pg.visible) return { group: pg, hit: h, point: h.point, normal: h.face ? new THREE.Vector3().copy(h.face.normal).transformDirection(h.object.matrixWorld) : null };
    }
    return null;
  }

  function clearHighlight() {
    for (const { mesh, mat } of restore) mesh.material = mat;
    restore.length = 0;
    selected = null;
  }
  /** select by part group OR part id; highlights EVERY drawable tagged with the id
   *  (rig parts may live under another part's pivot, e.g. barrels under carrier) */
  function select(groupOrId) {
    clearHighlight();
    const id = typeof groupOrId === 'string' ? groupOrId : groupOrId?.userData?.partId;
    if (!id) return;
    selected = typeof groupOrId === 'string' ? model.groups.get(id) : groupOrId;
    model.root.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.userData.partId === id && o.visible && o.parent?.visible) {
        restore.push({ mesh: o, mat: o.material });
        o.material = hiMat;
      }
    });
  }
  function info(group) {
    const d = group.userData;
    return {
      id: d.partId, name: d.name, name_zh: d.name_zh, assembly: d.assembly,
      station: d.station, src: d.src, mass: d.mass, desc: d.desc, bucket: d.bucket,
      box: new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).multiplyScalar(1).toArray()
    };
  }
  function dispose() { hiMat.dispose(); clearHighlight(); }
  return { pick, select, clearHighlight, info, dispose, get selected() { return selected; } };
}
