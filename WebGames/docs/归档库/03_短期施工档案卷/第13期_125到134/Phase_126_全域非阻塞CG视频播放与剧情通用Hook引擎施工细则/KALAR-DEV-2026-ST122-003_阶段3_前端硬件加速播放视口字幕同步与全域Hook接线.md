---
档号: KALAR-DEV-2026-ST122-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST122 (Phase_126_全域非阻塞CG视频播放与剧情通用Hook引擎施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_126_全域非阻塞CG视频播放与剧情通用Hook引擎施工细则 —— 阶段3：前端硬件加速播放视口字幕同步与全域Hook接线
形成日期: 2026-11-08
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 工程化重构最高指示; 前端硬件加速播放视口字幕同步; 全域Hook接线
---

# 施工细则：全域非阻塞CG视频播放与剧情通用Hook引擎 —— 阶段3：前端硬件加速播放视口字幕同步与全域Hook接线

> 施工开始日期: 2026-11-08
> 状态: 已验收 (Phase 126 Completed)

> [!NOTE]
> 【施工目标】
> 构建前端硬件加速全屏播放视口 `CutscenePlayerView` 与表现层桥接器 `CutscenePresenter`；
> 落实高精度多语言字幕时间戳同步、长按防误触跳过守卫，以及与剧情 DAG 引擎的无缝挂起恢复接线。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST122-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST122-001_阶段1_视频与CG媒体数据契约参数化DTO与Hook配置标准规范.md) ｜ [阶段2](KALAR-DEV-2026-ST122-002_阶段2_非阻塞异步装载引擎与播放编排状态机核心实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST122-004_阶段4_无头测试夹具端到端流水线与全域门禁回归验收.md)

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针
- 阶段 2 核心实现：[阶段2_非阻塞异步装载引擎与播放编排状态机核心实现.md](KALAR-DEV-2026-ST122-002_阶段2_非阻塞异步装载引擎与播放编排状态机核心实现.md)
- 前端模态遮罩基础：[`ModalManager`](../../../../../frontend/ui_infrastructure/modal_manager.gd)
- 多语言文案中枢：[`UIIntermediary`](../../../../../frontend/i18n/ui_intermediary.gd)

### 1.2 核心不变量约束断言
- **单向快照注入不变量 (Inv-VIEW-INJECTION-1)**：视图层严禁持有后端状态机私有指针，仅通过 `apply_snapshot` 接收单向投影；
- **防误触互锁不变量 (Inv-SKIP-INTERLOCK-2)**：可跳过视频必须经由长按（Hold）或二次按键确认，杜绝玩家因误触 ESC 或点击而中断剧情体验；
- **声画同步不变量 (Inv-AV-SYNC-3)**：字幕事件严格依据 `VideoStreamPlayer.get_stream_position()` 毫秒级对齐。

### 1.3 工程化重构最高指示
视图组件必须挂载在独立全屏画布层上，播放时自动隐匿下层 HUD，播放结束后保证 100% 还原原有焦点与视口层级。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 编写 `CutscenePlayerView`，集成 `VideoStreamPlayer`、淡入淡出遮罩与全屏适配。
- [x] Step 3.2: 在 `CutscenePlayerView` 内置 `_subtitle_label` 多语言动态高亮字幕层。
- [x] Step 3.3: 在 `CutscenePlayerView` 内置 `_setup_skip_ui` 长按跳过交互守卫与进度反馈。
- [x] Step 3.4: 编写 `CutscenePresenter`（`frontend/presentation/common/cutscene_presenter.gd`）与 `CutsceneEventBridge`（`frontend/systems/cutscene_event_bridge.gd`），完成与领域事件总线及 UI 基础设施的接线。
- [x] Step 3.5: 通过 `PrologueCutscenePort` 与 `PrologueExecutionKernel` 在 `PrologueDagExecutionEngine` 植入标准 Hook 拦截器，实现剧情自动挂起与恢复。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-CS-0301** | 全屏视口拉起与自动隐匿 HUD | 派发播放命令至 `CutscenePresenter` | 视口置顶展示，HUD 处于隐藏态 |
| **DOD-CS-0302** | 字幕时间轴同步刷新 | 视频时间戳推进到对应行时段 | 标签正确显示对应语言翻译，超出时段自动清空 |
| **DOD-CS-0303** | 剧情流程无缝恢复 | 触发视频播放完成 `finished` | 剧情 DAG 接收到恢复信号并成功激活下一节点 |
