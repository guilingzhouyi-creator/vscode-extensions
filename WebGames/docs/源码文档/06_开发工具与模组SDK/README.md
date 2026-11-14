# 06 开发工具与模组 SDK (`dev_harness/` & `mod_sdk/`)

> 本分卷映射运行时快照调试工程底座 [dev_harness/](../../../dev_harness/)（6 个 `.gd`，944 LOC）与面向外部创作者/智能体同伴的 [mod_sdk/](../../../mod_sdk/)（5 份规范文档、19 个 JSON Schema、15 个 Python CLI/工具脚本、3 套模板与 1 个主题示例）。

---

## 一、定位划分

| 子系统 | 源码位置 | 目标受众 | 核心用途 |
| :--- | :--- | :--- | :--- |
| **快照调试基座** | `dev_harness/snapshot_mode/` | 引擎开发与集成测试 | 在 Debug/Test 构建中实现测试快照构建、运行时全域内存冻结抓取、注入初始化与对称清理 |
| **模组 SDK 与 CLI 工具链** | `mod_sdk/` | MOD 作者、AI 同伴代理、CI | 提供 MOD 脚手架生成、`check` 静态校验、`cook` 资源烘焙、`preview` / `play` 仿真、`pack` 打包与智能体通信协议 |

---

## 二、分册索引

| 专题文档 | 覆盖范围 | 关键入口与下游真源 |
| :--- | :--- | :--- |
| [01_快照调试基座_dev_harness.md](01_快照调试基座_dev_harness.md) | `dev_harness/snapshot_mode/*`（6 个 `.gd`） | `SnapshotEnvironmentGuard`、`SnapshotInjectionSolver`、`SnapshotCaptureTool`、`TestSnapshotBuilder`、`SnapshotCatalog` |
| [02_模组SDK内核与工具链映射.md](02_模组SDK内核与工具链映射.md) | `mod_sdk/tools/`、`schemas/`、`templates/`、`examples/`、`docs/` | `kalar-mod` CLI 门面、[SPECIFICATION.md](../../../mod_sdk/docs/SPECIFICATION.md) 与 `audit_sdk_sync.py` 零漂移校验 |
