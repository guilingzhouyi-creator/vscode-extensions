/**
 * Material & texture factory.
 *  - ONE material instance per key (shared across every part) — enforced & asserted in tests
 *  - procedural canvas textures generated lazily, cached, disposed centrally
 *  - node/headless-safe: pass { noTextures: true } to skip DOM usage (tests + design-sheet builds)
 */
import * as THREE from 'three';
import { MATERIALS, TEXTURES, LIVERIES, PAINT_DETAILS } from '../spec/materialsSpec.js';
import { makeRng } from '../spec/constants.js';

export function createMaterialFactory({ noTextures = false, livery = 'europe1' } = {}) {
  const cache = new Map();      // key -> THREE.Material
  const textures = new Map();   // texture-key -> THREE.Texture
  const disposers = [];

  function getTexture(key) {
    if (noTextures || typeof document === 'undefined') return null;
    if (textures.has(key)) return textures.get(key);
    const spec = TEXTURES[key];
    if (!spec) return null;
    const tex = paintTexture(spec);
    textures.set(key, tex);
    return tex;
  }

  function paintTexture(spec) {
    const size = spec.size || 512;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const c = cv.getContext('2d');
    const rng = makeRng(42 + size);
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    c.fillStyle = hex(spec.cols[0]);
    c.fillRect(0, 0, size, size);

    if (spec.kind === 'camo') {
      // Europe-1 style large soft blobs, 2 extra colours
      for (let ci = 1; ci < spec.cols.length; ci++) {
        c.fillStyle = hex(spec.cols[ci]);
        for (let b = 0; b < 7; b++) {
          const x = rng() * size, y = rng() * size;
          c.beginPath();
          const steps = 14, rad = size * (0.08 + rng() * 0.16);
          for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            const r = rad * (0.55 + 0.75 * rng());
            const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.8;
            i ? c.lineTo(px, py) : c.moveTo(px, py);
          }
          c.closePath(); c.fill();
        }
      }
      // panel lines + faint stencils baked into paint (seams are painted; RIVETS are real geometry)
      c.strokeStyle = `rgba(0,0,0,${PAINT_DETAILS.panelLines.alpha})`;
      c.lineWidth = PAINT_DETAILS.panelLines.width;
      const rows = 8, colsN = 6;
      for (let i = 1; i < rows; i++) { c.beginPath(); c.moveTo(0, (i / rows) * size); c.lineTo(size, (i / rows) * size); c.stroke(); }
      for (let i = 1; i < colsN; i++) {
        const x = (i / colsN) * size;
        c.beginPath();
        for (let y = 0; y <= size; y += 16) c.lineTo(x + (rng() - 0.5) * 8, y);
        c.stroke();
      }
      c.fillStyle = 'rgba(230,230,225,0.5)';
      c.font = `600 ${Math.round(size / 34)}px Arial`;
      const st = PAINT_DETAILS.stencils;
      for (let i = 0; i < 7; i++) c.fillText(st[i % st.length], rng() * size * 0.7, rng() * size * 0.9);
      // low-vis national insignia block, centre-right
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(size * 0.62, size * 0.36, size * 0.26, size * 0.11);
      c.fillStyle = 'rgba(20,24,28,0.35)';
      c.fillRect(size * 0.63, size * 0.37, size * 0.1, size * 0.09);
      c.fillRect(size * 0.75, size * 0.37, size * 0.12, size * 0.09);
      c.save();
      c.translate(size * 0.68, size * 0.415); c.fillStyle = 'rgba(190,196,203,0.35)';
      c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 10; const r = i % 2 ? 7 : 16; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fill(); c.restore();
      // subtle grain
      c.globalAlpha = 0.05;
      for (let i = 0; i < 900; i++) { c.fillStyle = rng() > 0.5 ? '#000' : '#fff'; c.fillRect(rng() * size, rng() * size, 1.6, 1.6); }
      c.globalAlpha = 1;
    } else if (spec.kind === 'noise') {
      c.fillStyle = hex(spec.cols[0]); c.fillRect(0, 0, size, size);
      c.fillStyle = hex(spec.cols[1]);
      for (let i = 0; i < 2200; i++) c.fillRect(rng() * size, rng() * size, 2, 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function material(key) {
    if (cache.has(key)) return cache.get(key);
    const spec = MATERIALS[key];
    if (!spec) throw new Error(`unknown material key: ${key}`);
    const p = { ...spec.pbr };
    if (spec.texture) { const _t = getTexture(spec.texture); if (_t) p.map = _t; }
    if (spec.pbr.side === 'double') p.side = THREE.DoubleSide;
    const mat = new THREE.MeshStandardMaterial(p);
    mat.name = `mat:${key}`;
    mat.userData.matKey = key;
    cache.set(key, mat);
    return mat;
  }

  function setLivery(id) {
    const lv = LIVERIES[id]; if (!lv) return;
    const apply = (key, texKey, col) => {
      const m = cache.get(key); if (!m) return;
      const t = getTexture(texKey);
      m.map = t || null; m.color.setHex(col); m.needsUpdate = true;
    };
    apply('airframeTop', lv.top, lv.base.top);
    apply('airframeLat', lv.lat, lv.base.lat);
    apply('airframeBot', lv.bot, lv.base.bot);
  }

  function dispose() {
    for (const m of cache.values()) m.dispose();
    for (const t of textures.values()) t.dispose();
    cache.clear(); textures.clear();
    for (const d of disposers) d();
  }

  return { material, setLivery, dispose, get count() { return cache.size; }, _cache: cache };
}
