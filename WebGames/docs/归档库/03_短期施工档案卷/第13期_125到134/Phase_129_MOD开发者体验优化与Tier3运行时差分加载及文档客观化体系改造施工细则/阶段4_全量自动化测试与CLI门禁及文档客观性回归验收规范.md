# 施工细则：MOD开发者体验优化与Tier3运行时差分加载及文档客观化体系改造 —— 阶段4：全量自动化测试与CLI门禁及文档客观性回归验收规范

> 施工开始日期: 2026-11-14（半夜）
> 状态: 已验收 (Phase 129 Completed)

> [!NOTE]
> 【施工目标】
> 构建覆盖 MOD SDK 脚手架与模板校验、统一 `mods/` 磁盘发现、`ModManifestValidator` 结构化诊断、`Tier3ContentOverrideLoader` 三态差分覆盖与 Vanilla 回退的完整无头测试流水线（`TestCase`），同步登记至 [`test_registry.gd`](../../../../tests/test_registry.gd) 与 [`TestArchitectureGuardDomain`](../../../../tests/guards/test_architecture_guard.gd)，完成文档静态核查、GDScript/Python 严格审计与全仓库统一门禁回归验收并更新路线图状态。

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 测试总注册表与架构护栏：[`test_registry.gd`](../../../../tests/test_registry.gd) · [`TestArchitectureGuardDomain`](../../../../tests/guards/test_architecture_guard.gd)
- 存量 MOD 集成测试参考基线：[`TestFullModDiskAndPlaythroughPipeline`](../../../../tests/integration/pipelines/test_full_mod_disk_and_playthrough_pipeline.gd) · [`test_mod_sdk_developer_ergonomics_pipeline.gd`](../../../../tests/integration/pipelines/test_mod_sdk_developer_ergonomics_pipeline.gd)
- 全量门禁与审计入口脚本：[`audit_sdk_sync.py`](../../../../scripts/py/audit_sdk_sync.py) · [`audit_docs.py`](../../../../scripts/py/audit_docs.py) · [`audit_gd.py`](../../../../scripts/py/audit_gd.py)
- 路线图看板索引：[`路线图总索引.md`](../../路线图总索引.md)

### 1.2 核心不变量约束断言

- **注册表与横切清单双同步不变量 (Inv-TEST-REGISTRY-PAIR-1)**：任何新增横切集成测试套件文件（如 `WebGames/tests/integration/pipelines/test_tier3_content_override_pipeline.gd`）必须同时 `preload` 并登记到 [`test_registry.gd`](../../../../tests/test_registry.gd) 以及 [`TestArchitectureGuardDomain`](../../../../tests/guards/test_architecture_guard.gd) 的 `CROSS_CUTTING_SUITES` 数组中，维持 `TC-ARCH-03` 注册数精确相等。
- **测试隔离与对称清理不变量 (Inv-TEST-ISOLATION-2)**：所有针对 `user://mods/` 与 `GameConfig` 覆盖层的测试必须在独立沙箱目录执行，并在每个测试结束或失败路径下调用对称清理与 `Tier3ContentOverrideLoader.revert_all_overrides()` / `GameConfig.reload_config()`，严禁污染后续测试套件或真实配置状态。
- **零降标诚实交付不变量 (Inv-HONEST-GATE-VERIFY-3)**：必须在最终一轮编辑完成后重新运行全部单元测试、GDScript 语法检查、Python CLI 自检、文档治理审计、SDK 同步审计与全量审计脚本 `WebGames/scripts/ps1/audit-all.ps1`；不得放宽任何既有基线或断言阈值。

### 1.3 验收闭环最高指示

仅在 `Phase_129` 阶段 2 与阶段 3 全部施工项核验通过并记录实际命令退出码后，方可将 `Phase 129` 阶段 1~4 的检查清单与 [`路线图总索引.md`](../../路线图总索引.md) 状态更新为「已验收」并推进在途计数。

---

## 一、 新增测试套件与回归验收清单设计

### 1.1 新增无头集成测试套件设计：`test_tier3_content_override_pipeline.gd`

