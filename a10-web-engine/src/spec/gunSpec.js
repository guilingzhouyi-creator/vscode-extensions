/**
 * GAU-8/A Avenger installation spec — [REF.gun], see docs/01.
 * Axis convention: gun axis runs along +X (aft). Barrel bundle rotates about this axis.
 */
import { REF } from './referenceDimensions.js';
const G = REF.gun;

export const GUN = {
  ...G,
  /** gun axis start/end points in aircraft axes (muzzle → receiver) */
  muzzle: [G.muzzleX, G.muzzleY, G.muzzleZ],
  receiverEnd: [G.muzzleX + G.systemLen * 0.62, G.axisOffsetY * 1.0, G.muzzleZ + 0.34],
  /** firing barrel index sits at the TOP of the bundle in cradle attitude? — photos show the
   * barrel pointing through the nose underside; the bundle is rotated so one barrel is at
   * azimuth toward −Z… actual installed attitude: firing barrel toward muzzle opening.
   * we encode: bundle roll angle so barrel #0 (firing) points forward-down through the port */
  firingAzimuth: Math.PI / 2, // local: +Y side of bundle (starboard) → aligns with y=0 after offset
  mount: { x: [2.42, 4.28], z: 1.02 },
  feed: { chuteTopY: 0.30, chuteBottomY: -0.30 },
  drum: {
    x: G.drumCenterX, z: G.drumCenterZ, axisY: true,
    len: G.drumLen, r: G.drumDia / 2, outerR: G.drumDia / 2 + 0.10,
    rounds: G.ammoRounds
  },
  motor: { x: 4.62, y: G.axisOffsetY, z: 1.66, r: 0.11, len: 0.34 }, // twin hydraulic motors above receiver
  ammoLinkPitch: 0.322 // der: round overall length 30×173 mm ~ 0.32 m pitch
};

/** helical drum layout: returns generator function producing [y, angle, radius] per round */
export function drumRoundTransform(n) {
  const turns = 5, len = G.drumLen - 0.10, rIn = 0.33, rOut = 0.545;
  return function (i) {
    const t = i / (n - 1);
    const a = t * turns * Math.PI * 2;
    const y = -len / 2 + t * len;
    const r = rIn + (rOut - rIn) * (1 - t) * 0.9 + 0.02;
    return { y, a, r };
  };
}
