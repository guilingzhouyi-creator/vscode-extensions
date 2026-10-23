# 界面交互物理学深水区指南：单闭合边框、二阶谐振子、感知幂律遮罩与 IME 互锁

> 本指南整合了单闭合边框防套娃公理、二阶阻尼谐振子解析方程、7 档韦伯-费希纳幂律渐隐遮罩、光标不动点仿射变换及跨平台 CJK 输入法合成态互锁守卫。

---

## 一、 单闭合边框公理与视网膜发丝高光 (Visual Enclosure Discipline)

1. **单闭合边框原则 (The 1-Border Rule)**：从画布背景向内穿透的任意单向视线上，至多穿过 **1 层闭合矩形边框**。外层容器（卡片、搜索框、弹窗）具备独立边界后，内部次级按钮降级为表面微明度填充，图标动作降级为 `Ghost`（常态透明），输入区剥离原生轮廓（`border-0 outline-none`），内部分组仅用单向 `1px` 分割细线。
2. **暗色模式内嵌顶光倒角与 Retina 发丝补偿**：
   ```css
   :root { --hairline-width: 1px; }
   @media (min-resolution: 2dppx) { :root { --hairline-width: 0.5px; } }
   @media (min-resolution: 3dppx) { :root { --hairline-width: calc(1px / 3); } }

   .elevation-popover {
     box-shadow: 0 0 0 var(--hairline-width) rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.12);
   }
   [data-mode="dark"] .elevation-popover {
     box-shadow: inset 0 0 0 var(--hairline-width) rgba(255, 255, 255, 0.10), 0 8px 28px rgba(0, 0, 0, 0.65);
   }
   ```

---

## 二、 二阶阻尼谐振子微分方程 ($m\ddot{x} + c\dot{x} + k(x - x_{\text{target}}) = 0$)

设固有角频率 $\omega_0 = \sqrt{k/m}$，无量纲阻尼比 $\zeta = \frac{c}{2\sqrt{mk}}$：
- **欠阻尼 ($\zeta < 1$)**：$x(t) = 1 - e^{-\zeta\omega_0 t}\left(\cos(\omega_d t) + \frac{\zeta}{\sqrt{1-\zeta^2}}\sin(\omega_d t)\right)$，超调量 $\exp\left(-\frac{\pi\zeta}{\sqrt{1-\zeta^2}}\right)$（对应 `Snappy` $\zeta=0.612$、`Gentle` $\zeta=0.783$、`Bouncy` $\zeta=0.462$）；
- **临界阻尼 ($\zeta = 1$)**：$x(t) = 1 - e^{-\omega_0 t}(1 + \omega_0 t)$，最快无振荡收敛；
- **过阻尼 ($\zeta > 1$)**：双指数单调衰减，严格 $0\%$ 超调（对应分栏磁吸 `HeavySnap` $\zeta=3.65$）。

---

## 三、 7 档感知幂律遮罩 ($y \approx x^{1.5}$) 与不动点仿射缩放

1. **7 档幂律 Alpha 采样阶梯（消除双色线性渐变马赫带断层）**：
   在 $28\text{px}$ 羽化距离内依次排布：`0% (0.000) -> 15% (0.051) -> 30% (0.149) -> 45% (0.302) -> 60% (0.502) -> 75% (0.702) -> 87% (0.851) -> 100% (1.000)`，触顶/触底时通过状态属性动态将对应遮罩高度归零。
2. **光标不动点仿射变换方程**：
   以指针 $(O_x, O_y)$ 为静止中心，缩放比 $r = S_{\text{target}} / S_{\text{current}}$：
   $$\text{idealTx} = O_x - (O_x - \text{tx}) \cdot r, \quad \text{idealTy} = O_y - (O_y - \text{ty}) \cdot r$$
   最大平移边界 $\text{maxTx} = \max(0, (\text{contentWidth}\cdot S - \text{viewportWidth})/2)$，越界施加 $0.7$ 阻尼衰减，平移初段施加 $\Delta d \le 4\text{px}$ 微颤死区。

---

## 四、 跨平台 CJK 输入法合成态互锁守卫 (IME Guard)

中日韩输入法挑选候选词按回车时，`e.isComposing` 可能已重置但 `e.keyCode === 229`。提交条件必须满足双重互锁：
$$\text{CanSubmit} = (\text{key} === \text{'Enter'}) \land (\neg\text{shiftKey}) \land (\neg\text{isComposing}) \land (\text{keyCode} \ne 229)$$
同时在 `isImePending` 期间拦截 `Escape` 的 `stopPropagation()` 防止误关外层弹窗；移动端/WebKit 输入框声明 `font-size: max(16px, var(--font-size-body))` 与 `field-sizing: content`。
