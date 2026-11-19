---
name: interaction-design-physics
description: >-
  【触发：style/design/jank/glitch/CSS/IME/dark/motion】Enforce dark lightness steps, single-border CSS, damped spring motion, power-law vignettes, and IME compose locks.
---

# interaction-design-physics — UI Engineering & Interaction Physics

Governs frontend/Webview layers via closed-form spring kinetics, perceptual luminance steps, single-border enclosure, and defensive IME/viewport state machines.

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：VS Code Timing Extension（链上第 3 步）；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Webview jank, frame drops, or IME send glitch → `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering`；Implement damped motion and power-law vignette curves → `webgames-workflow` + `interaction-design-physics` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

---

## 1. Five Core Physics Axioms

1. **Luminance Elevation ($S_0 \dots S_n$)**: Separate depth via luminance steps; use inset specular hairlines (`box-shadow: inset 0 0 0 var(--hairline-width) rgba(255,255,255,0.10)`), not harsh dark-mode borders.
2. **1-Border Rule**: Any ray from container to leaf control crosses $\le 1$ closed border; demote nested pills/buttons/inputs to `Ghost`, fills, or single-axis dividers.
3. **2nd-Order Spring ($m\ddot{x} + c\dot{x} + k(x - x_{\text{target}}) = 0$, $\zeta = \frac{c}{2\sqrt{mk}}$)**: Ban `linear` easing; presets: **Snappy** ($600,30,\zeta=0.612,+8.8\%,0.22\text{s}$), **Gentle** ($320,28,\zeta=0.783,+1.8\%,0.35\text{s}$), **Bouncy** ($380,18,\zeta=0.462,+19.4\%,0.58\text{s}$), **HeavySnap** ($1200,80,m=0.1,\zeta=3.65,0\%,0.14\text{s}$).
4. **Streaming Viewport Pinning**: Auto-pin at $\Delta h \le 40\text{px}$ (`behavior: "auto"`), show jump pill at $>120\text{px}$, enforce $150\text{ms}$ human scroll lock.
5. **CJK IME Lock**: Submit only when $(\neg\text{isComposing}) \land (\text{keyCode} \ne 229)$; `Escape` during composition closes only the IME candidate window.

> Derivations & state machines: [visual-enclosure-discipline.md](references/visual-enclosure-discipline.md).

---

## 2. Physics Subsystems & Templates

| Subsystem | Key Invariants | Template |
| :--- | :--- | :--- |
| **Spring Solver** | Closed-form Snappy / Gentle / Bouncy / HeavySnap | [spring-physics-presets.ts](templates/spring-physics-presets.ts) |
| **Scroll Pinning** | $40\text{px}$ pin, $120\text{px}$ pill, $150\text{ms}$ human lock, `behavior: "auto"` | [scroll-pinning-controller.ts](templates/scroll-pinning-controller.ts) |
| **Power-Law Fade** | 7-stop $28\text{px}$ feather along $y \approx x^{1.5}$, zeroed at bounds | [scroll-fade-container.css](templates/scroll-fade-container.css) |
| **Affine Pan/Zoom** | Fixed $(O_x, O_y)$, wheel $\exp(-\Delta y \times 0.01)$, $4\text{px}$ deadzone, $0.7$ damping | [affine-pan-zoom-engine.ts](templates/affine-pan-zoom-engine.ts) |
| **Responsive & Type** | `576/480/384/320px` queries, `text-wrap: balance`, `tabular-nums`, `-0.125em` SVG | [container-responsive-matrix.css](templates/container-responsive-matrix.css) |
| **Split-Pane Shield** | `iframe { pointer-events: none }` on `pointerdown`, $4\text{px}$ deadzone, 50/50 snap, $<18\%$ collapse | [split-pane-resizer.ts](templates/split-pane-resizer.ts) |
| **Procedural Synth** | Master gain $\le 0.3$, dual oscillators, $3\sim 5\text{ms}$ attack + exp decay | [procedural-audio-synth.ts](templates/procedural-audio-synth.ts) |
| **Roving Focus** | Single `tabIndex = 0`, 1D/2D arrows, wrap & RTL | [roving-focus-controller.ts](templates/roving-focus-controller.ts) |
| **Ambient & Gamma** | Asymmetric sweep, 3-phase pulse (`0/0.35/0.7s`), $8\%$ gate & $A^{0.7}$ gamma | [thinking-ambient-glow.css](templates/thinking-ambient-glow.css) · [spectral-gamma-compressor.ts](templates/spectral-gamma-compressor.ts) |
| **Null-Origin Iframe** | `sandbox="allow-scripts"` (no `allow-same-origin`), `isTrusted && userActivation` | [sandbox-iframe-bridge.ts](templates/sandbox-iframe-bridge.ts) |
| **Segmented Pill** | Zero nested borders, Snappy-spring offset indicator | [segmented-control-pill.tsx](templates/segmented-control-pill.tsx) |
