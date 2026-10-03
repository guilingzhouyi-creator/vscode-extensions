# 运行 / 测试 / 排障 · Running, Testing, Troubleshooting

## Run

```bash
cd a10-web-engine
npm install          # three@0.182, vite@7 (only two deps)
npm run dev          # http://localhost:5173 — 中文/English UI, live preview proxy friendly
```

## Headless acceptance tests (no browser needed)

```bash
npm test             # node tests/run.mjs — 20 checks: spec locks, registry contract,
                     # full LOD0 build, mirror twins, cache sharing, LOD gating, rig
                     # plumbing, loadout logic, exploded view, picker, damage, sheet, dispose
```

The test suite doubles as the **regression guard for the doc-alignment**: length/span/height
envelope, engine spacing, ground datum, wing area identity — if you edit spec numbers without
editing provenance, `npm test` fails.

## Production build

```bash
npm run build        # dist/ (~860 kB three-inlined, gzip ~234 kB)
npm run preview
```

## Controls quick card (UI)

| 控件 | 做什么 |
|------|--------|
| 拆解 Exploded 滑杆 (X 键切换) | 按注册表矢量分离所有部件 |
| 剖切 X/Y/Z + 左右 | 世界裁剪面；Y 支持半剖/对称带 |
| 内部X光 | 蒙皮材质透明化，内部结构(燃油/液压/航电/炮系统)可见 |
| 机构 Rig 滑块 | 起落架/襟翼/副翼/扰流/舵/舱盖/N1/机炮 |
| 挂载 | 净挂 / CAS标准 / 最大 / 训练 — 纯可见性切换，不重建几何 |
| 战损 | 随机或点击部位；HP 耗尽 → 该面被 rig.lock + 材质损伤 |
| LOD 自动/0/1/2 · 铆钉开关 | bucket 可见性；自动按相机距离 14/34 m |
| 点击部件 / 部件树 | 高亮 + ID/站位/数据源/包围盒 |
| 图纸 | 与模型同源的 SVG 三视图（可下载） |

## Console API (debug / integration)

See `docs/02-ARCHITECTURE.md` §Public surface. Everything the UI does is doable via `__A10.*`
with one call each — the UI holds no exclusive capability.

## Adding parts (the correct way)

1. Declare in `partTree.js` (`P(id, name, name_zh, assembly, {bucket, src, mass?, station?,
   mirror?, rig?, explode, desc})`) — the tests will enforce uniqueness/explode/src.
2. Author in the matching `geometry/*.js` in **absolute aircraft coords**; attach rig handles via
   `ctx.pivot` when it moves; register rivet fields via `ctx.inst` + `fastenerMatrices`.
3. `npm test` — registry contract + bbox tests catch most authoring mistakes (NaN, orphan ids,
   envelope growth).

## Known simplifications (honest list)

- Double-slot flap mechanism is represented by the outer segment + tracks, not full cascade links.
- Engine internals are silhouette-grade spools (fan/booster/HP bands/combustor/HPT/LPT) — enough
  to read correctly in cutaway, not a hot-section CAD.
- Store shapes public-silhouette only; no invented markings.
- Damage decals are scorch approximations (interface first — swap-in point for spall/fire VFX).
