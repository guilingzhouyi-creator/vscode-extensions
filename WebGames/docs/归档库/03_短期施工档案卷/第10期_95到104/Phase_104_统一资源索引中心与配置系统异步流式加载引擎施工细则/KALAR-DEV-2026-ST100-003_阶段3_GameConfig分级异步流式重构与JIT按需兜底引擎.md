---
档号: KALAR-DEV-2026-ST100-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST100 (Phase_104_统一资源索引中心与配置系统异步流式加载引擎施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_104_统一资源索引中心与配置系统异步流式加载引擎施工细则 —— 阶段3：GameConfig分级异步流式重构与JIT按需兜底引擎
形成日期: 2026-10-03
归档日期: 2026-10-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: GameConfig分级异步流式重构; JIT按需兜底引擎
---

# 施工细则：统一资源索引中心与配置系统异步流式加载引擎 —— 阶段3：GameConfig分级异步流式重构与JIT按需兜底引擎

> [!NOTE]
> **【施工目标】**: 重构全局静态配置底座（GameConfig），消除开机 66+ 文件全量同步扫描阻塞；引入 L0 核心底座极速同步加载（$\le 5.0\text{ms}$）、辅助资源工作池后台流式加载与 JIT 实时靶向按需兜底引擎，保持同步 Getter 契约 100% 向后兼容。
> **施工开始日期：** 2026-10-03
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../../../路线图/路线图总索引.md)为准。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST100-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST100-001_阶段1_统一资源索引目录契约_多态解码器与批量加载接口设计.md) ｜ [阶段2](KALAR-DEV-2026-ST100-002_阶段2_统一资源索引编排器与多态解码注册中心实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST100-004_阶段4_全域无头回归测试矩阵_耗时基线验证与二十项门禁对齐.md)

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `res://backend/infrastructure/game_config.gd`、`res://backend/domains/persistence_protocol/storage_resource_catalog.gd`
- **核心不变量约束断言**: 绝不破坏 `GameConfig.get_*` 的同步静态调用语义；开机优先加载 `critical_boot_tables` 确保世界最小骨架瞬间就绪；全域剩余表异步流式装载；未命中表由 JIT 实时靶向单表装载兜底，彻底杜绝缺失报错。
- **防漂移最高指示**: 保持各层单向依赖架构，基础设施层与领域层通过动态反射解耦，严禁产生跨层级静态循环引用。

## 一、 阶段目标与数据契约设计
1. 在 `res://backend/infrastructure/game_config.gd` 中解耦静态物理递归扫描。
2. 引入 `ensure_l0_loaded_sync()`，仅同步加载核心启动配置表（耗时 $\le 5.0\text{ms}$）。
3. 引入 `load_via_storage_async()`，基于 `StorageResourceCatalog` 与 `AuxiliaryWorkerPool` 并行装载非关键业务配置。
4. 增强 `_ensure_table_loaded_jit()`，当同步查询遇到未预热表时实施 $O(1)$ 靶向即时补齐。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 改造 `game_config.gd` 支持资源目录接入与 JIT 按需装载。
- [x] Step 2: 实现 `ensure_l0_loaded_sync()` 极速开机启动。
- [x] Step 3: 实现 `load_via_storage_async()` 后台流式装载。
- [x] Step 4: 全域 112 套既有测试 100% 绿色回归验证。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-104-03-01 | L0 极速启动预算 | 执行 `GameConfig.ensure_l0_loaded_sync()` | 耗时 $\le 50\text{ms}$，`infrastructure.storage` 等核心表就绪 |
| DoD-104-03-02 | JIT 实时靶向兜底 | 未全量装载时调用 `GameConfig.get_dict("domains.quest", "")` | 触发 JIT 靶向装载并返回有效配置字典，不发生静默缺失 |
| DoD-104-03-03 | 契约零破坏兼容性 | 执行全域既有 112 套单元测试与业务流水线 | 801 项断言 100% 通过，无破坏性报错 |
