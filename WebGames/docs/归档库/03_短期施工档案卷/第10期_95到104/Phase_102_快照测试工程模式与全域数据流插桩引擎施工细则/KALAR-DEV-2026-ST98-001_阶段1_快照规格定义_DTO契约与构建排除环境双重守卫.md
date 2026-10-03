---
档号: KALAR-DEV-2026-ST98-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST98 (Phase_102_快照测试工程模式与全域数据流插桩引擎施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_102_快照测试工程模式与全域数据流插桩引擎施工细则 —— 阶段1：快照规格定义_DTO契约与构建排除环境双重守卫
形成日期: 2026-10-02
归档日期: 2026-10-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 快照规格定义_DTO契约; 排除环境双重守卫
---

# 施工细则：快照测试工程模式与全域数据流插桩引擎 —— 阶段1：快照规格定义、DTO契约与构建排除环境双重守卫

> [!NOTE]
> **【施工目标】**: 定义强类型快照数据载体（TestSnapshotBundleDTO），建立非调试/非测试环境的绝对熔断守卫（SnapshotEnvironmentGuard），并在引擎导出预设 export_presets.cfg 中配置排除过滤器，从物理与配置根源实现生产打包零污染。
> **施工开始日期：** 2026-10-02
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../../../路线图/路线图总索引.md)为准。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST98-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST98-002_阶段2_全域快照注入求解器与会话生命周期插桩引擎.md) ｜ [阶段3](KALAR-DEV-2026-ST98-003_阶段3_预置典型测试快照库_动态Builder与实时快照捕获器.md) ｜ [阶段4](KALAR-DEV-2026-ST98-004_阶段4_全域无头回归测试矩阵_导出排除断言与二十项门禁对齐.md)

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/docs/README.md`、`WebGames/export_presets.cfg`、`res://backend/domains/persistence_protocol/runtime_mode_gate.gd`
- **核心不变量约束断言**: 强类型 RefCounted 承载；高承压对象池复位契约（`reset_state()`）；非调试环境（`not OS.is_debug_build()`）下所有注入 API 强制熔断返回 `ERR_TEST_MODE_DISABLED`；生产 PCK 物理排除 `dev_harness/` 与 `tests/` 目录。
- **防漂移最高指示**: 严禁在生产业务代码（`backend/`、`frontend/`）中静态 preload 任何 `dev_harness/` 符号，确保导出排除后生产编译绝对零缺失依赖。

## 一、 阶段目标与数据契约设计
1. 建立 `TestSnapshotBundleDTO`，包含元数据头、账号与槽位、角色与生理状态、钱包与资产、背包物品（携带双 UID 与词缀）、地缘空间、任务 DAG 与领域扩展切片。
2. 建立 `SnapshotEnvironmentGuard`，提供 `is_injection_permitted() -> bool`，严格校验 `OS.is_debug_build()` 及运行模式闸门。
3. 更新 `WebGames/export_presets.cfg`，设置 `exclude_filter="tests/*,dev_harness/*,*.md,*.jsonl"`。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 建立 `res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd`。
- [x] Step 2: 建立 `res://dev_harness/snapshot_mode/snapshot_environment_guard.gd`。
- [x] Step 3: 更新 `WebGames/export_presets.cfg` 配置排除过滤器。
- [x] Step 4: 验证 DTO 序列化往返自洽性与对象池复位无残留。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-102-01-01 | 快照 DTO 序列化往返对等 | 包含全要素的快照 DTO 实例 | `from_dict(to_dict())` 还原后所有字段严格对等，`reset_state()` 后字段全空 |
| DoD-102-01-02 | 非调试环境绝对熔断守卫 | 模拟非 Debug 环境调用注入预检 | `is_injection_permitted()` 返回 false，阻断非法注入并记录告警 |
| DoD-102-01-03 | 导出预设排除项物理落地 | 查看 `export_presets.cfg` | `exclude_filter` 显式包含 `tests/*,dev_harness/*`，零空过滤器配置 |
