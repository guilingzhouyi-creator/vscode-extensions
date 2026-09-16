---
档号: KALAR-DEV-2026-ST59-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST59 (Phase_63_自动化脚本库审查边界提升与规范性泛化治理)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_63_自动化脚本库审查边界提升与规范性泛化治理 —— 阶段3：规则库统一解耦与CLI跨平台规范工程化
形成日期: 2026-09-05
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 既有规则向声明式 Schema 映射总表; 跨平台同构包装器标准化规范; README.md 架构拓扑同步设计; value_domain_rules.json
---

# 施工细则：Phase 63 自动化脚本库审查边界提升与规范性泛化治理 —— 阶段3_规则库统一解耦与CLI跨平台规范工程化

> 施工开始日期：2026-09-05 中午
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已闭环（第2轮 value_domain_rules.json 统一收编落地，code_governance_rules.json v1.1.0 升级，sh/ps1 13 对同构与 README 矩阵更新）

> [!NOTE]
> **【施工目标】**：完成配置值域规则库与代码治理规则库的全面工程化落地，将既有 Phase 55/57/58/60/62 散落的值域规则无损收编迁移至 `scripts/config/value_domain_rules.json`；完成 `scripts/sh/` 与 `scripts/ps1/` 跨平台同构包装器的参数对齐与退出码标准化；同步更新 `scripts/README.md` 架构矩阵与门禁文档，消除所有文档与实现之间的漂移。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST59-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST59-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：自动化脚本库审查边界提升与规范性泛化治理专项需求（阶段 3：规则配置驱动与跨平台规范工程化）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST59-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST59-001_阶段1_声明式规则元模型与统一Finding数据模型设计.md) ｜ [阶段2](KALAR-DEV-2026-ST59-002_阶段2_泛化配置校验引擎与调度切片算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST59-004_阶段4_全量脚本自检与泛化门禁验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：
  - `WebGames/scripts/config/code_governance_rules.json:1-112`：现存治理规则库版本为 1.0.0，需升级至 1.1.0 并无缝收纳 4 项 GDScript 4 架构扩展规则；
  - `WebGames/scripts/README.md:1-250`：脚本库总目录需登记 `value_domain_rules.json` 数据字典与各 audit 工具通用 `--json` 标准协议；
  - `WebGames/scripts/sh/audit-all.sh:1-120` 与 `WebGames/scripts/ps1/audit-all.ps1:1-120`：需确保在调用各子审查任务时统一捕获标准退出码并输出分级摘要。
* **核心不变量约束断言**：
  - **Inv-GEN3-1（配置表无损迁移不变量）**：既有已生效的 20+ 项 VD_* 规则（Phase 55 数值除数守卫、Phase 57 契约条目守卫、Phase 58 停机超时守卫）迁移到 `value_domain_rules.json` 后，规则 ID、校验口径、错误文案与原有实现保持 100% 精确一致；
  - **Inv-GEN3-2（双同构零漂移不变量）**：`audit_pair_parity.py` 执行时，`scripts/sh/` 与 `scripts/ps1/` 13 对同构脚本的功能参数差集必须恒为 0，退出码语义严格对称；
  - **Inv-GEN3-3（文档事实源同步不变量）**：`scripts/README.md` 中的脚本职责表、参数支持表与任务依赖拓扑必须与实际代码保持完全同步，严禁产生文档滞后；
  - **Inv-GEN3-4（规则版本化演进不变量）**：`value_domain_rules.json` 与 `code_governance_rules.json` 必须显式声明 `schema_version` 与 `version`，支持平滑向下升级；
  - **Inv-GEN3-5（跨平台 UTF-8 管道不变量）**：所有 Python 脚本在 Windows 与 POSIX 环境下均必须通过 `ensure_utf8_stdout()` 保证无 BOM UTF-8 输出，杜绝任何控制台重定向乱码；
  - **Inv-GEN3-6（轻量低侵入不变量）**：配置驱动校验器仅依赖 Python 标准库（`json`, `pathlib`, `re`, `argparse`, `sys`），严禁引入任何第三方重型依赖。
* **防漂移最高指示**：
  - 第 1 轮严格仅落盘四阶段施工细则与路线图总索引登记，严禁在未获明确批准前修改任何业务代码或脚本实现；
  - 规则迁移必须保持全量已有测试用例 0 破坏。

---

## 一、 规则库迁移与工程化拓扑

### 1. 既有规则向声明式 Schema 映射总表

| 规则来源阶段 | 原始硬编码规则 ID | 声明式规则原语 | 目标文件路径 (`target_file`) | 校验约束摘要 |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 55** | `VD_POSITIVE_INT` | `positive_num` | `domains/potential.json` | `point_cost/tier_size` > 0 整数 |
| **Phase 55** | `VD_POSITIVE_INT` | `positive_num` | `domains/telemetry_account_lifecycle.json` | `event_id/salt_modulus` > 0 整数 |
| **Phase 55** | `VD_POSITIVE_FLOAT` | `positive_num` | `domains/lattice.json` | `decompiler/learner_normalize` > 0 浮点数 |
| **Phase 55** | `VD_POSITIVE_FLOAT` | `positive_num` | `domains/trading.json` | `market/safe_supply_floor` > 0 浮点数 |
| **Phase 55** | `VD_RANGE_ORDERED` | `range_ordered` | `domains/hardware_input.json` | `stick_deadzone/inner` < `stick_deadzone/outer` |
| **Phase 55** | `VD_INT_RANGE` | `bounded_range` | `domains/character_creation.json` | `attribute_init/dice/drop_lowest` ∈ [0, count-1] |
| **Phase 57** | `VD_CT_SCHEMA` | `required_sections` | `infrastructure/contracts.json` | `entries` 必须为数组 |
| **Phase 57** | `VD_CT_CONTRACT_ID` | `array_elements_schema` | `infrastructure/contracts.json` | `entries[*].contract_id` 必须为非空字符串 |
| **Phase 57** | `VD_CT_CONTRACT_ID_UNIQUENESS` | `unique_key` | `infrastructure/contracts.json` | `entries[*].contract_id` 全表唯一 |
| **Phase 57** | `VD_CT_ENDPOINT_KIND` | `enum_whitelist` | `infrastructure/contracts.json` | `endpoint_kind` ∈ {DTO, EVENT, COMMAND, GM_READONLY} |
| **Phase 58** | `VD_LC_01` | `range_ordered` | `infrastructure/lifecycle.json` | `shutdown_timeout_seconds` > `save_flush_timeout_seconds` |
| **Phase 58** | `VD_LC_02` | `bounded_range` | `infrastructure/lifecycle.json` | `force_kill_timeout_seconds` ∈ [1.0, 10.0] |
| **Phase 58** | `VD_LC_03` | `bounded_range` | `infrastructure/lifecycle.json` | `poll_interval_ms` ∈ [10, 1000] 整数 |

### 2. 跨平台同构包装器标准化规范

在 `scripts/sh/` 与 `scripts/ps1/` 中统一实现同构双实现：

```bash
# scripts/sh/audit-all.sh 规范骨架
#!/usr/bin/env bash
set -euo pipefail

# 统一参数解析
STRICT=0
JSON_OUT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=1; shift ;;
    --json) JSON_OUT=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
```

```powershell
# scripts/ps1/audit-all.ps1 规范骨架
[CmdletBinding()]
param (
    [switch]$Strict,
    [switch]$Json
)
$ErrorActionPreference = "Stop"
```

### 3. `scripts/README.md` 架构拓扑同步设计

更新 `scripts/README.md`，明确标记：
1. **架构解耦声明**：`audit_config.py` 不再硬编码任何业务域校验，全部配置约束由 `scripts/config/value_domain_rules.json` 声明式驱动；
2. **规则库治理矩阵**：明确标明 `code_governance_rules.json` 与 `value_domain_rules.json` 的职责分工与扩展流程；
3. **CI 门禁与退出码契约**：明确 0/1/2 退出码语义与 `--strict` 阻断策略。

---

## 二、 阶段交付物清单

1. `scripts/config/value_domain_rules.json` 完备配置文件落盘；
2. `scripts/config/code_governance_rules.json` 版本 1.1.0 升级；
3. `scripts/sh/` 与 `scripts/ps1/` 同构差集校验闭环；
4. `scripts/README.md` 文档与实现对齐更新；
5. 阶段 3 工程化不变量清单（Inv-GEN3-1 ~ Inv-GEN3-6）确立。
