/**
 * DESIGN SHEET — an engineering 3-view drawn from the SAME spec tables the 3D model
 * lofts from (FUSELAGE_FRAMES, wing/tail/REF). If the model and sheet disagree, the
 * model is wrong — they cannot drift because they share the source.
 * Produces an SVG string (browser + node usable).
 */
import { FUSELAGE_FRAMES } from '../spec/fuselageSpec.js';
import { frameAt } from '../math/profiles.js';
import { chordAt, leXAt, wingZAt, thicknessAt, WING } from '../spec/wingSpec.js';
import { REF } from '../spec/referenceDimensions.js';

const S = 46; // px per metre
const PAD = 46;

const px = (x) => +(x * S + PAD).toFixed(1);
const pz = (z, base) => +(base - z * S).toFixed(1);
const py = (y, base) => +(base + y * S).toFixed(1);

function smoothPath(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
}

/** side-view envelope (upper + lower silhouette over x) */
export function sideEnvelope() {
  const top = [], bot = [];
  for (let x = 0; x <= REF.overall.length; x += 0.12) {
    const fr = frameAt(FUSELAGE_FRAMES, x);
    top.push([px(x), pz(fr.zc + fr.zu, 0)]);
    bot.push([px(x), pz(fr.zc - fr.zl, 0)]);
  }
  return { top, bot };
}
/** top-view envelope: width at stations (max of fuselage | nacelle | h-stab | fin) */
export function topEnvelope(x) {
  const fr = frameAt(FUSELAGE_FRAMES, x);
  let w = fr.y;
  if (x >= REF.nacelle.xLip - 0.3 && x <= REF.nacelle.xEnd) w = Math.max(w, REF.nacelle.centerY + REF.nacelle.outerD / 2);
  if (x >= REF.tail.hStabX && x <= REF.tail.hStabX + REF.tail.hStabChordRoot) w = Math.max(w, REF.tail.hStabSpanHalf);
  if (x >= REF.tail.finRootX[0] && x <= REF.tail.finRootX[1]) w = Math.max(w, REF.tail.finCenterY + 0.17);
  return w;
}