- 所在路径（Round 2 新建）：`WebGames/tests/integration/pipelines/test_tier3_content_override_pipeline.gd`
- 类名：`TestTier3ContentOverridePipeline extends TestCase`
- 核心测试用例设计 (`TC-T3MOD-01` ~ `TC-T3MOD-06`)：
  1. `TC-T3MOD-01`：验证 [`ModManifestValidator`](../../../../backend/domains/character_creation/mod_manifest_validator.gd) 针对未知属性键、重复 `origin_id`、非法 `custom_traits` 极性/花费返回完整 `diagnostics`（含非空 `field_path`、`entity_id`、`fix_suggestion`）并维持 `errors` 兼容数组。
  2. `TC-T3MOD-02`：验证 [`ModPackageDiscoverySolver`](../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) 同时扫描顶层 `mods/<pack_id>` 与 `mods/narratives/<pack_id>` 并在用户沙箱层确定性覆盖低优先级包。
  3. `TC-T3MOD-03`：验证 Tier 3 `MERGE`（含 `APPEND_MERGE` 兼容别名）叠加 `content/items/*.json`、`content/rules/*.json`、`content/world/*.json` 后，`GameConfig`、`ItemLoaderPipeline` 与 `PhysicalVerbRegistry` 均生效新条目且保留原有 Vanilla 条目。
  4. `TC-T3MOD-04`：验证 `REPLACE_ENTRY` 按 `canonical_id` / 节段键全量替换旧配置且不残留被替换条目的旧子键。
  5. `TC-T3MOD-05`：验证 `TOTAL_PURGE`（含 `REPLACE_EXISTING` 兼容别名）清洗原生对应集合，并确认安全兜底键及核心必需表完整性不崩溃。
  6. `TC-T3MOD-06`：验证通过 [`WorldGatewayFSM`](../../../../backend/domains/world_gateway/world_gateway_fsm.gd) 启用单机 Tier 3 MOD 后切换至联机模式或调用 `purge_and_fallback_to_vanilla()`，`GameConfig`、`PhysicalVerbRegistry` 与物品注册表均 100% 恢复至 Vanilla 基线，且 `res://config/` 磁盘文件零修改。

### 1.2 CLI 与文档回归检查列表

1. Python CLI 端到端冒烟验证（零网络、纯离线）：
   - `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mod_sdk/templates/starter_story --json`
   - `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mod_sdk/templates/audio_visual_pack --json`
   - `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mod_sdk/templates/total_conversion_sample --json`
   - `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mod_sdk/examples/custom_hud_theme --json`
   - 临时目录执行 `kalar_mod.py init` (`--tier 1` / `2` / `3`) + `cook` + `check --json` + `preview --name ... --race ...` 并清理临时目录。
2. 全量门禁脚本执行：
   - `pwsh -File WebGames/scripts/ps1/test-run.ps1`
   - `pwsh -File WebGames/scripts/ps1/check-gdscript.ps1`
   - `python WebGames/scripts/py/audit_sdk_sync.py`
   - `python WebGames/scripts/py/audit_gd.py --strict`
   - `python WebGames/scripts/py/audit_docs.py --baseline WebGames/benchmarks/reports/docs_baseline.json`
   - `pwsh -File WebGames/scripts/ps1/audit-all.ps1`

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 编写 `WebGames/tests/integration/pipelines/test_tier3_content_override_pipeline.gd` 并同步注册至 `test_registry.gd` 与 `TestArchitectureGuardDomain.CROSS_CUTTING_SUITES`。
- [x] Step 4.2: 扩充 Python SDK CLI 测试/自检，覆盖官方 4 组模板/示例以及 3 档 `init -> cook -> check -> preview` 无报错流程。
- [x] Step 4.3: 依次执行 `test-run.ps1`、`check-gdscript.ps1`、`audit_sdk_sync.py`、`audit_gd.py --strict`、`audit_docs.py` 与 `audit-all.ps1` 并确认全部通过。
- [x] Step 4.4: 完成 `Phase_129` 阶段 1~4 复选框闭合与 `路线图总索引.md`（状态更新为 `已验收` 与周期案卷进度 `5/10`）。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P129-0401** | Godot 引擎无头全量单元测试与集成测试 | 执行 `pwsh -File WebGames/scripts/ps1/test-run.ps1` | 全部套件与断言 100% PASS，含 `TC-T3MOD-01..06` 与 `TC-ARCH-01..06` |
| **DOD-P129-0402** | GDScript 语法与静态规则门禁 | 执行 `check-gdscript.ps1` 与 `audit_gd.py --strict` | 零错误、零警告、零命名或注释风格违规 |
| **DOD-P129-0403** | MOD SDK CLI 与同步闭环 | 执行官方模板 `kalar-mod check --json` 及 `audit_sdk_sync.py` | 4 个官方模板/示例全绿，同步审计退出码为 `0` |
| **DOD-P129-0404** | 全工作区文档治理与统一审计 | 执行 `audit_docs.py` 与 `pwsh -File WebGames/scripts/ps1/audit-all.ps1` | 全部子检查 PASS，docs 零新增违规，工作区物理卫生完好 |
