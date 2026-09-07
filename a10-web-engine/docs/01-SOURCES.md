# 数据来源与出处 · Sources & Provenance

本模型的目标是**工程化可信**：每个数字要么有公开出处（doc），要么由公开数据推导（der），
要么是为可视化服务的合理工程表达（eng）。任何“看起来像”的假细节一律不允许出现在外观层面。

Every dimension in `src/spec/*` carries a provenance class:

| tag | meaning | examples |
|-----|---------|----------|
| `doc` | published, quotable | L 16.16 m / span 17.42 m / H 4.42 m [USAF fact sheet]; GAU-8/A 1,174 rds, 2,300 rpm…; TF34-GE-100 9,065 lbf, BPR ≈6:1; S 47.57 m², AR 6.38; Ti bathtub 540 kg, 12.7–38 mm |
| `der` | derived from doc data by a stated formula (tests assert the identity) | root chord = 2·S/(b(1+λ)) with λ=0.65; nacelle centerY from 3-view; WS23 wing box 0.584 m; gear track 2.63 m |
| `eng` | engineering representation — plausible mechanism, correct place, no claimed spec | flap track canning, hinge fittings, rivet pattern, LRU boxes, torque links |

## Primary references used

1. **USAF A-10C fact sheet** (af.mil) — dimensions, weights, engines, armament, stations=11.
2. **Jane's / standard references** — GAU-8/A Avenger: 30×173B, 7 barrels Ø0.437 m bundle,
   2.85 m gun / 6.06 m system, drum Ø0.876×1.82 m on Y axis, 3,900 rpm max, muzzle ≈1,036 m/s.
3. **TF34-GE-100 public data** — 2-spool turbofan, 24-blade fan Ø1.12 m, 14-stage HP compressor,
   18 combustor injectors, 2-stage HPT + 4-stage LPT, fan/HP spool speeds → relative animation rates.
4. **Cradle-to-ground geometry from declassified dash-1/3-views** — gear attach stations, nose gear
   offset to starboard (doc: to clear the gun feed), mains retract forward leaving the tire
   half-exposed (doc: "reduces gear-up landing damage" — tires remain partly in the slipstream).
5. **aviation.stackexchange analyses of the A-10 wing** — outer-panel 5° anhedral after the WS-break,
   Hoerner-type drooped tips, double-slotted inboard flaps with the aileron-deceleron split;
   these drive `wingSpec.js` (WING.anhedralOuter, TIP_HOERNER, flap/aileron/spanwise bands).
6. **Photos (public domain, USAF)** — panel line rhythm, access door patterns, intake D-lip,
   exhaust heat-shield fins, tail cone discharge nozzles ×5, gun bay belly doors bulge.

## What is deliberately NOT faked

- No cockpit MFD text at readable fidelity (geometry-only glass, seat, HUD, sticks, throttle quadrant).
- No engine internal part names beyond the spool groups public data supports.
- Store shapes are conservative silhouette+dimensions from public drawings; markings not invented.
- Damage model: HP is a *gameplay interface* (eng), not a ballistic claim; decals are scorch approximations.

## Coordinate & unit contract (lock)

Aircraft axes: **+X aft, +Y starboard, +Z up, z=0 ground datum**, m / kg / rad. One root
`rotX(−90°)` maps to three.js Y-up world. Tests enforce L/span/H/track/engine-spacing within
±2–8% against the doc numbers; the design sheet and the 3D model loft from the **same**
`FUSELAGE_FRAMES`/`wingSpec` tables and therefore cannot drift.
