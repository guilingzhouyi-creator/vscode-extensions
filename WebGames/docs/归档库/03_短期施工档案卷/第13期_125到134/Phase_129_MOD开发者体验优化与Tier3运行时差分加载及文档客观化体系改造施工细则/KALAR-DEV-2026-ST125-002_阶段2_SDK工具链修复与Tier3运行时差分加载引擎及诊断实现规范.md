---
档号: KALAR-DEV-2026-ST125-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST125 (Phase_129_MOD开发者体验优化与Tier3运行时差分加载及文档客观化体系改造施工细则)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_129_MOD开发者体验优化与Tier3运行时差分加载及文档客观化体系改造施工细则 —— 阶段2：SDK工具链修复与Tier3运行时差分加载引擎及诊断实现规范
形成日期: 2026-11-14
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: Tier3ContentOverrideLoader; 业务实现最高指示; Python SDK 工具链与模板修复规格; ModManifestValidator 结构化诊断强化规格; capabilities.json
---

# 施工细则：MOD开发者体验优化与Tier3运行时差分加载及文档客观化体系改造 —— 阶段2：SDK工具链修复与Tier3运行时差分加载引擎及诊断实现规范

> 施工开始日期: 2026-11-14（半夜）
> 状态: 已验收 (Phase 129 Completed)

> [!NOTE]
> 【施工目标】
> 实现 `WebGames/mod_sdk` Python 工具链与模板修复（解决 `.import` 误报、`capabilities.json` 动态加载、`scaffold_mod.py` 规范 `"tier"` 字段输出、全部官方模板/示例自检零错误）；强化 [`ModManifestValidator`](../../../../../backend/domains/character_creation/mod_manifest_validator.gd) 结构化诊断与字段校验；统一 [`ModPackageDiscoverySolver`](../../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) `mods/` 磁盘扫描路径；落地 [`GameConfig`](../../../../../backend/infrastructure/game_config.gd) 非破坏性 Mod 覆盖层与 `Tier3ContentOverrideLoader` 运行时差分加载器。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST125-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST125-001_阶段1_SDK工具链对齐与Tier3运行时差分覆盖架构契约规范.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST125-003_阶段3_SDK文档对齐与源码文档系统性客观重构工程规范.md) ｜ [阶段4](KALAR-DEV-2026-ST125-004_阶段4_全量自动化测试与CLI门禁及文档客观性回归验收规范.md)

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 离线 CLI 与脚手架源码：[`kalar_mod.py`](../../../../../mod_sdk/tools/kalar_mod.py) · [`scaffold_mod.py`](../../../../../mod_sdk/tools/scaffold_mod.py) · [`cook_assets.py`](../../../../../mod_sdk/tools/cook_assets.py) · [`check_mod.py`](../../../../../mod_sdk/tools/check_mod.py) · [`check_mod_common.py`](../../../../../mod_sdk/tools/check_mod_common.py)
- SDK 能力表与 Schema 定义：[`capabilities.json`](../../../../../mod_sdk/capabilities.json) · [`pack.schema.json`](../../../../../mod_sdk/schemas/pack.schema.json) · [`assets_manifest.schema.json`](../../../../../mod_sdk/schemas/assets_manifest.schema.json)
- 引擎配置中心与注册表源码：[`GameConfig`](../../../../../backend/infrastructure/game_config.gd) · [`ConfigRouterEngine`](../../../../../backend/infrastructure/config_router_engine.gd) · [`GameBootstrap`](../../../../../backend/infrastructure/game_bootstrap.gd) · [`ItemLoaderPipeline`](../../../../../backend/domains/item_namespace_registry/item_loader_pipeline.gd) · [`PhysicalVerbRegistry`](../../../../../backend/domains/physics_thermodynamics/physical_verb_registry.gd)
- MOD 验证、发现与网关集成源码：[`ModManifestValidator`](../../../../../backend/domains/character_creation/mod_manifest_validator.gd) · [`ModPrecheckAndAdaptationSolver`](../../../../../backend/domains/character_creation/mod_precheck_and_adaptation_solver.gd) · [`ModPackageDiscoverySolver`](../../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) · [`AssetPathResolver`](../../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd) · [`WorldGatewayFSM`](../../../../../backend/domains/world_gateway/world_gateway_fsm.gd)
- SDK 一致性同步审计脚本：[`sync_mod_sdk.py`](../../../../../scripts/py/sync_mod_sdk.py) · [`audit_sdk_sync.py`](../../../../../scripts/py/audit_sdk_sync.py)

