/**
 * DOCUMENTED REFERENCE DATA — A-10 Thunderbolt II
 * Every value carries a source class:
 *   doc  = published by a reliable public source (USAF fact sheet, Jane's, OEM)
 *   der  = derived mathematically from documented values (formula noted)
 *   eng  = engineering estimate for internal/undocumented structure — conservative,
 *          physically consistent, never presented as a real spec (see docs/01)
 *
 * Sources:
 *  [S1] USAF Fact Sheet (Whiteman AFB / 944 FW): L 53ft4in 16.16 m, B 57ft6in 17.42 m,
 *       H 14ft8in 4.42 m, 2× TF34-GE-100, 9065 lbf ea, 11 hardpoints (8 wing/3 fuselage),
 *       MTOW 51,000 lb, payload 16,000 lb, GAU-8/A 30 mm.
 *  [S2] Wikipedia "Fairchild Republic A-10 Thunderbolt II" (design section):
 *       titanium bathtub 540 kg / 0.5–1.5 in plates; all gear retract forward; nose gear
 *       offset right for the centerline gun barrel; main wheels partially exposed when
 *       retracted; ailerons large + split (deceleron); honeycomb LE panels; skin with
 *       integral stringers, non-load-bearing; engines on 4-bolt pylons; exhaust over
 *       tailplanes (IR masking); ammo drum ~1.816 m, 1350 max / 1174 typical rounds;
 *       4 fuel tanks isolated from skin + 2 sump tanks; low-wing straight wing.
 *  [S3] Jane's via Wikipedia "General Electric TF34": L 100 in (2.54 m), D 49–52.2 in
 *       (1.25–1.33 m), 1-stage fan (Ø44 in / 1.12 m), 14-stage HP compressor,
 *       2-stage HPT, 4-stage LPT, annular combustor (18 fuel injectors), BPR 6:1,
 *       dry weight ~653–670 kg, thrust 9,065 lbf (-100A).
 *  [S4] GAU-8/A (fandom/Wiki mirrors of Jane's): gun 2.85 m, system 6.06 m, barrel
 *       2.30 m, 7 barrels, bundle Ø 0.437 m, gun 281 kg, loaded system 1,830 kg,
 *       drum 0.876 m Ø × 1.82 m, 3,900 rpm, muzzle 988–1,070 m/s, linkless feed,
 *       twin hydraulic motors.
 *  [S5] Wing area 47.57 m² (505–512 sq ft, several sources) + AR 6.38 (b²/S).
 */

