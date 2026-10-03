---
档号: KALAR-DEV-2026-ST99-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST99 (Phase_103_双域储存架构与异步流式加载引擎施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_103_双域储存架构与异步流式加载引擎施工细则 —— 阶段3：主线程切片预算提交器_动态预加载滑动窗口与DAG定向热重载
形成日期: 2026-10-03
归档日期: 2026-10-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 主线程切片预算提交器_动态预加载滑动窗口; DAG定向热重载
---

# 施工细则：双域储存架构与异步流式加载引擎 —— 阶段3：主线程切片预算提交器、动态预加载滑动窗口与DAG定向热重载

> [!NOTE]
> **【施工目标】**: 实现主线程切片预算提交器（FrameBudgetDispatcher），严格限制单帧主线程对象提交耗时（$\le 2.0\text{ms}$）；构建动态预加载滑动窗口管理器（PreloadWindowGovernor）与基于资源依赖图（ResourceDependencyDAG）的定向热重载器（TargetedHotReloader）。
> **施工开始日期：** 2026-10-03
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../../../路线图/路线图总索引.md)为准。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST99-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST99-001_阶段1_双域储存抽象契约_配置驱动底座与最小世界状态DTO.md) ｜ [阶段2](KALAR-DEV-2026-ST99-002_阶段2_主要数据极速恢复引擎与辅助资源并发调度管道.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST99-004_阶段4_全域无头回归测试矩阵_观测指标看板与二十项门禁对齐.md)

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd`、`res://backend/domains/persistence_protocol/editor_hot_reload_manager.gd`
- **核心不变量约束断言**: 主线程对象实例化或注册不得发生单帧突发卡顿，单帧预算严格由配置控制；预加载范围依据空间位置形成有限窗口，禁止无界读取；资源热更必须计算精确的失效传递闭包，定向热重载，严禁整体重启储存系统。
- **防漂移最高指示**: 遵循 DAG 有向无环图闭包扩散原则，避免环形依赖死循环。

## 一、 阶段目标与数据契约设计
1. 建立 `res://backend/domains/persistence_protocol/frame_budget_dispatcher.gd`，提供单帧时间预算切片排队与执行。
2. 建立 `res://backend/domains/persistence_protocol/preload_window_governor.gd`，实现基于中心节点的空间预加载与历史逐出。
3. 建立 `res://backend/domains/persistence_protocol/resource_dependency_dag.gd`，维护资源拓扑依赖并求解失效闭包。
4. 建立 `res://backend/domains/persistence_protocol/targeted_hot_reloader.gd`，协调 DAG 失效计算与定向重载流水线。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 实现 `frame_budget_dispatcher.gd`。
- [x] Step 2: 实现 `preload_window_governor.gd`。
- [x] Step 3: 实现 `resource_dependency_dag.gd`。
- [x] Step 4: 实现 `targeted_hot_reloader.gd`。
- [x] Step 5: 验证帧切片预算流控与依赖失效扩散计算。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-103-03-01 | 单帧预算切片执行 | 注入 10 项耗时提交任务并单帧 process(1.0ms) | 单帧处理数受时间限制平滑跨帧，无单帧卡死 |
| DoD-103-03-02 | 预加载滑动窗口逐出 | 滑动窗口中心由 A 移动至 C | 进入视野的资源加载，离开视野超限的资源被安全逐出 |
| DoD-103-03-03 | DAG 定向热重载失效扩散 | 建立 A->B->C 依赖并热更 A | C 与 B 均在定向失效集合中重新加载，无全局重置 |
