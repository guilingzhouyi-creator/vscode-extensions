---
name: interaction-design-physics
description: >-
  【触发：界面/调样式/CSS/边框/暗色模式/输入法/抖动/套娃】编写或调整前端界面、Webview 与动效时触发。落实语义明度阶梯、单闭合边框、二阶阻尼物理模型、感知幂律渐隐及 IME 输入法互锁守卫。
---

# interaction-design-physics — UI Engineering & Interaction Physics Specification

Governs Webview, frontend, and client presentation layers using closed-form spring physics, perceptual luminance hierarchies, single-border enclosure discipline, and defensive IME/viewport state machines.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：VS Code 扩展与计时视图（链上第 3 步）；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：计时视图卡顿或丢帧 → `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering`；卡拉尔界面动效与感知幂律渐隐 → `webgames-workflow` + `interaction-design-physics` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Five Core Axioms of Interaction Physics

1. **Semantic Luminance Elevation ($S_0 \dots S_n$)**: Separate depth layers via subtle luminance steps; forbid harsh white borders in dark mode — use inset hairline specular highlights (`box-shadow: inset 0 0 0 var(--hairline-width) rgba(255,255,255,0.10)`).
2. **The 1-Border Rule**: Any visual ray from container background to leaf control may cross at most **1 closed rectangular border**; demote nested pills, buttons, and inputs inside bordered cards to `Ghost` states, surface fills, or single-axis dividers.
3. **Second-Order Damped Harmonic Oscillator ($m\ddot{x} + c\dot{x} + k(x - x_{\text{target}}) = 0$)**: Forbid mechanical `linear` easing; select from four presets by damping ratio $\zeta = \frac{c}{2\sqrt{mk}}$:
   - **Snappy** ($k=600, c=30, \zeta=0.612$, overshoot $+8.8\%$, settle $0.22\text{s}$): button clicks, tab switches;
   - **Gentle** ($k=320, c=28, \zeta=0.783$, overshoot $+1.8\%$, settle $0.35\text{s}$): card expansion, popovers;
   - **Bouncy** ($k=380, c=18, \zeta=0.462$, overshoot $+19.4\%$, settle $0.58\text{s}$): badge notifications;
   - **HeavySnap** ($k=1200, c=80, m=0.1, \zeta=3.65$, $0\%$ overshoot, settle $0.14\text{s}$): split-pane snapping, drawers.
4. **Streaming Viewport Pinning**: Auto-pin when distance to bottom $\Delta h \le 40\text{px}$ (using `behavior: "auto"` during streaming to prevent jitter); reveal jump-to-bottom button when $\Delta h > 120\text{px}$; enforce a $150\text{ms}$ human scroll cooldown lock that overrides programmatic auto-scroll.
5. **CJK IME Composition Interlock**: Gate Enter submission on $(\neg\text{isComposing}) \land (\text{keyCode} \ne 229)$; pressing `Escape` during composition closes only the IME candidate window without bubbling to close modals.

> Full derivations, luminance tables, and state machines: [visual-enclosure-discipline.md](references/visual-enclosure-discipline.md).

---

## 2. Physics Subsystems & Reusable Template Scaffolds

| Subsystem | Physical Parameters & Engineering Contract | Template Asset |
| :--- | :--- | :--- |
| **2nd-Order Spring Solver** | Closed-form evaluation for Snappy / Gentle / Bouncy / HeavySnap | [spring-physics-presets.ts](templates/spring-physics-presets.ts) |
| **Streaming Scroll Pinning** | $40\text{px}$ pin zone, $120\text{px}$ pill trigger, $150\text{ms}$ human scroll lock, `behavior: "auto"` | [scroll-pinning-controller.ts](templates/scroll-pinning-controller.ts) |
| **7-Stop Power-Law Fade Mask** | $28\text{px}$ feather zone sampled along $y \approx x^{1.5}$ (`0%..100%`), zeroed at scroll bounds | [scroll-fade-container.css](templates/scroll-fade-container.css) |
| **Fixed-Point Affine Pan/Zoom** | Cursor $(O_x, O_y)$ invariant, wheel $\exp(-\Delta y \times 0.01)$, $4\text{px}$ deadzone, $0.7$rubber-band damping | [affine-pan-zoom-engine.ts](templates/affine-pan-zoom-engine.ts) |
| **Container Queries & CJK Type** | `576/480/384/320px` 4-tier degradation, `text-wrap: balance`, `tabular-nums`, SVG `-0.125em` baseline | [container-responsive-matrix.css](templates/container-responsive-matrix.css) |
| **Split-Pane & Iframe Shield** | Mount `iframe { pointer-events: none }` on `pointerdown`, $4\text{px}$ deadzone, double-click 50/50 snap, $<18\%$ collapse | [split-pane-resizer.ts](templates/split-pane-resizer.ts) |
| **Web Audio Procedural Synth** | Master gain $\le 0.3$, dual harmonic oscillators, $3\sim 5\text{ms}$ linear attack + exponential decay | [procedural-audio-synth.ts](templates/procedural-audio-synth.ts) |
| **WAI-ARIA Roving Focus** | Single `tabIndex = 0` invariant, 1D/2D orthogonal arrow navigation, wrap-around & RTL mirroring | [roving-focus-controller.ts](templates/roving-focus-controller.ts) |
| **Ambient Glow & Gamma** | Asymmetric sweep bezier, 3-phase pulse (`0s/0.35s/0.7s`), $8\%$ noise gate & $A^{0.7}$ gamma compression | [thinking-ambient-glow.css](templates/thinking-ambient-glow.css) · [spectral-gamma-compressor.ts](templates/spectral-gamma-compressor.ts) |
| **Null-Origin Iframe Sandbox** | `sandbox="allow-scripts"` (forbid `allow-same-origin`), verify `event.isTrusted && userActivation` | [sandbox-iframe-bridge.ts](templates/sandbox-iframe-bridge.ts) |
| **Borderless Segmented Pill** | Zero nested borders, geometric offset indicator driven by Snappy spring | [segmented-control-pill.tsx](templates/segmented-control-pill.tsx) |