### 1.2 核心不变量约束断言

- **全模板开箱零错误不变量 (Inv-SDK-TEMPLATES-GREEN-1)**：完成本阶段改造后，对 `mod_sdk/templates/`（`starter_story`、`audio_visual_pack`、`total_conversion_sample`）与 `mod_sdk/examples/`（`custom_hud_theme` 等）以及 `scaffold_mod.py` 新生成的 3 级脚手架目录执行 `kalar_mod.py check --json`，必须返回 `ok: true` 且零 error 项。
- **GDScript 与 Python 静态门禁全合规不变量 (Inv-SCRIPT-STYLE-STRICT-2)**：所有新增或修改的 `.gd` 文件必须满足 `audit_gd.py --strict`（标准 6 字段头、`class_name` 与 `snake_case` 文件名 1:1 一致、类与公共函数 `##` 文档注释、零禁用短变量名、零裸随机调用、用 `ErrorReporter` 替代全局打印告警、循环内零无界动态分配）；所有修改的 `.py` 脚本必须满足 `audit_script_comment.py`（6 字段头、78 字符分隔线、完整类型注解）。
- **确定性覆盖与纯函数无副作用回退不变量 (Inv-TIER3-DETERMINISTIC-REVERT-3)**：多 MOD 包启用时按 `enabled_pack_ids` 与确定性排序顺序依次叠加上下文表；当发生校验失败、切换至多人联机模式或调用 `purge_and_fallback_to_vanilla()` 时，[`GameConfig`](../../../../../backend/infrastructure/game_config.gd) 与物品注册表均恢复到 Vanilla 基线且无残留引用。

### 1.3 业务实现最高指示

仅在 `WebGames/mod_sdk/`、`WebGames/backend/`、`WebGames/scripts/py/` 指定范围内实现本阶段功能。不得改动 `frontend/views/**`、`docs/归档库/**`，也不得在 `backend/domains/` 下创建未在 `config/infrastructure/domains.json` 登记的新目录。

---

## 一、 具体工程实现规格

### 1.1 Python SDK 工具链与模板修复规格

1. **`WebGames/mod_sdk/tools/cook_assets.py` 修复**：
   - 新增可配置忽略集合 `IGNORED_METADATA_SUFFIXES = (".import", ".uid", ".tmp")`，扫描 `assets/` 目录时跳过 Godot 自动生成的 `.import`/`.uid` 伴生文件（不计入 `ERR_ASSET_DISALLOWED_TYPE` 错误，也不写入 `assets/manifest.json` 的资产哈希列表，可在统计字段中记录忽略数）。
   - 修复不支持后缀的修复建议字符串，准确列出 `ASSET_WHITELIST` 中的全量格式（包含 `.gltf`、`.glb`）。
   - 对现有存在 `.import` 误报的官方目录 `templates/audio_visual_pack`、`templates/total_conversion_sample`、`examples/custom_hud_theme` 重新运行 `cook_assets.py --manifest` 生成规范且无误报的 `assets/manifest.json`（如文件无变动则通过过滤即可立即转绿）。
2. **`WebGames/mod_sdk/tools/check_mod_common.py` 去硬编码重构**：
   - 将静态硬编码集合 `BUILTIN_DAG_IDS`、`BUILTIN_STARTER_KITS`、`BUILTIN_TRAIT_COSTS` 改为默认回退值，并新增 `_load_capabilities_defaults()` 从 `mod_sdk/capabilities.json` 动态加载权威内置 ID 集合（若文件缺失再回退安全兜底常量），保持模块对外导出接口完全兼容。
3. **`WebGames/mod_sdk/tools/scaffold_mod.py` 与 CLI 对齐**：
   - 生成 `pack.json` 时显式写入整数或规范 `"tier"` 字段（对齐 [`pack.schema.json`](../../../../../mod_sdk/schemas/pack.schema.json) 与 `kalar_mod.py init --tier {1,2,3}`）。
   - 检查 `check_mod.py` / `kalar_mod.py` 在 `--check-multi` 与 `bake` 流程的边界错误提示，确保出错时附带 `field_path` 与可执行 `suggestion`。
4. **`WebGames/mod_sdk/schemas/assets_manifest.schema.json` 对齐**：
   - 更新顶层 `$comment`/`description` 与属性定义，真实映射 `cook_assets.py` 产出的 `assets/manifest.json` 格式（`manifest_version`、`pack_id`、`asset_count`、`total_size_bytes`、`assets: [{path, type, size_bytes, sha256}]`），同时对旧版字段保留兼容性说明，并通过 `audit_sdk_sync.py`。

