# A-10 Thunderbolt II · Web 工程化三维模型 | Engineering-Grade Web Model

> 基于 **three.js** 的可运行工程化模型（本仓库内非扩展工具包，与 `auto-refactor` 同样**无 `engines.vscode`**，
> 不参与 VS Code 扩展 CI/发布）。全部尺寸出自 `src/spec/` 数据层，外观与三视图图纸**同源生成**，
> 头身比、站位、机构与挂架逻辑可用 `npm test` 在浏览器外验证。

A runnable, engineering-grade A-10C model: dimension-locked spec layer → lofted geometry →
shared-material PBR → rig/cutaway/exploded/loadout/damage systems. LOD、实例化铆钉、几何缓存、
可拆解与剖切、挂架方案切换、战损接口、以及**与模型同源生成的设计图纸 (SVG)**。

```bash
cd a10-web-engine
npm install && npm run dev     # → http://localhost:5173
npm test                       # 20 headless acceptance checks
npm run build                  # production bundle
```

## Highlights · 能力

- **185 个注册部件**（镜像成对自动生成）：机身框架蒙皮 / 钛装甲浴盆 / GAU-8/A 全系统（7 管、鼓式弹药
  实例化螺旋 1,174 发）/ 双梁机翼（双开缝襟翼、副翼扰流复合、蜂窝前缘、Hoerner 翼尖）/ 双垂尾平尾 /
  TF34 涡扇（风扇、HP、燃烧室、HPT/LPT 转子各自转速）/ 前三点起落架（含半暴露主轮与机腹整流）/
  11 挂点全目录。
- **LOD0/1/2 + 自动策略**：铆钉与紧固件只在 LOD0 实例化绘制；几何缓冲区共享、引用计数缓存、可卸载。
- **机构 Rig**：襟翼 40°、副翼 ±20°、扰流 ±25°、升降/方向舵、起落架收放（舱门联动）、座舱盖、短舱
  维护舱门、N1/HPT/LPT 转速、机炮旋转——全部经命名的枢轴句柄驱动，支持损伤锁定。
- **剖切/X光/爆炸图**：真实内部（油箱、液压、航电、线缆、防火墙）而非贴图。
- **挂载方案**：clean/CAS/max/training 纯可见性切换（BRU 挂架/MK82 串列/火箭巢/ALQ-131/LITENING/
  AIM-9/Maverick/600gal 试验油箱）。
- **战损接口**：命中记录、烧蚀出入孔贴片、敲除后机构锁定与材质损伤，`clear()` 完整还原。
- **设计图纸**：`图纸` 按钮 —— 侧/俯/前三视 + 站位网格 + 数据表，由与三维**完全相同**的 spec 表生成。

## Docs

| 文档 | 内容 |
|------|------|
| [`docs/01-SOURCES.md`](docs/01-SOURCES.md) | 数据来源与出处分级（doc/der/eng），及"不伪造"清单 |
| [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) | 五层架构、ID 契约、镜像规则、LOD/Rig/剖切/战损设计 |
| [`docs/03-RUNNING.md`](docs/03-RUNNING.md) | 运行/测试/控制台 API/新增部件流程/已知简化 |

## Layout

```
src/spec/          所有数字与登记表（唯一真相源）
src/math/          框架插值、翼型环
src/geometry/      十大建造模块 + _util 放样/镜像/紧固件工具
src/build/         材质工厂 · 几何缓存 · 场景图构建器 · 生命周期
src/interaction/   rig · picker · explodedView · cutaway · damage
src/app/           viewer · ui · designSheet · main（组合根）
tests/run.mjs      20 项头路验收（envelope/契约/机构/缓存/…）
docs/              01 来源 · 02 架构 · 03 运行
```

MIT © 2026 OriginalTC
