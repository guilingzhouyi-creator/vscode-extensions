---
name: interaction-design-physics
description: >-
  通用界面工程与交互物理学规范：建立跨项目语义化分层明度拓扑、单闭合边框防套娃原则、
  二阶阻尼谐振子动效模型、感知幂律渐隐遮罩、不动点仿射变换及跨平台输入法互锁守卫，
  消除界面视觉噪点、卡顿重排与交互缺陷。
---

# interaction-design-physics — 通用界面工程与交互物理学规范

本技能指导 Web 前端、VS Code Webview 及客户端表现层的界面工程与交互动效研发，依托**第一性原理物理方程、心理感知模型与防御性状态机**构建零套娃噪点、零重排抖动的生产级交互体验。

---

## 一、 界面交互物理学五大刚性公理

1. **语义化分层明度拓扑 (Semantic Elevation)**：空间层级靠微小明度阶梯（$S_0 \dots S_n$）区分；暗色模式严禁刺眼白框，统一用内嵌发丝高光（`box-shadow: inset 0 0 0 var(--hairline-width) rgba(255,255,255,0.10)`）模拟顶光漫反射；
2. **单闭合边框公理 (The 1-Border Rule)**：单条视线路径至多穿透 **1 层闭合矩形边框**；已带边框容器内的子按钮、胶囊与输入框必须降级为 `Ghost` 悬浮态、表面填充或单向分割细线；
3. **二阶阻尼谐振子动效 ($m\ddot{x} + c\dot{x} + k(x - x_{\text{target}}) = 0$)**：严禁机械 `linear` 动画，按阻尼比 $\zeta = \frac{c}{2\sqrt{mk}}$ 选用四套标准预设：
   - **Snappy**（$k=600, c=30, \zeta=0.612$，超调 $+8.8\%$，收敛 $0.22\text{s}$）：按钮点击、Tab 切换；
   - **Gentle**（$k=320, c=28, \zeta=0.783$，超调 $+1.8\%$，收敛 $0.35\text{s}$）：卡片展开、Popover 唤起；
   - **Bouncy**（$k=380, c=18, \zeta=0.462$，超调 $+19.4\%$，收敛 $0.58\text{s}$）：成功徽章、新消息微提示；
   - **HeavySnap**（$k=1200, c=80, m=0.1, \zeta=3.65$，严格 $0\%$ 超调，收敛 $0.14\text{s}$）：分栏拖拽磁吸、抽屉咬合；
4. **流式视口图钉与意图仲裁 (Viewport Pinning)**：距离底部 $\Delta h \le 40\text{px}$ 自动吸附（流式推流强制 `behavior: "auto"` 防抖动），$\Delta h > 120\text{px}$ 浮现直达底部按钮；人类物理滚动触发 $150\text{ms}$ 冷却窗口一票否决程序自动滚动；
5. **CJK 输入法合成态双重互锁 (IME Guard)**：提交判定强制核验 $(\neg\text{isComposing}) \land (\text{keyCode} \ne 229)$，且 `Escape` 在合成期仅关闭候选词不冒泡关闭弹窗。

> 上述五大公理的完整数学推导、色阶采样表与状态机代码详见 [visual-enclosure-discipline.md](references/visual-enclosure-discipline.md)。

---

## 二、 核心物理交互算法与工程防线矩阵

| 交互子系统 | 刚性物理参数与工程契约 | 开箱即用标准样板 |
| :--- | :--- | :--- |
| **二阶弹簧求解器** | 四套标准弹簧预设（Snappy / Gentle / Bouncy / HeavySnap）与解析解求值 | [spring-physics-presets.ts](templates/spring-physics-presets.ts) |
| **流式视口图钉控制** | $40\text{px}$ 吸附、$120\text{px}$ 浮钮、$150\text{ms}$ 人类输入冷却锁、流式 `behavior: "auto"` | [scroll-pinning-controller.ts](templates/scroll-pinning-controller.ts) |
| **7 档幂律边缘遮罩** | $28\text{px}$ 羽化区内按 $y \approx x^{1.5}$ 采样 7 档 Alpha（`0%..100%`），触顶/触底动态归零 | [scroll-fade-container.css](templates/scroll-fade-container.css) |
| **不动点仿射缩放** | 光标 $(O_x, O_y)$ 物理绝对静止、滚轮 $\exp(-\Delta y \times 0.01)$、$4\text{px}$ 死区与 $0.7$ 溢出阻尼 | [affine-pan-zoom-engine.ts](templates/affine-pan-zoom-engine.ts) |
| **容器查询与 CJK 排版** | `576/480/384/320px` 4 阶容器降级、`text-wrap: balance`、`tabular-nums` 等宽数字锁定、SVG `-0.125em` 基线校准 | [container-responsive-matrix.css](templates/container-responsive-matrix.css) |
| **分栏手柄与 Iframe 护盾** | `pointerdown` 挂载 `iframe { pointer-events: none }`、$4\text{px}$ 死区、双击 50/50 咬合、$<18\%$ 吸附折叠 | [split-pane-resizer.ts](templates/split-pane-resizer.ts) |
| **Web Audio 合成声学** | 主增益上限 $\text{Gain} \le 0.3$、双谐振调制器、$3\sim 5\text{ms}$ 线性 Attack + 指数 Decay | [procedural-audio-synth.ts](templates/procedural-audio-synth.ts) |
| **WAI-ARIA 焦点漫游** | 单一 `tabIndex = 0` 不变式、一维/二维网格方向键正交导航、边界 Loop 回绕与 RTL 镜像 | [roving-focus-controller.ts](templates/roving-focus-controller.ts) |
| **思考氛围光与频域压缩** | 非对称扫光贝塞尔曲线、三相交错脉冲（`0s/0.35s/0.7s`）、$8\%$ 底噪截断与 $A^{0.7}$ Gamma 压缩 | [thinking-ambient-glow.css](templates/thinking-ambient-glow.css) · [spectral-gamma-compressor.ts](templates/spectral-gamma-compressor.ts) |
| **工件沙箱与手势门禁** | `sandbox="allow-scripts"`（禁 `allow-same-origin`）固化 `null-origin`，核验 `event.isTrusted && userActivation` | [sandbox-iframe-bridge.ts](templates/sandbox-iframe-bridge.ts) |
| **纯几何分段胶囊** | 零嵌套边框、基于几何偏移与 Snappy 弹簧的滑动指示器胶囊 | [segmented-control-pill.tsx](templates/segmented-control-pill.tsx) |
