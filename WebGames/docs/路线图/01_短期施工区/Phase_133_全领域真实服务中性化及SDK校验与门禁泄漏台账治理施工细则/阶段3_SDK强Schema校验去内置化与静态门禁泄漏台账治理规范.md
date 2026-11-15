# 施工细则：全领域真实服务、去卡拉尔中性化、SDK强校验与门禁泄漏台账治理 —— 阶段3：SDK强Schema校验去内置化与静态门禁泄漏台账治理规范

> 状态: 已验收 (Phase 133 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 为 `mod_sdk` 检查器接入全量 `schemas/*.schema.json` 校验并清理 `preview_mod` / `play_mod` / `scaffold_mod` 卡拉尔耦合默认值，补全 `total_conversion_sample`；同步加固 `audit_refactor_metrics.py --strict`、拆分 `_enforce_auth_guard`、关闭未实施规则缺口、清理 Godot 编译/运行警告、建立 ObjectDB/RID 泄漏检查、对齐 `test_fe_runner.gd` 并理顺路线图文档台账。

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段2_全领域真实服务接入与多命名空间及基座去卡拉尔化实现规范.md](阶段2_全领域真实服务接入与多命名空间及基座去卡拉尔化实现规范.md) · [code_governance_rules.json](../../../../scripts/config/code_governance_rules.json) · [audit_refactor_metrics.py](../../../../scripts/py/audit_refactor_metrics.py)
- **核心不变量约束断言**: 任何静态门禁修复不得降低阈值或删除真实检测规则；泄漏门禁须在所有测试套件 teardown 完毕后采样并验证无残余节点/对象/RID；`Phase 126` 仅在实际源码与测试均核实完备后方可闭合勾选。
- **最高指示断言**: `sh/ps1` 同构双实现保持参数面与语义 100% 对等（`audit_pair_parity.py`）。

---

## 一、 核心工程治理方案

1. **MOD SDK Schema 强校验、去内置化与模板完备**:
   - 在 [check_mod.py](../../../../mod_sdk/tools/check_mod.py) 接入基于 [mod_sdk/schemas/](../../../../mod_sdk/schemas/pack.schema.json) 的 `jsonschema` 验证阶段（校验 `pack.json`、`destinies.json`、`routing_rules.json`、`dag_graphs/*.json`、`world_topology`、`cutscene` 等声明文件），结构化输出 `DiagnosticItem`。
   - 改造 [check_mod_common.py](../../../../mod_sdk/tools/check_mod_common.py)、[preview_mod.py](../../../../mod_sdk/tools/preview_mod.py)、[play_mod.py](../../../../mod_sdk/tools/play_mod.py)、[play_mod_character.py](../../../../mod_sdk/tools/play_mod_character.py)、[play_mod_common.py](../../../../mod_sdk/tools/play_mod_common.py)、[play_mod_interactive.py](../../../../mod_sdk/tools/play_mod_interactive.py) 与 [scaffold_mod.py](../../../../mod_sdk/tools/scaffold_mod.py)：仅当显式非全转换扩展包时按需引用默认占位，全面消除对 `"CENTRAL_CONTINENT"` 与 `"卡拉尔圣城"` 的硬编码注入；当 `world_map.json` 等使用 `mod://` 图标时严格校验 `assets/` 存在性或提供合法样例资产。
   - 完善 [total_conversion_sample](../../../../mod_sdk/templates/total_conversion_sample/pack.json)（补充合规 `destinies.json`、匹配图标 PNG 资产，修正拓扑字段语义并同步 [mod_sdk/docs/](../../../../mod_sdk/docs/SPECIFICATION.md)），确保通过 CLI 与引擎加载双检。