### 1.2 `ModManifestValidator` 结构化诊断强化规格

在 [`WebGames/backend/domains/character_creation/mod_manifest_validator.gd`](../../../../../backend/domains/character_creation/mod_manifest_validator.gd) 中实施以下增量改进（保持已有 `"valid": bool` 与 `"errors": Array[String]` 字段完全兼容）：

1. **新增结构化 `diagnostics: Array[Dictionary]` 返回字段**：每条诊断包含 `code: String`、`message: String`、`field_path: String`、`entity_id: String`、`fix_suggestion: String`。
2. **严格属性键白名单校验**：对自定义身世的 `attribute_bonus` 字典逐键校验是否属于规范六维属性集合 `["STR", "AGI", "CON", "INT", "SPR", "VIT"]`；发现非法键时精准上报 `ERR_DESTINY_UNKNOWN_ATTRIBUTE_KEY`，替代原仅求和 `net_sum` 的静默放行逻辑。
3. **包内重复 ID 与孤立特质一致性校验**：
   - 校验 `origins` / `custom_origins` 中的 `id` 唯一性，发现重复定义时返回带 `entity_id` 与 `field_path` 的明确错误。
   - 校验独立声明的 `custom_traits` 条目，确认极性 (`polarity`: `"positive"` / `"negative"`) 与点数花费 (`cost`) 符号规则一致，避免孤立特质配置出现负极性正消费或越界配置。

### 1.3 统一磁盘扫描路径与 `Tier3ContentOverrideLoader` 运行时引擎规格

1. **统一 `mods/` 多目录扫描 ([`ModPackageDiscoverySolver`](../../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd))**：
   - 将扫描顺序调整并与 [`AssetPathResolver`](../../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd) 对齐：`res://config/narratives/packs/`（最低优先级原生内置包）$\to$ `res://mods/` 与 `res://mods/narratives/`（开发期目录）$\to$ `mods/` 与 `mods/narratives/`（独立发布目录）$\to$ `user://mods/` 与 `user://mods/narratives/`（最高优先级用户沙箱）$\to$ 用户自定义 `custom_roots`。
   - 对规范化后的根目录列表去重；同时兼容直接放置于 `mods/<pack_id>/pack.json` 的标准包与位于 `mods/narratives/<pack_id>/pack.json` 的叙事包；当同一 `pack_id` 出现在多级目录时按后扫覆盖前扫原则确定权威版本并记录来源层级。
2. **`GameConfig` 运行时非破坏性覆盖层 ([`GameConfig`](../../../../../backend/infrastructure/game_config.gd))**：
   - 增加 `_base_tables: Dictionary`（于首次全量加载或 `reload_config()` 成功时固定保存 vanilla 只读基线副本）与 `_active_mod_overlays: Array[String]` 审计跟踪状态。
   - 新增静态 API：
     - `apply_mod_overlay_tables(overlay_tables: Dictionary, applied_pack_ids: Array = []) -> Dictionary`：在不改写 `_base_tables` 与磁盘 JSON 的前提下，重建 `_tables = _base_tables.duplicate(true)` 并施加差分表集，清空 `_path_cache`，递增 `_reload_counter`，广播 `"config.mod_overlay_applied"` 事件。
     - `clear_mod_overlay_tables() -> Dictionary`：若存在激活的模组覆盖，直接以 `_base_tables.duplicate(true)` 原子还原 `_tables`，清空 `_active_mod_overlays` 与 `_path_cache`，递增 `_reload_counter`，广播 `"config.mod_overlay_cleared"` 事件。
     - `has_active_mod_overlay() -> bool` 与 `get_active_mod_overlay_packs() -> Array`。
