/**
 * MATERIAL SPEC (headless data — materialFactory turns this into three.js materials).
 * One shared instance per key (material reuse enforced; tests assert no per-part clones).
 * livery variants swap only the paint texture keys, never material identity per part.
 */
export const MATERIALS = {
  airframeTop: { pbr: { color: 0x6d7368, roughness: 0.78, metalness: 0.06 }, texture: 'paint-europe1-top', class: 'paint', desc: 'EU-1 upper surface green-grey' },
  airframeLat: { pbr: { color: 0x767c6f, roughness: 0.78, metalness: 0.06 }, texture: 'paint-europe1-lat', class: 'paint' },
  airframeBot: { pbr: { color: 0x8f9aa4, roughness: 0.72, metalness: 0.05 }, texture: 'paint-europe1-bot', class: 'paint', desc: 'light grey underside' },
  bareMetal: { pbr: { color: 0x9aa3ad, roughness: 0.42, metalness: 0.85 }, class: 'metal', desc: 'machined aluminium fittings' },
  steelDark: { pbr: { color: 0x3c4148, roughness: 0.55, metalness: 0.7 }, class: 'metal' },
  gunmetal: { pbr: { color: 0x22262c, roughness: 0.48, metalness: 0.62 }, class: 'metal', desc: 'gun barrel/receiver finish (phosphate)' },
  bluedSteel: { pbr: { color: 0x1b1e24, roughness: 0.35, metalness: 0.75 }, class: 'metal' },
  titanium: { pbr: { color: 0x8b8477, roughness: 0.62, metalness: 0.35 }, class: 'metal', desc: 'armor bathtub, raw titanium' },
  hotMetal: { pbr: { color: 0x5a4a3c, roughness: 0.55, metalness: 0.65 }, class: 'metal', desc: 'turbine/exhaust hardware' },
  engineCase: { pbr: { color: 0xb9bec4, roughness: 0.38, metalness: 0.8 }, class: 'metal', desc: 'magnesium/alloy casings' },
  bladeAlloy: { pbr: { color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 }, class: 'metal', flatShading: false },
  rubber: { pbr: { color: 0x17181a, roughness: 0.95, metalness: 0.0 }, class: 'rubber', desc: 'tires' },
  glass: { pbr: { color: 0x9fb6bf, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.24, side: 'double' }, class: 'glass', desc: 'canopy / windscreen (small-arms resistant, doc)' },
  canopyTint: { pbr: { color: 0x36474f, roughness: 0.05, transparent: true, opacity: 0.5, side: 'double' }, class: 'glass' },
  cockpitDark: { pbr: { color: 0x15181d, roughness: 0.9, metalness: 0.02 }, class: 'interior' },
  instrumentGlow: { pbr: { color: 0x0c1013, roughness: 0.4, emissive: 0x123a2a, emissiveIntensity: 0.55 }, class: 'interior' },
  mfdOn: { pbr: { color: 0x0b0f0c, roughness: 0.35, emissive: 0x0e2b1e, emissiveIntensity: 0.9 }, class: 'interior' },
  ejectionOrange: { pbr: { color: 0xd96b1f, roughness: 0.8 }, class: 'interior' },
  antislip: { pbr: { color: 0x2c3138, roughness: 0.98 }, texture: 'antislip', class: 'interior' },
  interiorStructure: { pbr: { color: 0x4e5560, roughness: 0.7, metalness: 0.35 }, class: 'structure', desc: 'frames/ribs/bulkheads zinc-chromate primer grey' },
  structurePrimer: { pbr: { color: 0x5d6b52, roughness: 0.82, metalness: 0.1 }, class: 'structure', desc: 'zinc-chromate primer' },
  bayInterior: { pbr: { color: 0x3a3f46, roughness: 0.85, metalness: 0.2 }, class: 'structure' },
  warningYellow: { pbr: { color: 0xd7b32a, roughness: 0.6, metalness: 0.05 }, class: 'marking' },
  dangerRed: { pbr: { color: 0xa32b23, roughness: 0.65 }, class: 'marking' },
  OrdnanceGreen: { pbr: { color: 0x57604a, roughness: 0.82, metalness: 0.05 }, class: 'store', desc: 'MK-80 series body' },
  ordnoseYellow: { pbr: { color: 0xc9a93b, roughness: 0.7 }, class: 'store' },
  missileWhite: { pbr: { color: 0xcfd3d6, roughness: 0.55, metalness: 0.08 }, class: 'store' },
  podGrey: { pbr: { color: 0x808a92, roughness: 0.7, metalness: 0.1 }, class: 'store' },
  intakeDark: { pbr: { color: 0x101214, roughness: 0.95, metalness: 0.0 }, class: 'cavity', desc: 'duct interior (real back-facing geometry, not a flat decal)' },
  exhaustCavity: { pbr: { color: 0x1a1614, roughness: 0.9, metalness: 0.15 }, class: 'cavity' },
  rubberBlackMatte: { pbr: { color: 0x101112, roughness: 1.0 }, class: 'rubber' },
  brass: { pbr: { color: 0x8a6f2e, roughness: 0.4, metalness: 0.8 }, class: 'ammo', desc: '30mm case (aluminium class, toned)' },
  projectile: { pbr: { color: 0x5c4a34, roughness: 0.6, metalness: 0.3 }, class: 'ammo' },
  decal: { pbr: { color: 0xffffff, roughness: 0.6, transparent: true }, class: 'marking' }
};

/** liveries swap only texture keys on the three paint materials (single material identity kept) */
export const LIVERIES = {
  europe1: { name: 'EUROPEAN ONE', top: 'paint-europe1-top', lat: 'paint-europe1-lat', bot: 'paint-europe1-bot', base: { top: 0x6d7368, lat: 0x767c6f, bot: 0x8f9aa4 } },
  grey: { name: 'TACTICAL GREY', top: 'paint-grey-lat', lat: 'paint-grey-lat', bot: 'paint-grey-bot', base: { top: 0x84898e, lat: 0x84898e, bot: 0x9aa0a6 } },
  primer: { name: 'PRIMER', top: 'paint-primer', lat: 'paint-primer', bot: 'paint-primer', base: { top: 0x5f6a58, lat: 0x5f6a58, bot: 0x555f4e } }
};

/** procedural textures — generated once, cached, shared */
export const TEXTURES = {
  'paint-europe1-top': { kind: 'camo', size: 1024, cols: [0x6d7368, 0x59645c, 0x7d8479], band: 'upper' },
  'paint-europe1-lat': { kind: 'camo', size: 1024, cols: [0x767c6f, 0x626b60, 0x8a9084], band: 'lat' },
  'paint-europe1-bot': { kind: 'flat', size: 512, cols: [0x8f9aa4], band: 'bot' },
  'paint-grey-lat': { kind: 'flat', size: 512, cols: [0x84898e], band: 'lat' },
  'paint-grey-bot': { kind: 'flat', size: 512, cols: [0x9aa0a6], band: 'bot' },
  'paint-primer': { kind: 'flat', size: 512, cols: [0x5f6a58], band: 'lat' },
  antislip: { kind: 'noise', size: 256, cols: [0x2c3138, 0x343a42] }
};

/** panel-line + stencil + roundel decals painted INTO the camo textures (no fake geometry) */
export const PAINT_DETAILS = {
  panelLines: { alpha: 0.16, width: 1.5 },
  rivetsDrawnInTexture: false, // rivets are real instanced geometry at L0 — not painted on
  stencils: ['RESCUE', 'DANGER — EJECTION SEAT', 'NO STEP', 'GAU-8 LINK EJECT'],
  nationalInsignia: { scale: 0.34 }
};
