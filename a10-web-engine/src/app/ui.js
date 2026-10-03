/**
 * UI — DOM controller for index.html. Every control maps to exactly ONE engine API call
 * (rig / picker / cutaway / exploded / livery / LOD / loadout / damage); no model logic here.
 */
import { ASSEMBLIES, PART_REGISTRY } from '../spec/partTree.js';
import { LOADOUTS } from '../spec/storesSpec.js';
import { generateSVG } from './designSheet.js';
import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

export function createUI({ model, viewer, rig, exploded, picker, cutaway, damage }) {
  // toast element (self-created; HTML stays lean)
  let toastEl = $('#toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.style.cssText = 'position:absolute;left:50%;bottom:46px;transform:translateX(-50%);background:rgba(20,24,31,.94);border:1px solid #2a3442;color:#cfd8e3;padding:6px 14px;border-radius:8px;font-size:12px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:40';
    document.body.appendChild(toastEl);
  }
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.style.opacity = 1;
    clearTimeout(toast._h);
    toast._h = setTimeout(() => (toastEl.style.opacity = 0), 2600);
  };

  // ── exploded ────────────────────────────────────────────────────────────
  $('#sl-explode').addEventListener('input', (e) => {
    exploded.set(+e.target.value);
    $('#o-explode').textContent = `${Math.round(+e.target.value * 100)}%`;
  });

  // ── cutaway ─────────────────────────────────────────────────────────────
  const cutSliders = { x: '#sl-cutx', y: '#sl-cuty', z: '#sl-cutz' };
  const cutOuts = { x: '#o-cutx', y: '#o-cuty', z: '#o-cutz' };
  for (const [axis, sel] of Object.entries(cutSliders)) {
    $(sel).addEventListener('input', (e) => {
      const v = +e.target.value;
      $(cutOuts[axis]).textContent = v.toFixed(2);
      cutaway.set(axis, v);
      if (cutaway.state[axis].on) { /* live */ } else if (v < (+e.target.max || 16)) cutaway.toggle(axis, true);
      $(`#btn-cut${axis}`)?.classList.toggle('on', cutaway.state[axis].on);
    });
  }
  for (const axis of ['x', 'y', 'z']) {
    $(`#btn-cut${axis}`).addEventListener('click', () => {
      const on = cutaway.toggle(axis);
      $(`#btn-cut${axis}`).classList.toggle('on', on);
      if (on) { cutaway.set(axis, +$(cutSliders[axis]).value); $(cutOuts[axis]).textContent = (+$(cutSliders[axis]).value).toFixed(2); }
    });
  }
  $('#btn-cutsides').addEventListener('click', (e) => {
    const on = cutaway.toggleYPair();
    e.currentTarget.classList.toggle('on', on);
    if (on) $('#btn-cuty').classList.add('on');
    toast(on ? '左右对称剖切' : '半剖');
  });

  // x-ray: paint materials go ghost (shared materials → ONE flip, whole airframe)
  const ghosted = new Map();
  $('#btn-xray').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    const PAINT = new Set(['airframeTop', 'airframeLat', 'airframeBot', 'airframe', 'cowl', 'cowlGrey', 'podGrey', 'titanium']);
    model.root.traverse((o) => {
      const m = o.material;
      if (!m || ghosted.has(m)) {
        if (m && ghosted.has(m)) {
          if (on) { m.transparent = true; m.opacity = 0.14; m.depthWrite = false; }
          else { const b = ghosted.get(m); m.transparent = b.t; m.opacity = b.o; m.depthWrite = true; }
        }
        return;
      }
      if (!m.userData?.matKey) return;
      if (!PAINT.has(m.userData.matKey)) return;
      ghosted.set(m, { t: m.transparent, o: m.opacity });
      if (on) { m.transparent = true; m.opacity = 0.14; m.depthWrite = false; }
    });
    viewer.invalidateShadow();
    toast(on ? 'X光：蒙皮透明化' : 'X光：关闭');
  });

  // ── rig sliders ─────────────────────────────────────────────────────────
  const sliders = {
    'sl-flap': ['flaps', (v) => ` ${(v * 40).toFixed(0)}°`],
    'sl-ail': ['aileron', (v) => ` ${(v * 20).toFixed(0)}°`],
    'sl-sp': ['spoileron', (v) => ` ${(v * 25).toFixed(0)}°`],
    'sl-elev': ['elevator', (v) => ` ${(v * 25).toFixed(0)}°`],
    'sl-rud': ['rudder', (v) => ` ${(v * 30).toFixed(0)}°`],
    'sl-canopy': ['canopy', (v) => ` ${(v * 62).toFixed(0)}°`],
    'sl-n1': ['n1', (v) => ` ${(v * 100).toFixed(0)}%`],
    'sl-gun': ['gun', (v) => ` ${(v * 3900 / 60).toFixed(0)} rpm`]
  };
  for (const [id, [ch, fmt]] of Object.entries(sliders)) {
    const el = $(`#${id}`);
    el.addEventListener('input', (e) => {
      const v = +e.target.value;
      rig.command(ch, v);
      const o = document.getElementById(id.replace('sl-', 'o-'));
      if (o) o.textContent = fmt(v);
    });
  }

  // ── rig buttons: data-rig="channel" data-v="0|1" ───────────────────────
  $$('[data-rig]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ch = btn.dataset.rig, v = +(btn.dataset.v ?? 1);
      if (ch === 'stations') {
        for (const pid of ['hp.pylon', 'hp.rail']) {
          const g = model.groups.get(pid);
          if (g) g.visible = !!v;
        }
        btn.classList.toggle('on', !!v);
        btn.textContent = v ? '开' : '关';
        return;
      }
      const r = rig.command(ch, v);
      // exclusive .on within the same row
      if (btn.closest('.row')) btn.closest('.row').querySelectorAll('[data-rig]').forEach((q) => q.classList.toggle('on', q === btn));
      if (ch === 'canopy') { $('#sl-canopy').value = r.canopy; $('#o-canopy').textContent = ` ${(r.canopy * 62).toFixed(0)}°`; }
      if (ch === 'nacelle') { $('#sl-nacelle') && ($('#sl-nacelle').value = r.nacelle); }
      viewer.invalidateShadow();
    });
  });
  // gear buttons in index.html carry data-rig gear + data-v — handled above; init pose:
  rig.command('gear', 0);

  // ── loadout ─────────────────────────────────────────────────────────────
  $$('[data-loadout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      model.ctx.loadout?.clearLoadout();
      model.ctx.loadout?.applyLoadout(btn.dataset.loadout);
      $$('[data-loadout]').forEach((q) => q.classList.toggle('on', q === btn));
      toast(`挂架方案：${LOADOUTS[btn.dataset.loadout]?.name || ''}`);
      viewer.invalidateShadow();
    });
  });

  // ── LOD / perf ──────────────────────────────────────────────────────────
  $$('[data-lod]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.lod;
      if (v === 'auto') { model.lodPolicy.mode = 'auto'; }
      else { model.lodPolicy.mode = 'force'; model.setLod(+v); }
      $$('[data-lod]').forEach((q) => q.classList.toggle('on', q === btn));
      viewer.invalidateShadow();
    });
  });
  $('#btn-rivets').addEventListener('click', (e) => {
    const on = !model.rivetsOn;
    model.setRivets(on);
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.textContent = on ? '开' : '关';
    viewer.invalidateShadow();
  });
  $('#btn-ground').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('on');
    viewer.setGround(on);
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.textContent = on ? '开' : '关';
  });
  $('#btn-shadow').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('on');
    viewer.setShadows(on);
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.textContent = on ? '开' : '关';
    viewer.invalidateShadow();
  });

  // ── part tree ───────────────────────────────────────────────────────────
  const tree = $('#part-tree');
  for (const asm of ASSEMBLIES) {
    const kids = (asm.parts || asm.children || []).map((cid) => {
      const c = PART_REGISTRY.get(cid);
      if (!c) return '';
      return `<div class="node" data-part="${cid}" title="${(c.desc || c.name).replace(/"/g, '&quot;')}">${c.name_zh} · ${c.name}</div>`;
    }).join('');
    const grp = document.createElement('div');
    grp.innerHTML = `<div class="grp" data-asm="${asm.id}"><span class="dot live"></span> ${asm.name_zh} <span style="color:var(--dim)">${asm.name}</span></div><div class="kids">${kids}</div>`;
    tree.appendChild(grp);
  }
  $('#btn-collapse').addEventListener('click', () => {
    const open = $$('#part-tree .kids').some((k) => k.style.display !== 'none');
    $$('#part-tree .kids').forEach((k) => (k.style.display = open ? 'none' : ''));
  });
  tree.addEventListener('click', (e) => {
    const n = e.target.closest('[data-part]');
    const a = e.target.closest('[data-asm]');
    if (n) {
      const g = model.groups.get(n.dataset.part);
      if (g) {
        picker.select(g);
        showInfo(picker.info(g));
        $$('#part-tree .node.sel').forEach((q) => q.classList.remove('sel'));
        n.classList.add('sel');
      }
    } else if (a) {
      const root = model.assemblyRoots.get(a.dataset.asm);
      if (root) {
        root.visible = !root.visible;
        a.style.opacity = root.visible ? 1 : 0.4;
        viewer.invalidateShadow();
      }
    }
  });

  // ── info card (in right panel per index.html) ──────────────────────────
  const info = $('#part-info');
  const srcTag = (s) => `<span class="tag ${s}">${{ doc: 'documentation', der: 'derived', eng: 'engineering', est: 'estimate' }[s] || s}</span>`;
  function showInfo(d) {
    info.innerHTML = `
      <b>部件</b><span>${d.name_zh} · ${d.name}</span>
      <b>ID</b><span style="word-break:break-all">${d.id}</span>
      <b>装配</b><span>${d.assembly}${d.station ? ` @ ${d.station}` : ''}</span>
      ${d.mass ? `<b>质量</b><span>${d.mass} kg</span>` : ''}
      <b>数据源</b><span>${srcTag(d.src)}</span>
      ${d.desc ? `<b>说明</b><span>${d.desc}</span>` : ''}
      <b>BBox</b><span>${d.box.map((v) => v.toFixed(2)).join(' × ')} m</span>`;
  }

  // ── canvas picking ──────────────────────────────────────────────────────
  let down = null;
  viewer.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  viewer.renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 5 || dmgArmed) return;
    const hit = picker.pick(e.clientX, e.clientY);
    if (hit) {
      picker.select(hit.group);
      showInfo(picker.info(hit.group));
      const node = tree.querySelector(`[data-part="${hit.group.userData.partId}"]`);
      $$('#part-tree .node.sel').forEach((q) => q.classList.remove('sel'));
      node?.classList.add('sel');
      node?.scrollIntoView({ block: 'nearest' });
    } else {
      picker.clearHighlight();
    }
  });

  // ── damage ──────────────────────────────────────────────────────────────
  let dmgArmed = false, seed = 987654321;
  const rng = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  function dmgCount() { $('#dmg-count').textContent = `${damage.count()} hits`; }
  $('#btn-dmg-hit').addEventListener('click', () => {
    // cycle: first click → arm pick-to-damage; subsequent → random hit
    dmgArmed = !dmgArmed;
    $('#btn-dmg-hit').classList.toggle('on', dmgArmed);
    if (!dmgArmed) return;
    viewer.renderer.domElement.style.cursor = 'crosshair';
    toast('点击机体施加战损 · click airframe');
  });
  viewer.renderer.domElement.addEventListener('click', (e) => {
    if (!dmgArmed) return;
    const hit = picker.pick(e.clientX, e.clientY);
    const r = damage.applyHit(hit ? { partId: hit.group.userData.partId, point: hit.point, normal: hit.normal || undefined, rng } : { rng });
    if (r) toast(`${r.partId} → ${r.knockedOut ? 'KNOCKED OUT（机构锁定）' : `HP ${r.hpLeft | 0}`}`);
    dmgCount();
    viewer.invalidateShadow();
  });
  $('#btn-dmg-clear').addEventListener('click', () => {
    damage.clear();
    dmgArmed = false;
    $('#btn-dmg-hit').classList.remove('on');
    viewer.renderer.domElement.style.cursor = '';
    dmgCount();
    toast('战损修复');
  });

  // ── views / livery / sheet / shot ───────────────────────────────────────
  const presets = {
    iso: [[17, 9, 20], [8.06, 2.0, 0]], side: [[8.06, 2.4, -26], [8.06, 2.0, 0]],
    front: [[-16, 3.2, 0.02], [8, 2.2, 0]], top: [[8.06, 36, 0.02], [8.06, 1.0, 0]]
  };
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    const [p, t] = presets[b.dataset.view] || presets.iso;
    tweenCam(new THREE.Vector3(...p), new THREE.Vector3(...t));
  }));
  function tweenCam(pos, target) {
    const p0 = viewer.cam.position.clone(), t0 = viewer.controls.target.clone();
    const t1 = performance.now();
    (function step() {
      const k = Math.min(1, (performance.now() - t1) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      viewer.cam.position.lerpVectors(p0, pos, e);
      viewer.controls.target.lerpVectors(t0, target, e);
      if (k < 1) requestAnimationFrame(step);
    })();
  }
  $('#sel-livery').addEventListener('change', (e) => {
    model.materials.setLivery(e.target.value);
    toast(`涂装：${e.target.value}`);
  });
  let sheetSVG = null;
  $('#btn-sheet').addEventListener('click', () => {
    if (!sheetSVG) {
      try { sheetSVG = generateSVG(); } catch (e) { sheetSVG = `<pre>sheet error: ${e.message}</pre>`; }
      document.getElementById('sheet-contents').innerHTML = sheetSVG;
    }
    $('#sheet-modal').classList.add('show');
  });
  $('#btn-sheet-close').addEventListener('click', () => $('#sheet-modal').classList.remove('show'));
  $('#btn-sheet-dl')?.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sheetSVG || generateSVG()], { type: 'image/svg+xml' }));
    a.download = 'A-10C-design-sheet.svg';
    a.click();
  });
  $('#btn-shot').addEventListener('click', () => {
    viewer.render();
    const a = document.createElement('a');
    a.href = viewer.renderer.domElement.toDataURL('image/png');
    a.download = 'a10-view.png';
    a.click();
    toast('已保存 PNG');
  });

  // expose for main.js extras
  return { toast, showInfo, tweenCam, presets, dmgCount };
}