export const REF = {
  overall: {
    length: 16.16,          // [S1] nose tip → tail cone end
    wingspan: 17.42,        // [S1] tip → tip
    height: 4.42,           // [S1] ground → fin tip
    wingArea: 47.57,        // [S5]
    aspectRatio: 6.38,      // [S5]
    emptyWeight: 11321,     // kg [doc, varies 11.3–13.2 t by source/load]
    mtow: 22680,            // kg [S1 ~51,000 lb]
    payload: 7257           // kg (16,000 lb) [S1]
  },

  /** derived planform: mean chord = S/b; trapezoid with taper 0.65 [der from S5] */
  wing: {
    bTip: 8.71,             // der: span/2
    yJunction: 0.584,       // der: WS23 = 23 in from centerline (outer wing joins box) [S2]
    chordRoot: 3.31,        // der: 2·(S − inside-fuselage box)/((1+λ)(b−2·yJ)) ≈ 3.31
    chordTip: 2.15,         // der: λ=0.65 × root
    taper: 0.65,
    sweepLE: 0,             // doc: straight wing [S2]
    tOverC_root: 0.19,      // eng: thick wing, visually ~18–20% [photos]
    tOverC_tip: 0.145,
    anhedralRoot: 0,        // der from photos: inner panel ~0°
    anhedralOuter: -5,      // der from photos/Wikipedia low-wing anhedral effect: outer panels ~5° down
    yAnhedralBreak: 4.7,    // eng: break location between inner/outer panel (WS region)
    xLE: 6.90,              // der from 3-view: wing root leading edge station
    zPlane: 1.46,           // der: wing mid-plane height at root above ground datum
    flapY: [0.85, 4.55],    // der: double-slotted flap run (both sides)
    aileronY: [5.85, 8.55], // der: oversized ailerons “almost 50% span”-group incl. deceleron [S2]
    spoileronY: [4.62, 5.80], // der: upper-surface spoilerons between flap & aileron
    slatLEnone: true         // doc: no slats (fixed thick LE w/ honeycomb panel) [S2]
  },

  tail: {
    hStabSpanHalf: 3.52,    // der from 3-views: tips fair into fin roots
    hStabChordRoot: 2.45,   // eng from silhouette
    hStabChordTip: 1.5,     // eng
    hStabX: 12.62,          // der: h-stab LE station
    hStabZ: 2.62,           // der from front view: mounted mid-fin between nacelles
    hStabDihedral: 0,       // der from 3-view
    elevatorY: [0.95, 3.45],// der: outboard of fin roots
    finCenterY: 1.92,       // der from front view
    finRootX: [12.42, 15.52], // der
    finTipX: [13.85, 15.52],  // der: ~35° LE sweep
    finBaseZ: 2.32,         // der: fuselage top at fin station
    finTipZ: 4.42,          // doc [S1] height overall
    finTipThickness: 0.09,
    rudderYFrac: 0.30       // eng: rudder share of chord at rear
  },

  nacelle: {  // TF34 pod installation, per-side values mirrored [S3 + photos]
    centerY: 1.60,          // der from front view
    centerZ: 2.02,          // der from side view: engine axis above wing mid-plane
    xLip: 9.18,             // der: intake plane (fuselage-side D-lip forward of nacelle)
    xEnd: 13.10,            // der: nozzle station (aft of wing TE, ahead of fin LE root)
    outerD: 1.30,           // der: ~max eng D 1.25 + cowl
    inletW: 1.12, inletH: 1.06,
    nozzleD: 0.92,
    exhaustRiseDeg: 3,     // eng: slight upward cant so plume clears h-stab (IR masking story [S2])
    pylonBolts: 4           // doc [S2] four bolts per pylon
  },

  engine: { // TF34-GE-100 internals [S3]
    length: 2.54, fanDia: 1.12, fanBlades: 24,
    hpStages: 14, hpStagesShown: 5, // model groups the 14 stages into 5 visible drum bands
    hptStages: 2, lptStages: 4,
    combustorNozzles: 18,
    bpr: 6, dryWeight: 653, thrust: 40.3 // kN
  },

  gun: { // GAU-8/A [S2][S4]
    muzzleX: 0.55, muzzleZ: 1.10, muzzleY: 0.0,
    axisOffsetY: -0.20,     // der [S2]: gun cradle offset left so firing barrel ⇒ centerline
    bundleRadius: 0.219,    // der [S4] 0.437 m width/2
    barrels: 7, barrelLen: 2.30,
    gunBodyLen: 2.85, systemLen: 6.06,
    drumDia: 0.876, drumLen: 1.82, drumCenterX: 5.95, drumCenterZ: 1.16,
    ammoRounds: 1174, ammoMax: 1350,
    massGun: 281, massSystemLoaded: 1830, rpm: 3900
  },

  armor: { // titanium bathtub [S2]
    mass: 540, xRange: [3.85, 6.55], thickness: { front: 0.038, side: 0.025, bottom: 0.038, back: 0.013 },
    spallLiner: true
  },

  gear: { // all retract FORWARD [S2]; nose offset right for gun
    groundClearance: 0.66,
    nose: { wheelDia: 0.635, tireW: 0.19, x: 3.32, y: 0.565, retractDir: +1 },
    main: { wheelDia: 0.673, tireW: 0.165, x: 9.02, y: 1.315, exposedAfterRetract: 0.16, retractDir: +1 },
    track: 2.63, wheelbase: 5.70 // der from 3-view
  },

  cockpit: { // der from photos/3-view; A-10C glass layout
    sillX: [3.62, 5.78], floorZ: 1.56, eyeZ: 2.44, eyeX: 4.86,
    seat: 'ACES II', hudOn: true, mfd: 2
  },

  hardpoints: { // count [S1]: 8 wing + 3 fuselage = 11. Lateral positions der from photos
    stations: [
      { id: 'R1', y:  7.30, x: 8.35, kind: 'rail' },   // AIM-9 outboard
      { id: 'R2', y:  6.10, x: 8.30, kind: 'pylon' },
      { id: 'R3', y:  4.55, x: 8.25, kind: 'pylon' },
      { id: 'R4', y:  3.05, x: 8.20, kind: 'pylon' },
      { id: 'R5', y:  1.95, x: 8.16, kind: 'pylon' },
      { id: 'F1', y:  0.95, x: 8.55, kind: 'fuselage' },
      { id: 'F0', y:  0.00, x: 9.15, kind: 'centerline' },
      { id: 'F2', y: -0.95, x: 8.55, kind: 'fuselage' },
      { id: 'L5', y: -1.95, x: 8.16, kind: 'pylon' },
      { id: 'L4', y: -3.05, x: 8.20, kind: 'pylon' },
      { id: 'L3', y: -4.55, x: 8.25, kind: 'pylon' },
      { id: 'L2', y: -6.10, x: 8.30, kind: 'pylon' },
      { id: 'L1', y: -7.30, x: 8.35, kind: 'rail' }
    ]
  },

  fuel: { // [S2]: 4 tanks near CG + 2 sumps, isolated from skin
    main: { count: 4, xRange: [6.7, 10.35], yBands: [[0.30, 1.24], [-1.24, -0.30]], foam: true },
    sump: { count: 2, xRange: [10.5, 11.3], y: [0.62, -0.62] },
    capacityMass: 4990 // ~11,000 lb usable [S1]
  }
};

/** source classes for the UI + tests */
export const SRC = { doc: 'doc', der: 'derived', eng: 'engineering' };
