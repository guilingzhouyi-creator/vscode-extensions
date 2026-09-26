/**
 * MAIN — composition root. Wires engine modules to the DOM; holds no geometry logic.
 * window.__A10 exposes the public API surface (rig, picker, cutaway, damage, LOD, loadout).
 */
import { createViewer } from './viewer.js';
import { createModelStaged } from '../build/lifecycle.js';
import { createRig } from '../interaction/rig.js';
import { createExplodedView } from '../interaction/explodedView.js';
import { createPicker } from '../interaction/picker.js';
import { createCutaway } from '../interaction/cutaway.js';
import { createDamage } from '../interaction/damage.js';
import { createUI } from './ui.js';
import { generateSVG } from './designSheet.js';
import * as THREE from 'three';
import { AIRCRAFT_TO_WORLD } from '../spec/constants.js';

async function boot() {
  const container = document.getElementById('viewport');
  const err = document.getElementById('err');
  const statsEl = document.getElementById('stats');
  statsEl.innerHTML = '<b>构建中…</b> lofting fuselage/wing/tail from spec tables';

  const viewer = createViewer(container);
  const model = await createModelStaged({ level: 0, rivets: true, livery: 'europe1' }, (p) => {
    statsEl.innerHTML = `<b>构建中…</b> ${p.label} ${Math.round(p.pct * 100)}%`;
  });

  // world orientation: ONE root rotation (aircraft z-up → three Y-up)
  model.root.applyMatrix4(new THREE.Matrix4().makeRotationX(AIRCRAFT_TO_WORLD.rotX));
  viewer.scene.add(model.root);

  const rig = createRig(model);
  const exploded = createExplodedView(model);
  const picker = createPicker(model, viewer.scene, viewer.cam, viewer.renderer.domElement);
  const cutaway = createCutaway(viewer.renderer);
  const damage = createDamage(model, rig);
  const ui = createUI({ model, viewer, rig, exploded, picker, cutaway, damage });

  // initial state matching index.html defaults
  model.ctx.loadout?.applyLoadout('cas');
  rig.command('n1', 0.1);

  const c = model.counts();
  statsEl.innerHTML =
    `<b>A-10C</b> ${model.partDefs.size} parts · ${c.meshes} meshes · ${c.instanced} inst · ${c.trisTotal.toLocaleString()} tris · geo ${c.uniqueGeoms} shared`;
  ui.toast('模型就绪 · 点击部件查看 · 拖拽旋转');

  // console API surface (also documented in README)
  window.__A10 = { model, viewer, rig, exploded, picker, cutaway, damage, THREE };

  addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.key === 'Escape') { document.getElementById('sheet-modal').classList.remove('show'); picker.clearHighlight(); }
    if (e.key.toLowerCase() === 'x') { const s = document.getElementById('sl-explode'); s.value = +s.value > 0 ? '0' : '0.8'; s.dispatchEvent(new Event('input')); }
    if (e.key.toLowerCase() === 'g') document.querySelector('[data-rig="gear"][data-v="1"]')?.click();
    if (e.key.toLowerCase() === 'shift+g') void 0;
    if (e.key === 'G' && e.shiftKey) document.querySelector('[data-rig="gear"][data-v="0"]')?.click();
  });

  // ── frame loop ──────────────────────────────────────────────────────────
  let last = performance.now(), hudAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    viewer.controls.update();
    let anim = exploded.tick(dt);
    rig.update(dt);
    if (rig.state.n1 > 0.001 || rig.state.wheelSpin > 0) anim = true;
    const dist = viewer.cam.position.distanceTo(viewer.controls.target);
    if (model.autoLod(dist)) anim = true;
    if (anim) viewer.invalidateShadow();
    viewer.render();
    hudAcc += dt;
    if (hudAcc > 0.35) {
      hudAcc = 0;
      const v = viewer.stats();
      statsEl.innerHTML = `tri <b>${(v.tris / 1000).toFixed(0)}k</b> · calls <b>${v.calls}</b> · geo <b>${v.geoms}</b> · tex <b>${v.textures}</b> · LOD <b>${model.lod}</b> · cam ${dist.toFixed(0)}m · rivets ${model.rivetsOn ? 'on' : 'off'}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('err');
  el.style.display = 'block';
  el.textContent = 'BUILD FAILED: ' + (e.stack || e.message);
});
