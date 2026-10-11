# VS Code 计时扩展五层架构解耦与双语/UI 视觉规范指南

> 本指南为 `workspace-timing` 扩展五层解耦架构、双语国际化与视觉契约的权威参考手册。

---

## 一、 五层架构单向依赖契约

项目严格划分为五大架构层次，依赖必须保持严格的自顶向下单向流动：

```text
[1. UI 表现层 (Presentation)] (Webview Dashboard, StatusBarManager, Modal Dialogs)
         │
         ▼
[2. Engine 核心引擎 (Application)] (TimerEngine 状态机, TimeAggregator 聚合计算)
         │
         ▼
[3. Storage 存储协调 (Persistence)] (StorageCoordinator, RingBuffer, Journal 日志, HistoryFolder)
         │
         ▼
[4. Analytics 遥测分析 (Domain)] (Heatmap 算法, 趋势拟合, 多工作区占比)
         │
         ▼
[5. Shared 契约基石 (Shared)] (i18n 字典, 类型定义, 崩溃安全 DTO)
```

### 刚性架构红线：
1. **零反向依赖**：底层模块（Storage / Engine / Analytics / Shared）绝对严禁反向引用上层 UI 表现层或 VS Code 宿主窗口 API（如 `vscode.window`）；
2. **纯计算与无头可测性**：核心计时算法与聚合逻辑保持纯函数输入输出，在脱离 VS Code 运行时环境（Mock Clock 环境）下能够 100% 独立执行单元测试；
3. **单向门面封装**：对外只暴露经由 `StorageCoordinator` 等收口的门面接口，严禁跳板穿透。

---

## 二、 规范化生产命名契约

- **`stagingUri`**：磁盘快照原子写入时的专用暂存 URI，先落盘后原子重命名替换；严禁使用歧义的 `tmpPath` 或 `tempUri`；
- **`segmentedSessions`**：跨自然日原子拆分或 FIFO 滚动折叠后的标准会话片段序列；严禁混淆为 `sessions` 或 `splitSessions`；
- **`[DELTA]`**：Journal 增量日志追加行的标准语义前缀标记，供崩溃日志回放器精确识别。

---

## 三、 UI 100% 双语字典与暗色高对比度视觉契约

### 1. 100% 双语字典覆盖
- 界面文案必须通过 `i18n.t(key)` 提取，严格在 `src/i18n/zh-CN.ts` 与 `src/i18n/en.ts`（及扩展清单 `package.nls.json` / `package.nls.zh-cn.json`）中镜像双向对齐；
- **一票否决**：严禁在 HTML 模板、TS 逻辑、状态栏提示或弹窗中使用未在字典登记的硬编码中英文；
- 严禁向用户暴露底层内部存储术语（如 RingBuffer、NDJSON、dailyTotals 等实现细节）。

### 2. 暗色高对比度视觉契约
- 面板样式所有色彩必须通过 `:root` 声明的主题 CSS 变量（`var(--vscode-*)`）驱动；
- SVG 图标与活跃折线图刻度文字强制使用纯白 `#ffffff` 或主题适配明亮变量，严禁默认回退为暗黑色文字（导致在深色主题下不可见）；
- 严格遵循 WCAG AA 级以上色彩对比度标准。
