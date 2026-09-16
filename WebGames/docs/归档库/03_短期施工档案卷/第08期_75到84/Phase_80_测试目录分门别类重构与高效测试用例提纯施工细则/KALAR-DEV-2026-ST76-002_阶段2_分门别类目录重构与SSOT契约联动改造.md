---
档号: KALAR-DEV-2026-ST76-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST76 (Phase_80_测试目录分门别类重构与高效测试用例提纯施工细则)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_80_测试目录分门别类重构与高效测试用例提纯施工细则 —— 阶段2：分门别类目录重构与SSOT契约联动改造
形成日期: 2026-09-10
归档日期: 2026-09-12（半夜）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: TestArchitectureGuard; 五批次迁移规划; 标准代理桩代码契约; domains.json
---

# 施工细则：测试目录分门别类重构与高效测试用例提纯 —— 阶段2：分门别类目录重构与SSOT契约联动改造

> [!NOTE]
> **【施工目标】**：按照阶段1 设计的分层拓扑蓝图，执行物理与逻辑分层迁移；分五批次将 105 套测试套件迁移至 `tests/guards/`、`tests/integration/pipelines/`、`tests/unit/infrastructure/`、`tests/unit/frontend/` 和 `tests/unit/domains/`；在原有路径部署超轻量级继承适配桩；同步联动升级 `domains.json` 元数据、`test_registry.gd` 注册表与 `test_architecture_guard.gd` 架构守卫，达成目录结构优雅、调用链完全透明与全量门禁零回归。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST76-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST76-ATT_附件_案卷共享契约与上下文.md)。
> **【施工开始日期】：施工开始日期: 2026-09-10（晚上）** —— 真实读取系统时间。
> 状态：📋 施工中 (Round 1 规划设计中)
> **【用户指令溯源】**：同案卷阶段1（2026-09-10 晚上）。
> **对应需求源**：[路线图总索引](../../../../路线图/路线图总索引.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST76-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST76-001_阶段1_测试现状穿透审计与分层拓扑架构设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST76-003_阶段3_低效冗余测试去重与高性能断言用例提纯.md) ｜ [阶段4](KALAR-DEV-2026-ST76-004_阶段4_全域双向门禁阻断与平滑迁移验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：阶段1《测试现状穿透审计与分层拓扑架构设计》（六维分层拓扑与迁移映射表为直接施工依据）；`tests/support/test_case.gd`；`config/infrastructure/domains.json`；`scripts/py/audit_docs.py`。
* **核心不变量约束断言**：
  - `Inv-P80-2-1 (兼容桩透明性)`：所有遗留路径 `tests/unit/test_*.gd` 必须准确继承自其新物理路径，对外暴露的所有静态方法、常量与签名完全一致；
  - `Inv-P80-2-2 (注册表完备性)`：`test_registry.gd` 的 `get_all_test_classes()` 返回数组元素总数必须恒等于 105，包含 85 个后端/护栏套件与 20 个前端套件；
  - `Inv-P80-2-3 (双向一致性守卫)`：`test_architecture_guard.gd` 校验的新物理路径与 `domains.json` 登记项达成双向 0 差集。
* **防漂移最高指示**：严禁删除任何历史引用的文件实体；所有代理桩必须附带标准头注释与统一继承声明；严禁 `<...>` 模板占位符。

---

## 一、 分批次迁移执行映射与联动改造实施 (Phased Migration & Linkage Refactoring)

### 1.1 五批次迁移规划

| 批次 | 目标子目录 | 纳管套件类型 | 套件数量 | 核心迁移文件示范 |
| :--- | :--- | :--- | :---: | :--- |
| **批次 1** | `tests/guards/` | 架构守卫、配置与引导门禁 | 14 | `test_architecture_guard.gd`, `test_configuration_guard.gd`, `test_game_bootstrap_guard.gd` |
| **批次 2** | `tests/integration/pipelines/` | 跨域端到端业务流水线 | 28 | `test_character_creation_and_opening_pipeline.gd`, `test_session_lifecycle_and_hud_sync_pipeline.gd` |
| **批次 3** | `tests/unit/infrastructure/` | 基础设施与底层服务单测 | 12 | `test_event_bus.gd`, `test_storage_service.gd`, `test_clawback_service.gd` |
| **批次 4** | `tests/unit/frontend/` | 前端组件与视图模型单测 | 5 | `test_phase77_frontend_infrastructure.gd`, `test_frontend_infrastructure.gd` |
| **批次 5** | `tests/unit/domains/` | 46 个业务领域专属单测 | 46 | `test_inventory.gd`, `test_physics_thermodynamics.gd`, `test_world_navigation.gd`, `test_currency_economy.gd` 等 |

### 1.2 标准代理桩代码契约

以 `tests/unit/test_architecture_guard.gd` 为例：

```gdscript
# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 架构守卫测试 (兼容适配层)
# 文件路径: res://tests/unit/test_architecture_guard.gd
# 职责: 保持向后兼容性，桥接继承至 res://tests/guards/test_architecture_guard.gd
# ==============================================================================
class_name TestArchitectureGuard
extends "res://tests/guards/test_architecture_guard.gd"

# 继承自真源套件，确保 715 份文档引用与既有调用 100% 透明兼容。
```

### 1.3 `domains.json` 与 `test_registry.gd` 同步重构

```json
{
  "id": "inventory",
  "config": "domains.inventory",
  "narrative": "narratives.inventory",
  "test": "res://tests/unit/domains/inventory/test_inventory.gd",
  "legacy_test_path": "res://tests/unit/test_inventory.gd",
  "test_symbol": "TestInventoryDomain",
  "phase": 1
}
```

```gdscript
# ---- 1. 架构与规范门禁套件 (Guards) ----
const TestArchitectureGuard = preload("res://tests/guards/test_architecture_guard.gd")
const TestConfigurationGuard = preload("res://tests/guards/test_configuration_guard.gd")

# ---- 2. 跨域集成流水线 (Integration Pipelines) ----
const TestCharacterCreationPipeline = preload("res://tests/integration/pipelines/test_character_creation_and_opening_pipeline.gd")

# ---- 3. 基础设施层单测 (Infrastructure Unit) ----
const TestEventBus = preload("res://tests/unit/infrastructure/test_event_bus.gd")

# ---- 4. 46 业务领域专属单测 (Domain Unit) ----
const TestInventoryDomain = preload("res://tests/unit/domains/inventory/test_inventory.gd")
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 2.1: 创建分层子目录结构** - 创建 `tests/guards/`, `tests/integration/pipelines/`, `tests/unit/infrastructure/`, `tests/unit/frontend/`, `tests/unit/domains/`
- [ ] **Step 2.2: 分五批次物理迁移测试套件真源** - 将套件移入对应子目录，并更新文件头路径注释
- [ ] **Step 2.3: 部署全量兼容代理桩** - 在原有 `tests/unit/test_*.gd` 路径生成继承代理桩，确保对外暴露符号一致
- [ ] **Step 2.4: 联动更新 domains.json 元数据** - 同步 `test` 与 `legacy_test_path` 路径
- [ ] **Step 2.5: 联动重构 test_registry.gd** - 分组结构化重写 105 个预加载常量
- [ ] **Step 2.6: 更新 test_architecture_guard.gd 守卫逻辑** - 确保 TC-ARCH-01/03 校验双向差集为 0

---

## 三、 目录重构实施验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-P80-S2-01` | 五批次目录迁移完整性 | 校验 105 个套件新物理文件存在性 | 105/105 物理文件全部到位 |
| `TC-P80-S2-02` | 存量兼容代理桩完备性 | 校验 105 个存量路径代理桩存在与继承合法性 | 105/105 编译与继承无语法错误 |
| `TC-P80-S2-03` | `test_registry.gd` 注册完整性 | 执行 `get_all_test_classes()` 长度校验 | 恒等于 105 套件 |
| `TC-P80-S2-04` | `domains.json` 差集校验 | 运行 `test_architecture_guard.gd` TC-ARCH-01/03 | 双向差集为 0，单射校验 100% PASS |
| `TC-P80-S2-05` | 全量单元测试回归 | 运行 `scripts/ps1/test-run.ps1` | 105/105 套件，731/731 断言全绿 |
| `TC-P80-S2-06` | 覆盖率工具递归验证 | 运行 `python scripts/py/audit_test_coverage.py --strict` | 0 未覆盖域，结论通过 |
