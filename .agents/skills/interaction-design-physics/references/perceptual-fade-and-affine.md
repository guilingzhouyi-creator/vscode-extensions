# 感知幂律渐隐遮罩与不动点仿射变换方程 (Perceptual Fade & Affine Physics)

## 一、 7 档非线性感知幂律渐隐遮罩 (7-Stop Power-Law Mask)

### 1. 传统线性渐变的视觉断层缺陷
在长列表或滚动容器边缘，开发者通常直接使用双色线性渐变：
```css
/* ❌ 错误：线性 Alpha 渐变导致发丝边缘切断与马赫带效应 (Mach Bands) */
mask-image: linear-gradient(to bottom, transparent, black 32px);
```
在视网膜高分屏上，人眼感知亮度的非线性特性（韦伯-费希纳定律）会导致中段出现突兀的灰色切线与色阶断层。

### 2. 7 档幂律采样数学模型
将羽化过渡区间的 Alpha 曲线拟合为 $y \approx x^{1.5}$ 幂律感知模型，分 7 个离散采样点递增：

| 采样位置百分比 | 理论采样值 | 对应十六进制 Alpha | 感知透明度 |
| :--- | :--- | :--- | :--- |
| **0%** | 0.000 | `#00` (transparent) | 完全透明 |
| **15%** | 0.051 | `#0d` (5.1%) | 微雾渗入 |
| **30%** | 0.149 | `#26` (14.9%) | 柔和显现 |
| **45%** | 0.302 | `#4d` (30.2%) | 加速上升 |
| **60%** | 0.502 | `#80` (50.2%) | 中位透光 |
| **75%** | 0.702 | `#b3` (70.2%) | 高透光 |
| **87%** | 0.851 | `#d9` (85.1%) | 接近全透 |
| **100%** | 1.000 | `#ff` (black) | 100% 实体 |

结合动态滚动位置传感器（触顶/触底动态将对应的渐隐高度收缩为 0），呈现如沉入水雾般的边缘隐没质感。

---

## 二、 以指针为不动点的仿射 Pan/Zoom 物理学 (Fixed-Anchor Affine Pan/Zoom)

### 1. 痛点分析
普通图片或画布放大时，若粗暴以视口中心 $(W/2, H/2)$ 为原点放大，用户鼠标所在的光标关注区域会被推离当前视口，产生反人类的操作对抗。

### 2. 数学方程推导
将用户鼠标光标（或双指手势中心）$(O_x, O_y)$ 设定为物理世界的不变不动点：

设当前缩放比为 $S_{\text{current}}$，目标缩放比为 $S_{\text{target}}$，当前位移为 $(\text{tx}, \text{ty})$：

$$\begin{cases}
c = \frac{S_{\text{target}}}{S_{\text{current}}} \\
\text{idealTx} = O_x - (O_x - \text{tx}) \cdot c \\
\text{idealTy} = O_y - (O_y - \text{ty}) \cdot c
\end{cases}$$

### 3. 边界钳制与阻尼溢出 (Boundary Clamping with Damping)
为了防止图像被拖出屏幕外变成虚空，施加基于视口宽高的最大允许平移边界：

$$\text{maxTx} = \max\left(0, \frac{\text{fitWidth} \cdot S - \text{viewportWidth}}{2}\right)$$

当位移溢出边界时，应用物理阻尼系数 $y = 0.7$ 柔化拖拽手感：
$$\text{clampedTx} = \text{clamp}(\text{idealTx}, -\text{maxTx}, \text{maxTx})$$

同时在手势开始阶段注入 $4\text{px}$ 移动死区（$\Delta d = \sqrt{dx^2 + dy^2} \le 4\text{px}$），彻底过滤手部微颤引起的意外画面漂移。
