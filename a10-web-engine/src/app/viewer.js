/**
 * VIEWER — renderer/scene/light rig + orbit controls + stats. Deliberately tiny:
 * it never knows about A-10 specifics; everything aircraft-related comes from build/.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false; // off by default (UI toggle; perf)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // manual invalidation — perf discipline
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e12);
  scene.fog = new THREE.Fog(0x0b0e12, 60, 190);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const cam = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 400);
  cam.position.set(15, 9, 19);

  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.set(8.06, 1.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxDistance = 120;
  controls.minDistance = 1.6;

  const hemi = new THREE.HemisphereLight(0x9fb4d0, 0x23262a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.set(14, 22, -10);
  sun.castShadow = false;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x90a8c8, 0.5);
  fill.position.set(-12, 6, 14);
  scene.add(fill);

  // ground: grid texture baked on canvas (reused), shadow catcher
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x12161c, roughness: 0.96, metalness: 0.02 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(120, 60, 0x2a3542, 0x1a222c);
  grid.position.y = 0.002;
  scene.add(grid);
  // aircraft axes marker at nose
  const axes = new THREE.AxesHelper(2.2);
  axes.position.set(0, 0.01, 0);
  scene.add(axes);

  function setGround(on) { ground.visible = on; grid.visible = on; }
  function setShadows(on) {
    renderer.shadowMap.enabled = on;
    renderer.shadowMap.needsUpdate = true;
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function frame(dist = 26) {
    const d = cam.position.distanceTo(controls.target);
    void d; void dist;
  }
  function invalidateShadow() { renderer.shadowMap.needsUpdate = true; }

  function stats() {
    const i = renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries, textures: i.memory.textures, progs: i.programs?.length || 0 };
  }
  function render() { renderer.render(scene, cam); }
  function dispose() {
    renderer.dispose(); pmrem.dispose();
    ground.geometry.dispose(); groundMat.dispose();
  }
  return { renderer, scene, cam, controls, sun, setGround, setShadows, resize, render, stats, invalidateShadow, frame, dispose };
}