2. **静态复杂度、规则覆盖与调度器修复**:
   - [audit_refactor_metrics.py](../../../../scripts/py/audit_refactor_metrics.py): 在 `_render_audit_console_report()` / `--strict` 分支同时校验 `report.get("governance", {}).get("gateVerdict") == "blocked"`，阻断复杂度超标放行。
   - [unified_protocol_dispatcher.gd](../../../../backend/domains/world_state/services/unified_protocol_dispatcher.gd) 与 [tier3_content_override_loader.gd](../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd): 将 `_enforce_auth_guard()` 拆分为 `_is_agent_blocked_request()` 与 `_is_protected_request()`，并将 `_process_single_package_override()` 拆分为 `_record_official_pack_if_applicable()`、`_mark_pack_applied()` 与 `_append_package_i18n_and_destiny_overlays()`，将圈复杂度降至 $\le 15$。
   - [audit_gd.py](../../../../scripts/py/audit_gd.py): 将 `audit_event_channels.py`、`audit_perf_hotspots.py` 等关联规则扫描计入规则覆盖闭合检测，同时为 `ADV-POOL-001` 与 `SIM-WRP-001` 提供真实静态检测与合规修复，实现 `code_governance_rules.json` 0 项未实施声明。
   - [audit_config.py](../../../../scripts/py/audit_config.py) 与 [audit_runner.py](../../../../scripts/py/audit_runner.py): 修复未传 `--report` 时默认覆盖公共报告路径的问题，并确保 `--strict` 在聚合器下正确生效。
3. **前端边界扩面、零编译/运行警告与泄漏门禁**:
   - [test_frontend_boundary_guard.gd](../../../../tests/guards/test_frontend_boundary_guard.gd): 覆盖 `frontend/systems/`，校验 `ui.json#service_mode == "real"` 及视图/系统零 `MockServiceContainer` 调用。
   - 修复 [asset_path_resolver.gd](../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd) `char(0)` 导致的 Godot 解析期 `Unexpected NUL character` 警告与 [attribute_init_solver.gd](../../../../backend/domains/character_creation/attribute_init_solver.gd) 命名占位符格式化错误。
   - 升级 [test_runner.gd](../../../../tests/test_runner.gd)、[test-run.ps1](../../../../scripts/ps1/test-run.ps1) 与 [test-run.sh](../../../../scripts/sh/test-run.sh)，增加 ObjectDB/RID 泄漏统计与阻断守卫并清理单例 teardown 残留；[test_fe_runner.gd](../../../../tests/test_fe_runner.gd) 对齐全量前端套件。
4. **路线图台账对齐**:
   - 核实 `Phase_126` 全部制品后闭合勾选状态，更新 `01_短期施工区/README.md` 过期期数说明与 `02_长期演进区/演进_02` 状态，对齐 `audit_docs.py` 台账。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 在 `check_mod.py` 接入 `mod_sdk/schemas/*.schema.json` 校验，重构工具链去卡拉尔默认值，补全 `total_conversion_sample` 并同步文档。
- [x] Step 3.2: 加固 `audit_refactor_metrics.py --strict`，降维 `_enforce_auth_guard` 与 `_process_single_package_override` 至 `CC <= 15`，闭环 `code_governance_rules.json` 规则覆盖并修正 `audit_config.py` / `audit_runner.py`。
- [x] Step 3.3: 扩展 `TestFrontendBoundaryGuard` 至 `frontend/systems/` 与真实服务模式守卫，清零 NUL 解析告警与格式化报错，新增 ObjectDB/RID 泄漏门禁并补齐 `test_fe_runner.gd`。
- [x] Step 3.4: 核实并对齐 `Phase_126`、`01_短期施工区/README.md` 与 `演进_02` 路线图台账状态。

---

## 三、 工程治理与门禁验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P133-S3-01 | Schema 强校验拒错 | 损坏字段的 `pack.json`/`destinies.json` 传入 `kalar_mod.py check` | 捕获 Schema 错误返回退出码 1；合法两套样例包全绿 |
| DOD-P133-S3-02 | `CC <= 15` 与规则闭环 | `python scripts/py/audit_refactor_metrics.py --strict` 与 `audit_gd.py` | `gateVerdict` 无 `CC > 15` 阻断；`声明未实施 0 项` |
| DOD-P133-S3-03 | 零 NUL/格式告警与零泄漏 | `check-gdscript.ps1`、`test-run.ps1`、`godot -s res://tests/test_fe_runner.gd` | 0 条 NUL/Formatting 错误；0 ObjectDB/RID 泄漏；全量前端套件通过 |
| DOD-P133-S3-04 | 路线图台账自洽 | `pwsh scripts/ps1/audit-docs.ps1` | 0 error / 0 warn，施工区与总索引状态 100% 一致 |