3. **新增核心脚本 `WebGames/backend/domains/narrative_orchestration/tier3_content_override_loader.gd` (`class_name Tier3ContentOverrideLoader`)**：
   - 职责：扫描已启用的 MOD 目录中 `content/` 子目录（`content/items/*.json`、`content/skills/*.json`、`content/rules/*.json`、`content/world/*.json`），以及顶层可选文件 `items.json` / `skills.json` / `game_rules.json` / `world.json`。
   - 模式规范化（统一映射模板与 Schema 变体）：
     - `MERGE` / `APPEND_MERGE` / 缺省 $\to$ `MERGE`（数组按主标识 `canonical_id` / `card_id` 去重追加或深合并；字典递归深度合并）。
     - `REPLACE_ENTRY` $\to$ `REPLACE_ENTRY`（按主标识或顶层键全量替换对应条目，不保留被替换条目的旧子键）。
     - `TOTAL_PURGE` / `REPLACE_EXISTING` $\to$ `TOTAL_PURGE`（按领域清洗原生表对应目标段落后仅加载 MOD 声明集合，保留系统安全兜底如 `_fallback`）。
   - 执行接口：`apply_enabled_packages(ordered_packages: Array, item_catalog: ItemRegistryCatalog = null) -> Dictionary`（调用 `GameConfig.apply_mod_overlay_tables(...)` 并同步重载 `ItemLoaderPipeline`）与 `revert_all_overrides(item_catalog: ItemRegistryCatalog = null) -> Dictionary`（调用 `GameConfig.clear_mod_overlay_tables()` 并重载物品注册表）。
4. **网关生命周期接线 ([`WorldGatewayFSM`](../../../../../backend/domains/world_gateway/world_gateway_fsm.gd))**：
   - 在 `precheck_and_configure_single_player_mods()` 预检通过后，依据预检通过并启用的包目录列表自动调用 `Tier3ContentOverrideLoader.apply_enabled_packages(...)`，并将摘要存入返回报告中的 `tier3_overlay_summary`。
   - 在 `purge_and_fallback_to_vanilla()` 中显式调用 `Tier3ContentOverrideLoader.revert_all_overrides(...)`，保证退回世界栏或切换至联机模式时全量撤销 Tier 3 数值/物品/世界覆盖。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 修复 `WebGames/mod_sdk/tools/cook_assets.py` 忽略 `.import`/`.uid` 伴生文件并修正扩展名建议清单，重跑全部官方模板与示例资产审计。
- [x] Step 2.2: 重构 `WebGames/mod_sdk/tools/check_mod_common.py` 从 `capabilities.json` 动态解析原版内置 ID，升级 `scaffold_mod.py` 补全 `"tier"` 字段与 `assets_manifest.schema.json` 映射。
- [x] Step 2.3: 升级 `WebGames/backend/domains/character_creation/mod_manifest_validator.gd`，实现 `diagnostics` 结构化输出、`STR..VIT` 属性键白名单校验、包内 ID 查重与孤立特质一致性检查。
- [x] Step 2.4: 升级 `WebGames/backend/domains/narrative_orchestration/mod_package_discovery_solver.gd`，统一 `res://mods/`、`mods/`、`user://mods/` 与 `narratives/` 双形态发现根目录及去重优先级。
- [x] Step 2.5: 升级 `WebGames/backend/infrastructure/game_config.gd` 实现非破坏性 Mod Overlay 快照管理与原子还原接口。
- [x] Step 2.6: 新建 `WebGames/backend/domains/narrative_orchestration/tier3_content_override_loader.gd`（严格遵守 6 字段头与编码风格门禁），并在 `world_gateway_fsm.gd` 与 `item_loader_pipeline.gd` 完成单机生效与联机/退出还原接线。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P129-0201** | 官方 SDK 模板与示例静态自检 | 对 `starter_story`、`audio_visual_pack`、`total_conversion_sample`、`custom_hud_theme` 运行 `kalar_mod.py check --json` | 全数返回 `ok: true` 且 `error_count == 0` |
| **DOD-P129-0202** | 三档 Tier 脚手架开箱校验 | 运行 `kalar_mod.py init --tier 1/2/3` 并立即执行 `check --json` | 三档生成的工程全部存在合法 `tier` 字段且一次通过 `check` |
| **DOD-P129-0203** | 多目录 `mods/` 发现一致性 | 将测试 MOD 分别放置于 `user://mods/<id>` 与 `user://mods/narratives/<id>` 调用扫描 | 两种目录结构均被发现且高优先级覆盖低优先级同 `id` 包 |
| **DOD-P129-0204** | Tier 3 差分覆盖与净空还原 | 启动启用 Tier 3 `content/` MOD 的单机网关，随后调用 `purge_and_fallback_to_vanilla()` | 启用时 `GameConfig` / `ItemLoaderPipeline` / `PhysicalVerbRegistry` 反映 MOD 值，还原后 100% 恢复 Vanilla 值 |
| **DOD-P129-0205** | 架构与脚本编码规范合规 | 运行 `audit_gd.py --strict`、`audit_sdk_sync.py` 与 `audit_script_comment.py` | 零新增错误、零违规、同步审计退出码为 `0` |
