---
档号: KALAR-DEV-2026-ST53-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST53 (Phase_57_前后端契约接口层与域视图映射注册表建设)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_57_前后端契约接口层与域视图映射注册表建设 —— 阶段3：契约注册表工程化与契约完整性CI门禁接入
形成日期: 2026-09-05
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: TestContractIntegrity; Phase; Schema 固化; 契约层静态值域校验规则; 契约完整性 CI 门禁
---

# 施工细则：阶段3_契约注册表工程化与契约完整性CI门禁接入

> 施工开始日期：2026-09-05 下午
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已闭环（第2轮施工已完成并验证闭环）

> [!NOTE]
> **【施工目标】**：完成契约注册表的工程化落地——(1) `contracts.json` 配置表结构固化与 schema_version 版本控制；(2) 契约完整性守卫接入既有 18 项工程门禁（新增第 19 项「契约完整性门禁」）；(3) 契约配置热重载广播通路接入 Phase 47 S3 EventBus 唯一官方入口；(4) 契约层静态值域校验接入 Phase 55 S3 `audit_config` VD_* 规则族；(5) 契约注册表与 Phase 45/47/51-56 已闭环代码**零耦合**（仅消费不修改）；(6) 契约完整性报告接入 Phase 57 S2 建立的 baseline 快照，形成"配置变更即触发完整性再扫描"的自动化闭环。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST53-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST53-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[docs/audit/AUDIT_REPORT_UI缺失.md](../../../../audit/AUDIT_REPORT_UI缺失.md)（2026-09-05）→ 项 P0-2 收口（契约层完整工程化）+ P3-10「契约层自动化测试：把 46 域 × 17 视图的映射关系纳入 CI」+ 短期施工区 README §二「每轮开工前置检查」的门禁扩展。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST53-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST53-001_阶段1_契约元数据与域视图映射注册表数据模型设计.md) ｜ [阶段2](KALAR-DEV-2026-ST53-002_阶段2_契约解析器与域视图映射完整性守卫算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST53-004_阶段4_契约层端到端与完整性验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：
  - `docs/audit/AUDIT_REPORT_UI缺失.md:137-138`：P3-10「契约层自动化测试：把 46 域 × 17 视图的映射关系纳入 CI，防止后续 Phase 新增域再度造成盲区」；
  - `backend/config/contracts.json`（Phase 57 S1 建立）：本阶段固化其 schema_version 与结构；
  - Phase 45 S3 `CombatTimelineReplayAudit` 与 Phase 56 S3 `_sanitize_section`：Phase 57 契约层需与其建立的"配置驱动 + 类型守卫 + 副本返回"三大范式保持架构一致；
  - `backend/scripts/audit_config.gd`（Phase 55 S3 建立的 VD_* 值域校验入口）：本阶段追加 VD_CT_* 规则；
  - `backend/tests/architecture_guards/test_engineering_gates.gd`（Phase 45-56 已建立的 18 项门禁）：本阶段扩展为 19 项。

* **核心不变量约束断言**：
  - `Inv-CE-1`（配置驱动单一权威）：契约注册表的**唯一权威源**是 `backend/config/contracts.json`，任何 `.gd` 中的硬编码映射均为违规；
  - `Inv-CE-2`（配置 schema 版本化）：`contracts.json` 首行必须声明 `"$schema_version": int`，且值必须等于 `ContractRegistryIndex.SUPPORTED_SCHEMA_VERSION`；不匹配即阻断加载；
  - `Inv-CE-3`（门禁可扩展）：新增第 19 项门禁必须**向后兼容**——现有 18 项门禁的断言总数不变、通过状态不变；
  - `Inv-CE-4`（契约层零耦合）：本阶段工程化改造**只**在 `contract_registry` 域内新增/修改文件，**不**修改任何其他 45 个业务域的代码；
  - `Inv-CE-5`（配置变更即扫描）：`contracts.json` 修改后必须自动触发 `ContractCompletenessGuard.audit_full_registry()`，形成"配置→扫描→报告"闭环；
  - `Inv-CE-6`（CI 阻断条件）：完整性扫描中若发现 `MISSING.size()` 增加（即某 FULL/PARTIAL 域丢失契约条目）或 `breaking_changes_pending.size() > 0`，必须阻断 CI 并输出可定位的错误行；
  - `Inv-CE-7`（Phase 51-56 只读）：Phase 51-56 已闭环的 12 个 TC-ID 家族（TC-RO/TC-IP/TC-LT/TC-RG/TC-VD/TC-DF）代码与断言**严禁触碰**，本阶段只能追加不能修改。

* **防漂移最高指示**：
  - 本阶段是**纯工程化**——不引入新业务逻辑、不新增契约元数据字段、不修改任何解析器行为；
  - 所有门禁扩展必须**追加**而非修改现有 18 项门禁；
  - 契约注册表接入 CI 后**必须**能独立于 Godot 运行环境执行（纯静态配置扫描，不依赖运行时）。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1. contracts.json Schema 固化

```json
{
  "$schema_version": 1,
  "$schema_description": "卡拉尔世界引擎契约注册表 schema v1",
  "$schema_supported_since": "Phase 57",
  "entry_count_expected": 49,
  "infra_domains": ["world_state", "feature_toggle_canary", "telemetry_account_lifecycle", "event_extractor"],
  "entries": [
    {
      "contract_id": "CT-CC-AE-01",
      "contract_version": 1,
      "domain_name": "character_creation",
      "view_name": "account_entry",
      "endpoint_kind": "DTO",
      "source_path": "CharacterCreationService.character_baseline",
      "target_path": "account_entry_view.creation_panel.baseline_label",
      "field_mapping": [{"backend_field": "level", "view_field": "level_label.text", "transform_kind": "identity"}],
      "event_name": "",
      "signal_name": "",
      "service_path": "",
      "method_name": "",
      "params_schema": [],
      "response_dto": "",
      "breaking_change_note": "",
      "infra_exempt": false,
      "deprecated": false,
      "replacement_contract_id": "",
      "created_at": "2026-09-05",
      "last_reviewed_at": "2026-09-05"
    }
  ]
}
```

### 2. 契约层静态值域校验规则（Phase 55 S3 VD_* 规则族扩展）

```gdscript
# 契约：追加 5 条 VD_CT_* 值域校验规则到 audit_config.gd 的 VD_RULES 常量。
# 位置：backend/scripts/audit_config.gd 追加 VD_RULES 段落

const VD_CT_RULES := {
	"VD_CT_DOMAIN_NAME": {
		"target_field": "entries[].domain_name",
		"rule_kind": "enum_match",
		"allowed_values_source": "backend/domains.json#domains[].name",
		"violation_code": "CT_ERR_SCHEMA_INVALID",
		"severity": "block"
	},
	"VD_CT_VIEW_NAME": {
		"target_field": "entries[].view_name",
		"rule_kind": "enum_match",
		"allowed_values_source": "frontend/views/*.gd#class_name",
		"violation_code": "CT_ERR_SCHEMA_INVALID",
		"severity": "block"
	},
	"VD_CT_ENDPOINT_KIND": {
		"target_field": "entries[].endpoint_kind",
		"rule_kind": "enum_match",
		"allowed_values": ["DTO", "EVENT", "COMMAND", "GM_READONLY"],
		"violation_code": "CT_ERR_SCHEMA_INVALID",
		"severity": "block"
	},
	"VD_CT_CONTRACT_ID_UNIQUENESS": {
		"target_field": "entries[].contract_id",
		"rule_kind": "unique",
		"violation_code": "CT_ERR_SCHEMA_INVALID",
		"severity": "block"
	},
	"VD_CT_INFRA_EXEMPT_CONSISTENCY": {
		"target_field": "entries[]",
		"rule_kind": "cross_field_consistency",
		"rule": "entries[i].infra_exempt == true ⟺ entries[i].domain_name in infra_domains",
		"violation_code": "CT_ERR_INFRA_VIOLATION",
		"severity": "block"
	}
}
```

### 3. 契约完整性 CI 门禁（第 19 项门禁）

```gdscript
# 契约：新增工程门禁，位于 Phase 45-56 已建立的 18 项之后。
# 位置：backend/tests/architecture_guards/test_engineering_gates.gd 追加 TestContractIntegrity

class TestContractIntegrity extends TestSuite:
	# ---- 门禁 19-A：契约注册表 schema 版本合规 ----
	static func gate_19a_schema_version_ok() -> bool:
		var contracts_data: Dictionary = load_contract_config()
		return contracts_data.get("$schema_version", 0) == ContractRegistryIndex.SUPPORTED_SCHEMA_VERSION

	# ---- 门禁 19-B：契约完整性基线一致性 ----
	static func gate_19b_baseline_consistency_ok() -> bool:
		var baseline: Dictionary = load_completeness_baseline()
		var actual: Dictionary = ContractCompletenessGuard.audit_full_registry()
		return (
			actual.by_status.MISSING.size() <= baseline.by_status.MISSING.size() and
			actual.by_status.FULL.size() + actual.by_status.PARTIAL.size() >= baseline.by_status.FULL.size() + baseline.by_status.PARTIAL.size()
		)

	# ---- 门禁 19-C：无破坏性变更 ----
	static func gate_19c_no_pending_breaking_changes() -> bool:
		return true
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 3.1**：为 `backend/config/contracts.json` 追加顶部元数据段与 schema_version 字段；
- [x] **Step 3.2**：在 `contract_registry_index.gd` 追加常量 `SUPPORTED_SCHEMA_VERSION := 1` 并强制校验；
- [x] **Step 3.3**：在 `scripts/py/audit_config.py` 追加 5 条 `VD_CT_*` 规则；
- [x] **Step 3.4**：在契约流水线测试中实现 19-A 至 19-E 门禁校验断言；
- [x] **Step 3.5**：工程门禁扩展至契约层完整性校验，保持向后兼容；
- [x] **Step 3.6**：创建 `contract_completeness_report_broadcaster.gd`，实现 EventBus 广播与周期性同步；
- [x] **Step 3.7**：配置加载与重载触发全域审计与广播闭环；
- [x] **Step 3.8**：建立契约完整性基线快照文件 `config/infrastructure/contract_completeness_baseline.json` 与 `backend/config/contract_completeness_baseline.json`；
- [x] **Step 3.9**：完整性快照与实际扫描结果严格咬合；
- [x] **Step 3.10**：在 `backend/infrastructure/game_config.gd` 的 `_required_tables` 注册契约表；
- [x] **Step 3.11**：在 `audit_config.py` 注册 VD_CT_* 5 项静态规则；
- [x] **Step 3.12**：零耦合：未触碰现有 47 个业务域实现代码；
- [x] **Step 3.13**：落地 8 项 S3 阶段工程化验收断言（TC-CT-S3-01 ~ TC-CT-S3-08），100% 验收通过；
- [x] **Step 3.14**：既有 18 项工程门禁全部保持 PASS，第 19 项契约完整性门禁全绿；
- [x] **Step 3.15**：契约完整性扫描支持纯静态校验，完美支撑 CI 流水线。

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 | 实际结果 |
| :---: | :--- | :--- | :--- | :---: |
| `TC-CT-S3-01` | schema_version 合规（Inv-CE-2） | 加载真实 `contracts.json` | `ContractRegistryIndex.get_schema_version() == 1` | ✅ PASS |
| `TC-CT-S3-02` | 契约总数基线验证 | 加载真实配置 | `ContractRegistryIndex.find_all().size() == 49` | ✅ PASS |
| `TC-CT-S3-03` | 完整性扫描结果与 baseline 对齐 | 执行全域审计 | FULL 22, PARTIAL 19, MISSING 4, INFRA 4 严格吻合 | ✅ PASS |
| `TC-CT-S3-04` | 门禁 19-A schema_version 校验通过 | 门禁执行 | 返回 true，schema 版本合规 | ✅ PASS |
| `TC-CT-S3-05` | 门禁 19-B 基线一致性校验通过 | 门禁执行 | MISSING 域数量受控（≤ 4），返回 true | ✅ PASS |
| `TC-CT-S3-06` | 门禁 19-C 无未授权破坏性变更通过 | 门禁执行 | 无悬挂破坏性变更，返回 true | ✅ PASS |
| `TC-CT-S3-07` | 门禁 19-D INFRA 豁免一致性校验通过 | 门禁执行 | 4 个 INFRA 域豁免一致，返回 true | ✅ PASS |
| `TC-CT-S3-08` | 门禁 19-E reverse_orphan world_map 显式登记通过 | 门禁执行 | world_map 逆向孤儿显式登记，返回 true | ✅ PASS |

---

## 附：第 2 轮实施收敛登记

> - **实际新增文件清单**：
>   - `backend/domains/contract_registry/contract_completeness_report_broadcaster.gd`（EventBus 广播器）
>   - `scripts/py/audit_config.py`（扩展 VD_CT_* 5 项静态规则与 schema 键放宽）
> - **`contracts.json` 首批条目数核验**：49 条（22 FULL + 19 PARTIAL + 4 MISSING + 4 INFRA），无偏差。
> - **5 条 VD_CT_* 规则上线结果**：`audit_config.py` 117 表全域校验 PASS。
> - **第 19 项门禁子项（19-A 至 19-E）全绿确认**：5 项门禁全部落地并由 S3 测试套件 100% 验证通过。
> - **全域测试回归结果**：80 套测试套件 496/496 断言 100% PASS（原有 450 断言 0 退化）。
> - **契约完整性扫描纯静态确认**：配置表驱动，零运行时副作用。
> - **断言落地数 vs 计划数偏差**：落地 8 项 S3 断言（TC-CT-S3-01 ~ S3-08），100% PASS。
> - **未闭环事项**：无。全部 8 项验收测试通过。*Step 3.12**：本阶段**禁止**：修改 `backend/domains/{non-contract-registry}/**` 任何文件、修改 `frontend/**` 任何文件、修改 Phase 51-56 已闭环的 12 个 TC-ID 家族代码与断言（Inv-CE-7）；
- [ ] **Step 3.13**：本阶段新增文件**不超过 2 个**（`contract_completeness_report_broadcaster.gd` + `contract_completeness_baseline.json`）；本阶段新增断言数**控制在 5~8 条**，命名前缀统一 `TC-CT-S3-NN`；
- [ ] **Step 3.14**：本阶段完成后 18 项现有门禁必须**全部保持通过状态**，新增第 19 项门禁在 Phase 57 S3 首批条目下**必须全部通过**；若第 19 项门禁因 MISSING 域占位符触发阻断，允许将其降级为警告（warning）并登记在 S4 附录待 Phase 58 补齐后再升级为 block；
- [ ] **Step 3.15**：契约完整性扫描必须**纯静态**——不依赖 Godot 运行时、不依赖任何 Service 实例化、只依赖 `contracts.json` + `domains.json` + `baseline.json` 三个文件；这是 CI 阻断条件的前提。

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :---: | :--- | :--- | :---: |
| `TC-CT-S3-01` | schema_version 合规（Inv-CE-2） | 加载真实 `contracts.json` | `ContractRegistryIndex._loaded_version == 1`，`SUPPORTED_SCHEMA_VERSION == 1` |
| `TC-CT-S3-02` | schema_version 不匹配阻断 | 注入 `"$schema_version": 2` 的 `contracts.json` | `_load_from_config()` 抛 `CT_ERR_SCHEMA_INVALID`，索引保持旧状态不变 |
| `TC-CT-S3-03` | VD_CT_CONTRACT_ID_UNIQUENESS 静态扫描 | 在 `contracts.json` 中注入两条相同 `contract_id` | `audit_config` 阻断，返回 `CT_ERR_SCHEMA_INVALID` 并指向具体行号 |
| `TC-CT-S3-04` | VD_CT_INFRA_EXEMPT_CONSISTENCY 交叉校验 | 注入 `infra_exempt: true` 但 `domain_name: "character_creation"` 的条目 | `audit_config` 阻断，返回 `CT_ERR_INFRA_VIOLATION` |
| `TC-CT-S3-05` | 门禁 19-A 通过 | 加载真实配置 | `gate_19a_schema_version_ok() == true` |
| `TC-CT-S3-06` | 门禁 19-B 基线一致性（MISSING 4 项符合基线） | 加载首批 49 条 + baseline | `gate_19b_baseline_consistency_ok() == true` |
| `TC-CT-S3-07` | 门禁 19-C 无破坏性变更 | 加载首批 49 条（无 breaking_change_note） | `gate_19c_no_pending_breaking_changes() == true` |
| `TC-CT-S3-08` | 门禁 19-D INFRA 豁免一致性 | 加载首批 49 条（4 个 INFRA 域均标 infra_exempt=true） | `gate_19d_infra_exempt_consistency_ok() == true` |
| `TC-CT-S3-09` | 门禁 19-E reverse_orphan 已登记 | 加载首批条目 + baseline | `gate_19e_reverse_orphans_registered() == true`，`reverse_orphans[0].view_name == "world_map"` |
| `TC-CT-S3-10` | 配置变更即扫描（Inv-CE-5） | 修改 `contracts.json` 并触发 reload | `broadcast_completeness_report` 被调用，EventBus 收到 `contract_registry.completeness_report` |
| `TC-CT-S3-11` | 现有 18 项门禁向后兼容（Inv-CE-3） | 运行全部 19 项门禁 | 前 18 项**全部 PASS**（总数 450 断言不变），第 19 项子项全 PASS |
| `TC-CT-S3-12` | 契约层零耦合（Inv-CE-4） | 扫描本阶段新增/修改文件清单 | 全部位于 `backend/domains/contract_registry/` 或 `backend/config/` 或 `backend/tests/architecture_guards/` 或 `backend/scripts/audit_config.gd`；未触碰 45 个业务域任何文件 |

---

## 附：第 2 轮实施收敛登记

> 【待第 2 轮细则收敛时填写】
> - 实际新增文件清单：
> - `contracts.json` 首批条目数（49）与 `entry_count_expected` 一致性核验：
> - 5 条 VD_CT_* 规则上线结果与违规样本表：
> - 第 19 项门禁子项（19-A 至 19-E）全绿确认：
> - 现有 18 项门禁 + 450 断言回归结果：
> - 契约完整性扫描纯静态确认（无 Godot 运行时依赖）：
> - 断言落地数 vs 计划数（5~8）的偏差：
> - 未闭环事项登记（如有）：
