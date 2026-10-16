# 单闭合边框公理与抗套娃视觉边界纪律 (Visual Enclosure Discipline)

## 一、 背景与认知痛点

在很多现代化前端界面与 AI 自动生成的页面中，“界面粗糙廉价、视觉压抑”的最主要诱因往往不是颜色搭配，而是**无休止的灰色线条嵌套（Russian-Doll Borders）**：
* 整个页面卡片套了一层边框；
* 卡片内的消息气泡套了一层边框；
* 气泡底部的工具栏套了一层边框；
* 工具栏里的每一个次级按钮和 Tag 再套一层边框。

视线在穿透内容时被无数条 1px 灰色硬线切割得支离破碎，用户的视觉认知负荷极速膨胀。

---

## 二、 核心公理：单闭合边框原则 (The 1-Border Rule)

> **刚性公理**：在从主背景画布向内部穿透的任何一条单向视线路径上，**至多只能穿过 1 层闭合的矩形边框**。

```
[主背景画布]
  │
  ├── 📦 外层容器实体 (输入框 / 卡片 / 弹窗) ──【第 1 层边框：合法】
  │     │
  │     ├── 🚫 内联操作按钮 ──【严禁再带边框！降级为 Ghost 或 Surface 填充】
  │     ├── 🚫 输入区域 ────【border-0 outline-none】
  │     └── ➖ 内部结构分割 ──【严禁闭合框！仅采用 1px 单向分割细线】
```

### 1. 容器内子控件自动降级协议
一旦外层容器已经成为一个具备独立边界的物理实体（如搜索栏、输入框、Modal 对话框、代码块）：
- **次级操作按钮 (Secondary Button)**：严禁使用 `border border-neutral-300`，改用表面微明度差填充（如 `bg-neutral-100 hover:bg-neutral-200`）；
- **内联小图标与辅助动作 (Ghost Action)**：常态必须为完全透明（`bg-transparent border-0`），仅在悬停（Hover）时展现 5%~10% 的微弱背景衬底；
- **内部输入区 (Textarea / Input)**：彻底剥离原生轮廓（`border-0 outline-none ring-0`）。

### 2. 单向细线替代原则 (Hairline Divider)
容器内部需要进行视觉分组时，严禁使用闭合方框包裹子元素，一律采用单向细线：
- 工具栏与输入区分隔：`border-t border-neutral-200/60`；
- 列表项横向分割：`border-b border-neutral-100`；
- 左右分栏中缝：`border-r border-neutral-200`。

---

## 三、 暗色模式下的物理高光倒角逆转

在暗色（Dark Mode）环境下，1px 的实线白色或浅灰边框会产生强烈的荧光刺眼感。

工业设计中，黑暗环境下的物体轮廓是由于**边缘倒角捕捉到环境顶光产生的微弱反光**。在前端实现中，必须使用内嵌阴影模拟这种物理反光：

```css
/* 浅色模式：外环微边框 + 向下落差柔和阴影 */
.elevation-popover {
  box-shadow: 
    0 0 0 1px rgba(0, 0, 0, 0.08),
    0 8px 24px rgba(0, 0, 0, 0.12);
}

/* 深色模式：消除外层突兀白线，转为内嵌 1px 发丝高光 */
[data-mode="dark"] .elevation-popover {
  box-shadow: 
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    0 8px 28px rgba(0, 0, 0, 0.65);
}
```

---

## 四、 视网膜高分屏发丝细边补偿 (Retina Hairline Ring)

在 2x / 3x 视网膜屏上，传统的 `1px` 边框在物理上占据了 2 到 3 个发光像素，视觉感受笨拙厚重。此外，动态切换 `border` 会计入盒模型排版计算，引发 1px 的尺寸抖动。

### 规避方案：
采用 `box-shadow` 代替 `border`，并根据设备像素比实施动态补偿：
```css
:root {
  --hairline-width: 1px;
}
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 2dppx), (resolution >= 2x) {
  :root {
    --hairline-width: 0.5px;
  }
}
@media (-webkit-min-device-pixel-ratio: 3), (min-resolution: 3dppx), (resolution >= 3x) {
  :root {
    --hairline-width: calc(1px / 3);
  }
}

.hairline-card {
  box-shadow: inset 0 0 0 var(--hairline-width) var(--color-border);
}
```
该方案完全脱离盒模型排版，在状态切换时实现真正的零尺寸抖动与微观顺滑感。