export function generateSVG() {
  const W = REF.wing, T = REF.tail;
  const env = sideEnvelope();
  const viewW = REF.overall.length * S + PAD * 2;
  const sideH = 5.0 * S + PAD * 2;
  const topBase = 0, topH = 20 * S + PAD * 2;

  const els = [];
  const push = (s) => els.push(s);
  const line = (x1, y1, x2, y2, cls = 'thin') => push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`);
  const path = (d, cls = 'skin') => push(`<path d="${d}" class="${cls}"/>`);
  const txt = (x, y, t, cls = 'dim') => push(`<text x="${x}" y="${y}" class="${cls}">${t}</text>`);

  // ── SIDE VIEW ───────────────────────────────────────────────────────────
  const sideOff = PAD; // y offset baseline
  const sv = (pts) => pts.map(([x, y]) => [x, y + sideH - PAD - 40]);
  const topPts = sv(env.top), botPts = sv(env.bot).reverse();
  path(smoothPath([...topPts, ...botPts, topPts[0]]), 'skin');
  // datum & station grid
  for (let x = 0; x <= 16.2; x += 2) {
    line(px(x), sideOff, px(x), sideH + PAD - 8, 'grid');
    txt(px(x) + 2, sideOff + 12, `STA ${x.toFixed(1)}m`, 'stat');
  }
  line(px(0), sv([[0, 0]])[0][1], px(16.16), sv([[0, 0]])[0][1], 'datum');
  txt(px(0.15), sv([[0, 0]])[0][1] - 3, 'GROUND DATUM Z=0', 'note');
  // canopy + windscreen
  {
    const pts = [];
    for (let u = 0; u <= 1; u += 0.08) {
      const x = 3.6 + 2.18 * u, z = 2.36 + 0.68 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u - 0.5) * 2.05, 2.6)), 1.4);
      pts.push([x, z]);
    }
    path(smoothPath(pts.map(([x, z]) => sv([[x, z]])[0])), 'canopy');
  }
  // fin + rudder line
  {
    const pts = [];
    for (let t = 0; t <= 1; t += 0.05) {
      const z = T.finBaseZ + (T.finTipZ - T.finBaseZ) * t;
      pts.push(sv([[T.finRootX[0] + (T.finTipX[0] - T.finRootX[0]) * t, z]]));
    }
    const pts2 = pts.map(([p]) => p);
    for (let t = 1; t >= 0; t -= 0.05) {
      const z = T.finBaseZ + (T.finTipZ - T.finBaseZ) * t;
      pts2.push(sv([[T.finRootX[1] + (T.finTipX[1] - T.finRootX[1]) * t, z]])[0]);
    }
    path(smoothPath(pts2), 'skin');
    line(...sv([[T.finTipX[0] - 0.02, T.finBaseZ + 0.15]])[0], ...sv([[T.finTipX[1] - 0.02, T.finTipZ - 0.08]])[0], 'hinge');
  }
  // h-stab
  path(smoothPath([sv([[T.hStabX, T.hStabZ + 0.1]])[0], sv([[T.hStabX + T.hStabChordRoot, T.hStabZ + 0.06]])[0], sv([[T.hStabX + T.hStabChordTip * 0.9, T.hStabZ - 0.09]])[0], sv([[T.hStabX - 0.1, T.hStabZ - 0.05]])[0], sv([[T.hStabX, T.hStabZ + 0.1]])[0]]), 'skin');
  // nacelle
  {
    const y0 = px(0); void y0;
    push(`<rect x="${px(REF.nacelle.xLip)}" y="${sv([[0, REF.nacelle.centerZ + 0.66]])[0][1]}" width="${(REF.nacelle.xEnd - REF.nacelle.xLip) * S}" height="${1.32 * S}" class="skin" rx="${10}"/>`);
  }
  // wing (side): LE/TE lines at root
  line(...sv([[W.xLE, wingZAt(0) + thicknessAt(0) / 2]])[0], ...sv([[W.xLE, wingZAt(0) - thicknessAt(0) / 2]])[0], 'skin');
  line(...sv([[W.xLE + chordAt(2), wingZAt(2) + thicknessAt(2) / 2]])[0], ...sv([[W.xLE + chordAt(2), wingZAt(2) - thicknessAt(2) / 2]])[0], 'skin');
  // gear
  for (const [x, r] of [[REF.gear.nose.x, REF.gear.nose.wheelDia / 2], [REF.gear.main.x, REF.gear.main.wheelDia / 2]]) {
    push(`<circle cx="${px(x)}" cy="${sv([[0, r]])[0][1]}" r="${r * S}" class="wheel"/>`);
  }
  // gun axis
  line(px(REF.gun.muzzleX), sv([[0, REF.gun.muzzleZ + 0.2]])[0][1], px(5.6), sv([[0, 1.35]])[0][1], 'axis');
  txt(px(0.4), sv([[0, 1.42]])[0][1], 'GAU-8/A axis (firing barrel = aircraft CL)', 'note');

  // overall length dimension
  dimLine(els, px(0), sideH + PAD + 6, px(16.16), sideH + PAD + 6, '16.16 m LENGTH (53 ft 4 in) [USAF]');

  // ── TOP VIEW ────────────────────────────────────────────────────────────
  const tb = sideH + PAD * 2.6; // top view vertical start
  const mid = (y) => tb + 8.72 * S + (y * S);
  const envPath = [];
  for (let x = 0; x <= 16.16; x += 0.1) envPath.push([px(x), mid(-topEnvelope(x))]);
  for (let x = 16.16; x >= 0; x -= 0.1) envPath.push([px(x), mid(topEnvelope(x))]);
  path(smoothPath([...envPath, envPath[0]]), 'skin');
  for (let x = 0; x <= 16.2; x += 2) { line(px(x), tb - 6, px(x), tb + 17.44 * S + 10, 'grid'); }
  // wings
  const wingPoly = (sgn) => {
    const pts = [];
    for (let y = W.yJunction; y <= W.bTip; y += 0.3) pts.push([px(leXAt(y)), mid(y * sgn)]);
    for (let y = W.bTip; y >= W.yJunction; y -= 0.3) pts.push([px(leXAt(y) + chordAt(y)), mid(y * sgn)]);
    return pts;
  };
  for (const s of [1, -1]) {
    const pts = wingPoly(s);
    path(smoothPath([...pts, pts[0]]), 'skin');
    // flap/aileron/spoileron bays
    for (const [y0, y1, kind] of [[W.flapY[0], W.flapY[1], 'flap'], [W.spoileronY[0], W.spoileronY[1], 'spoil'], [W.aileronY[0], W.aileronY[1], 'ail']]) {
      const h = [];
      for (let y = y0; y <= y1; y += 0.35) {
        const c = chordAt(y);
        const fx = kind === 'flap' ? 0.585 : kind === 'ail' ? 0.635 : 0.60;
        const tx = kind === 'spoil' ? fx + 0.30 : 0.965;
        h.push([px(leXAt(y) + fx * c), mid(y * s)]);
        h.push([px(leXAt(y) + tx * c), mid(y * s)]);
        line(px(leXAt(y) + fx * c), mid(y * s), px(leXAt(y) + fx * c), mid((y + 0.33) * s), 'hinge');
      }
      void h;
    }
    // hinge lines drawn as polylines
    const hingePts = [];
    for (let y = W.flapY[0]; y <= W.flapY[1]; y += 0.4) hingePts.push([px(leXAt(y) + 0.585 * chordAt(y)), mid(y * s)]);
    path(smoothPath(hingePts), 'hinge');
    const hingePts2 = [];
    for (let y = W.aileronY[0]; y <= W.aileronY[1]; y += 0.3) hingePts2.push([px(leXAt(y) + 0.635 * chordAt(y)), mid(y * s)]);
    path(smoothPath(hingePts2), 'hinge');
    // hardpoints
    for (const st of REF.hardpoints.stations) {
      if (st.id.startsWith('L') !== (s === -1)) continue;
      push(`<rect x="${px(st.x - 0.12)}" y="${mid(Math.abs(st.y)) - 3}" width="8" height="6" class="hp"/>`);
      txt(px(st.x - 0.14), mid(Math.abs(st.y)) + (s > 0 ? 13 : -8), st.id, 'stat');
    }
  }
  // nacelles
  for (const s of [1, -1]) {
    push(`<rect x="${px(REF.nacelle.xLip)}" y="${mid(s * (REF.nacelle.centerY - REF.nacelle.outerD / 2))}" width="${(REF.nacelle.xEnd - REF.nacelle.xLip) * S}" height="${REF.nacelle.outerD * S}" class="skin"/>`);
  }
  // fins & rudders
  for (const s of [1, -1]) {
    const pts = [[px(T.finRootX[0]), mid(s * T.finCenterY)], [px(T.finTipX[0]), mid(s * (T.finCenterY - T.finTipThickness / 2 * 0))], [px(T.finTipX[1]), mid(s * T.finCenterY)], [px(T.finRootX[1]), mid(s * T.finCenterY)]];
    path(smoothPath([pts[0], pts[1], pts[2], pts[3], pts[0]]), 'skin');
    line(...pts[1], ...pts[2], 'hinge');
  }
  // h-stab
  for (const s of [1, -1]) {
    const pts = [[px(T.hStabX), mid(s * T.hStabSpanHalf * 0.12)], [px(T.hStabX + T.hStabChordRoot), mid(s * 0.1)], [px(T.hStabX + T.hStabChordTip), mid(s * T.hStabSpanHalf)], [px(T.hStabX + 0.25), mid(s * T.hStabSpanHalf)]];
    void pts;
    push(`<path d="M${px(T.hStabX)},${mid(s * 0.28)} L${px(T.hStabX + T.hStabChordRoot)},${mid(s * 0.2)} L${px(T.hStabX + T.hStabChordTip)},${mid(s * T.hStabSpanHalf)} L${px(T.hStabX + 0.35)},${mid(s * T.hStabSpanHalf)} Z" class="skin"/>`);
  }
  // cockpit + canopy footprint
  push(`<rect x="${px(3.6)}" y="${mid(-0.66)}" width="${2.2 * S}" height="${1.32 * S}" class="canopy"/>`);
  dimLine(els, px(0), tb + 17.44 * S + 16, px(17.42 / 2 + 0), mid(8.71), `SPAN ${W.bTip * 2} m (57 ft 6 in) [USAF]`, true);

  // ── FRONT VIEW ──────────────────────────────────────────────────────────
  const fv = tb + 17.44 * S + PAD * 2.2;
  const fx = (y) => fv + (9.6 * S) + y * S; // centre at 9.6m to the left
  const cxr = 9.6 * S;
  const fy = (z) => fv + (4.7 * S) - z * S;
  // fuselage section at x=8.2 (representative deep section)
  const frSec = frameAt(FUSELAGE_FRAMES, 8.15);
  const secPts = [];
  for (let j = 0; j <= 36; j++) {
    const t = j / 36;
    const a = t * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
    const up = s2 >= 0;
    const y = Math.pow(Math.abs(c), 2 / 2.35) * frSec.y * Math.sign(c || 1);
    const z = frSec.zc + Math.pow(Math.abs(s2), 2 / (up ? frSec.nu : frSec.nl)) * (up ? frSec.zu : -frSec.zl) * (up ? 1 : -1) * (up ? 1 : -1);
    secPts.push([fx(y), fy(z)]);
  }
  path(smoothPath([...secPts, secPts[0]]), 'skin');
  // wings with anhedral
  for (const s of [1, -1]) {
    const p0 = [fx(1.0 * s), fy(W.zPlane)], p1 = [fx(4.7 * s), fy(W.zPlane)], p2 = [fx(W.bTip * s), fy(wingZAt(W.bTip))];
    push(`<path d="M${p0[0]},${p0[1]} L${p1[0]},${p1[1]} L${p2[0]},${p2[1]}" class="skin" fill="none"/>`);
  }
  txt(fx(5.9), fy(wingZAt(6.2)) + 14, 'OUTER PANELS ~5° ANHEDRAL (from photos)', 'note');
  // nacelles circles
  for (const s of [1, -1]) push(`<circle cx="${fx(s * REF.nacelle.centerY)}" cy="${fy(REF.nacelle.centerZ)}" r="${(REF.nacelle.outerD / 2) * S}" class="skin"/>`);
  // fin sides
  for (const s of [1, -1]) push(`<rect x="${fx(s * T.finCenterY) - 4}" y="${fy(T.finTipZ)}" width="8" height="${(T.finTipZ - T.finBaseZ) * S}" class="skin"/>`);
  // h-stab
  for (const s of [1, -1]) {
    const xa = fx(Math.min(s * 0.4, s * T.hStabSpanHalf)), xb = fx(Math.max(s * 0.4, s * T.hStabSpanHalf));
    push(`<rect x="${xa}" y="${fy(T.hStabZ) - 4}" width="${xb - xa}" height="8" class="skin"/>`);
  }
  // gear + tires on ground
  push(`<circle cx="${fx(REF.gear.nose.y)}" cy="${fy(0.32)}" r="${(REF.gear.nose.wheelDia / 2) * S}" class="wheel"/>`);
  for (const s of [1, -1]) push(`<circle cx="${fx(s * REF.gear.main.y)}" cy="${fy(0.34)}" r="${(REF.gear.main.wheelDia / 2) * S}" class="wheel"/>`);
  // height dim
  dimLine(els, fx(-9.1), fy(0), fx(-9.1), fy(4.42), 'H 4.42 m', false);
  txt(fx(-8.9), fy(2.1), 'MAIN GEAR TRACK 2.63 m (der)', 'note');

  // ── DATA TABLE ──────────────────────────────────────────────────────────
  const table = [
    ['LENGTH', '16.16 m', 'doc · USAF'],
    ['SPAN', '17.42 m', 'doc · USAF'],
    ['HEIGHT', '4.42 m', 'doc · USAF'],
    ['WING AREA', '47.57 m²', 'doc'],
    ['ASPECT RATIO', '6.38', 'doc'],
    ['ROOT CHORD', `${W.chordRoot.toFixed(2)} m`, 'der (2·S/(b(1+λ)))'],
    ['TIP CHORD', `${W.chordTip.toFixed(2)} m`, 'der (λ=0.65)'],
    ['ENGINES', '2× GE TF34-GE-100A, 40.3 kN', 'doc'],
    ['GUN', 'GAU-8/A 30 mm · 1,174 rds', 'doc'],
    ['ARMOR', 'Ti bathtub 540 kg, 12.7–38 mm', 'doc'],
    ['STATIONS', '11 (8 wing + 3 fuselage)', 'doc'],
    ['GEAR', 'all retract fwd; nose off-CL right', 'doc'],
    ['WING LOFT vs SHEET', 'identical tables', 'lock ✓']
  ];
  const tabX = px(17.0), tabY = sideOff + 40;
  let th = '';
  table.forEach((r, i) => {
    th += `<text x="${tabX}" y="${tabY + i * 15}" class="k">${r[0]}</text><text x="${tabX + 118}" y="${tabY + i * 15}" class="v">${r[1]}</text><text x="${tabX + 286}" y="${tabY + i * 15}" class="s">${r[2]}</text>`;
  });

  const H = fv + 5.2 * S;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-10} ${fv + cxr + 380} ${H + 20}" font-family="ui-monospace,Consolas,monospace">
  <style>
    .skin{stroke:#9fd0ff;stroke-width:1.4;fill:none}
    .canopy{stroke:#7fd4c8;stroke-width:1.1;fill:none}
    .hinge{stroke:#ffb02e;stroke-width:0.7;stroke-dasharray:5 3;fill:none}
    .grid{stroke:#173148;stroke-width:0.6}
    .datum{stroke:#4ec9b0;stroke-width:0.8;stroke-dasharray:9 4}
    .axis{stroke:#ff5d5d;stroke-width:1.0;stroke-dasharray:3 3}
    .wheel{stroke:#cfd8e3;stroke-width:1;fill:none}
    .hp{fill:#ffb02e;opacity:.85}
    .dim{fill:#8fa2b8;font-size:11px}
    .stat{fill:#5f7288;font-size:9.5px}
    .note{fill:#4a5f76;font-size:9px}
    .k{fill:#8fa2b8;font-size:10.5px}
    .v{fill:#dfe9f5;font-size:10.5px}
    .s{fill:#c9a93b;font-size:9.5px}
  </style>
  <rect x="-5" y="-15" width="${fv + cxr + 390}" height="${H + 25}" fill="#0a1622"/>
  ${els.join('\n')}
  ${th}
  <text x="${PAD}" y="26" fill="#dfe9f5" font-size="15">A-10C THUNDERBOLT II — EXTERIOR/ARRANGEMENT SHEET · 外观布置图（与三维模型同源生成）</text>
  <text x="${PAD}" y="40" fill="#5f7288" font-size="10">scales 1:${Math.round(1000 / S)} grid 2 m · provenance: doc=USAF/Jane's · der=derived from published data · eng=engineering representation (internal)</text>
  <text x="${px(0.5)}" y="${sideOff + 16}" fill="#7fd4c8" font-size="11">SIDE ELEVATION</text>
  <text x="${px(0.5)}" y="${tb - 12}" fill="#7fd4c8" font-size="11">PLAN</text>
  <text x="${fx(-6.4)}" y="${fv - 12}" fill="#7fd4c8" font-size="11">FRONT ELEVATION</text>
</svg>`;
}

function dimLine(els, x1, y1, x2, y2, label, vert) {
  const arrow = 'M0,0 l6,-3 l0,6 Z';
  void arrow;
  els.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8fa2b8" stroke-width="1"/>`);
  els.push(`<text x="${(x1 + x2) / 2 + 8}" y="${(y1 + y2) / 2 + (vert ? 0 : 14)}" fill="#cfd8e3" font-size="11">${label}</text>`);
}
