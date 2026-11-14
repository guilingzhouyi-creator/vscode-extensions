# 施工细则：官方与三方MOD全插件化架构及去内置剧情与全端入口重构 —— 阶段2：组合式MOD运行时引擎与统一DAG序章及全端视图实现规范

> 施工开始日期: 2026-11-14
> 状态: 已验收 (Phase 130 Completed)

> [!NOTE]
> **【施工目标】** 本阶段规划并约束 Phase 130 运行时代码层的全部改造细节，打通 `GameConfig` 可组合叠层引擎、`ModPackageDiscoverySolver` 与全品类 `Tier3ContentOverrideLoader`，彻底废除线性 4 阶段序章与卡拉尔硬编码回退逻辑，修复单机存档锁与联机摘要校验生命周期，并落地 `world_gateway`、`mod_workbench`、交互式 `prologue` 视图及 `service_mode = "real"` 全端接线。

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 阶段 1 上游契约规范: [阶段1_插件化官方MOD契约架构与引擎边界重构规范.md](阶段1_插件化官方MOD契约架构与引擎边界重构规范.md)
- 配置与资源底座: [game_config.gd](../../../../backend/infrastructure/game_config.gd) · [game_config_loader.gd](../../../../backend/infrastructure/game_config_loader.gd) · [game_bootstrap.gd](../../../../backend/infrastructure/game_bootstrap.gd) · [asset_path_resolver.gd](../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd)
- 模组发现与覆盖管线: [mod_package_discovery_solver.gd](../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) · [tier3_content_override_loader.gd](../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd) · [prologue_dag_registry.gd](../../../../backend/domains/narrative_orchestration/prologue_dag_registry.gd) · [world_mod_affinity_manager.gd](../../../../backend/domains/narrative_orchestration/world_mod_affinity_manager.gd)
- 创角序章与网关服务: [authoritative_reincarnation_solver.gd](../../../../backend/domains/character_creation/authoritative_reincarnation_solver.gd) · [character_creation_protocol_handler.gd](../../../../backend/domains/character_creation/character_creation_protocol_handler.gd) · [world_gateway_fsm.gd](../../../../backend/domains/world_gateway/world_gateway_fsm.gd) · [save_load_routing_solver.gd](../../../../backend/domains/world_gateway/save_load_routing_solver.gd)
- 前端边界与服务容器: [nav_manager.gd](../../../../frontend/navigation/nav_manager.gd) · [account_entry_view.gd](../../../../frontend/views/account_entry/account_entry_view.gd) · [real_service_container.gd](../../../../frontend/domain_boundary/services/real_service_container.gd) · [service_locator.gd](../../../../frontend/domain_boundary/service_locator.gd)

### 1.2 核心不变量约束断言

1. **叠层非破坏性与零泄漏不变量**: `GameConfig` 每次应用 MOD 叠层不再用 `_base_tables` 盲目抹除先前已装配的基础/前置 MOD；`_ensure_table_loaded_jit_with_base()` 在命中 `_purged_prefixes` 时禁止从 `res://config/` 回灌污染；`exit_to_gateway()`、`logout()` 与 `GameBootstrap.teardown()` 必须对称清空 `_active_mod_stack` 与 Tier 3 注册表并重建纯净底座态。
2. **单一 DAG 序章执行轨不变量**: 废除 `PrologueExecutionKernel` 对线性 `prologue_stages`（`"1".."4"`）的兜底执行分支；在线客户端协议（`CharacterCreationProtocolHandler.dispatch_prologue`、`SaveLoadRoutingSolver`）与无头跑测统一经过 `NarrativeDagExecutionEngine` 驱动当前挂载 MOD 的 `dag_graphs/`；零 DAG 可用时确定性报错 `ERR_NO_BASE_CONTENT_MOD`。
3. **无内置卡拉尔假定不变量**: `AuthoritativeReincarnationSolver`、`ModAdaptationManifestMerger`、`StarterLoadoutDispatcher`、`ProloguePlaceholderResolver`、`GameModeRoutingSolver`、`WorldSessionRuntimeService` 等所有域服务代码中不得保留 `"HUMAN"`、`"IMPERIAL_NOBLE"`、`"CENTRAL_CONTINENT"`、`"KIT_HUMAN_DEFAULT"`、`"WORLD_DEFAULT_SP_01"`、`"loc_city_kalar_01"` 或硬编码中文世界观文案作为运行兜底。
4. **前端单向数据流与 `TestFrontendBoundaryGuard` 约束**: 新增与重构前端视图须严格继承 `BaseScreen` / `BaseModal`、复用 `DesignTokens`、通过 `apply_snapshot(snapshot: Dictionary)` 消费数据且严禁引用 `res://backend/`、直接跨白名单直查 `GameConfig` 或在循环内产生冗余堆分配（`ADV-PRF-002`）。

### 1.3 业务实现防漂移最高指示

- **禁绝双轨兼容暗门**: 不得在前端视图（如 `AccountEntryTabs`）中保留 `select_mode(1, {}, [])` 自动静音切入卡拉尔单机世界的逻辑；用户登录进入后必须经由 `world_gateway` 明确选择或校验有效 MOD 栈与档案后再建角或进世。
- **确定性失效安全**: 依赖解析闭环失败（环依赖、`incompatible_packs` 冲突、`engine_api_version` 不匹配或 `.kmod` 摘要异常）必须明确拒载并输出结构化诊断码，严禁静默降级为未排序列表。

---

## 一、 组合式运行时配置与资源 VFS 改造规范

### 1.1 `GameConfig`、`GameConfigLoader` 与 `GameBootstrap`

| 目标文件 | 精确改造点 | 行为契约与实现要求 |
| :--- | :--- | :--- |
| [game_config.gd](../../../../backend/infrastructure/game_config.gd) | `_required_tables`（62-133行） | 精简为纯引擎基础设施与规则 Schema 表，移除剧情文案及官方阵营/物品列表强制非空依赖；允许纯内容表为空注册容器等待 MOD 层注入 |
| [game_config.gd](../../../../backend/infrastructure/game_config.gd) | 可组合叠层 API（`apply_mod_overlay_tables`、`push_mod_overlay_layer`、`rebuild_overlay_stack`） | 维护 `_base_engine_tables` 与有序数组 `_active_mod_layers: Array[Dictionary]`，按拓扑序依次增量合入/整表替换/前缀清除，记录 `_purged_prefixes: Array[String]`；不再因二次调用丢弃前置基础 MOD |
| [game_config.gd](../../../../backend/infrastructure/game_config.gd) | `_ensure_table_loaded_jit_with_base()`（414-421行）与 `reload_config()`（220-272行） | JIT 查询前校验 `_is_table_purged(table_id)`，命中则立即返回空而禁止读取 `res://config/` 回插 `_base_engine_tables`；`reload_config()` 重载纯底座后按确定性序列重放 `_active_mod_layers`（仅 `clear_mod_overlay_tables()` 可清空栈） |
| [game_config_loader.gd](../../../../backend/infrastructure/game_config_loader.gd) | `load_all_tables_into()`（42-49行） | 即使存在 `res://config/config.kdat`，亦严格作为纯引擎表快照源，不阻碍 MOD 层叠加，并在 `ensure_table_loaded_jit()` 遵循 purge 前缀守卫 |
| [game_bootstrap.gd](../../../../backend/infrastructure/game_bootstrap.gd) | `assemble()` 与 `teardown()`（219-276行） | `teardown()` 强制调用 `Tier3ContentOverrideLoader.revert_all_overrides()` 与 `GameConfig.clear_mod_overlay_tables()`，确保跨测试/跨会话零残留状态 |

### 1.2 `AssetPathResolver` 统一根与 `.kmod` VFS 解析

1. **发现根一致性**: 将 `AssetPathResolver.get_mod_discovery_roots()`（[asset_path_resolver.gd](../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd)）与 `ModPackageDiscoverySolver.get_discovery_roots()` 统一收敛为共用 `is_engineering_build()` 判断，消除 `"editor"` 特性分支偏移导致的 CLI/无头跑测漏扫 `res://mods/` 问题。
2. **去除 `official://` 引擎资产硬绑**: `resolve_official_asset_path()` 与 `resolve_unified_uri()` 优先查询当前挂载的 `OFFICIAL_BASE` / `TOTAL_CONVERSION` MOD 包的资产清单或内部 `assets/`，仅对引擎内置通用系统图标保留显式系统前哨或 `assets_manifest` 显式路由。
3. **`.kmod` 压缩包内资源读取**: 利用 `ZIPReader` 挂载或流式解包映射 `mod://<pack_id>/assets/...` 至虚拟缓存句柄，支持过场视频、立绘、图标从单文件 `.kmod` 包直接读取而无需解包污染工作区目录。

---

## 二、 MOD 发现调度器与全品类 Tier 3 差分引擎扩展

### 2.1 `ModPackageDiscoverySolver` 严谨拓扑与碰撞治理

1. **读取配置真源**: 对齐 `config/domains/narrative_orchestration/core.json` 中 `mod_discovery` 扫描根配置。
2. **禁止静默覆盖 (`_scan_single_root_directory`)**: 当低优先级 Tier 与高优先级 Tier 发现同 `pack_id` 但来源冲突（尤其保护 `OFFICIAL_BASE` 不被同名用户夹篡改）时，生成显式碰撞告警并按受控覆盖规则或报错码 `MOD_ERR_PACK_ID_CONFLICT` 拒载。
3. **严格前置准入与依赖闭合**:
   - 按 `manifest_entry.is_active` 过滤未激活包。
   - Kahn 拓扑排序期间校验 `dependencies` 存在性、`engine_api_version` Semver 兼容性、以及 `incompatible_packs` 双向互斥冲突矩阵；**环依赖或缺失依赖直接 fail-closed 返回空运行集与结构化错误（废除 472-478 行降级为未排序列表的后门）**。
   - 将 `pack.json` 的 `pack_profile`、`is_official`、`trust_tier`、`content_sha256` 完整投影至 `NarrativePackManifestDTO`。

### 2.2 `Tier3ContentOverrideLoader` 全品类投影与下游注册表联动刷新

扩展 [tier3_content_override_loader.gd](../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd) 及其解析器/应用器：

| 扩展目录 / 配置文件 | 解析目标 `GameConfig` 表前缀 | 下游联动刷新注册表（原子级触发） |
| :--- | :--- | :--- |
| `content/items/*.json` | `items.mod_<pack_id>` / `items.core` | `ItemLoaderPipeline.reload_from_config()` |
| `content/skills/*.json` | `domains.combat.mechanics` | `PhysicalVerbRegistry` 缓存版本号递增 |
| `content/rules/*.json` | `domains.{combat,character_creation,attribute,currency,inventory,magic_tiers,magic_rules,quality_tiers}.*` | `MagicTierRegistry`、`MagicRuleRegistry`、`QualityTierRegistry` 同步重载 |
| `content/world/*.json` | `domains.world.core`、`domains.world_gateway`（`worlds_catalog`）、`domains.world_map`（`mod_world_topology` / 地标） | 地图与路由拓扑缓存失效 |
| `content/entities/*.json` *(新)* | `domains.npc`、`domains.monster`、`domains.elite`、`domains.world_boss` | 实体原型生成器刷新 |
| `content/quests/*.json` *(新)* | `domains.quest`、`domains.commission_quest` | 任务模板图校验缓存刷新 |
| `content/events/*.json` *(新)* | `domains.event_probability`、`domains.sovereignty`、`domains.gacha` | `NarrativeCausalityOrchestrator` 概率图刷新 |
| `content/narratives/*.json` *(新)* | `narratives.<domain_id>` | 本地化叙事模板索引刷新 |
| `content/copywriting/*.json` *(新)* | `copywriting.{item,narrative,probability}` | 条件文案查询树刷新 |
| `cutscenes/*.json` *(新)* | `infrastructure.cutscene_registry`、`infrastructure.cutscene_hooks` | `CutsceneHookRegistry` 重新索引 |
| `i18n/*.json` | 合并至当前激活语言字典及 `adapted_mod_manifest.custom_i18n` | i18n 文本查询失效刷新 |

---

## 三、 去卡拉尔兜底、统一 DAG 序章与网关生命周期闭环

### 3.1 创角与序章域去硬编码清单

1. **废除线性 4 阶段序章与模板伪造**:
   - 重构 [character_creation_protocol_handler.gd](../../../../backend/domains/character_creation/character_creation_protocol_handler.gd)（`dispatch_prologue`）、[save_load_routing_solver.gd](../../../../backend/domains/world_gateway/save_load_routing_solver.gd) 与 `PrologueExecutionKernel`：所有开局序章（在线交互 + 无头推进 + 读档续接）**全量委托给 `NarrativeDagExecutionEngine`** 推动当前 MOD 的 `dag_graphs/` 执行。
   - 重构 [prologue_dag_registry.gd](../../../../backend/domains/narrative_orchestration/prologue_dag_registry.gd)：移除 `_resolve_or_synthesize_mod_graph()` 对缺失 DAG 抓取内置目录首个模板凑数的逻辑；无有效 `routing_rules` 与匹配 `dag_graph` 时明确返回失败。
2. **清零 9 处卡拉尔默认常量硬编码**:
   - `ModPrecheckAndAdaptationSolver`：若候选 MOD 为空且当前栈无已装配的 `OFFICIAL_BASE`/`TOTAL_CONVERSION` 包，拒绝通过并返回 `ERR_NO_BASE_CONTENT_MOD`。
   - `ModAdaptationManifestMerger`（`_create_base_merge_accumulator` 不再从空/内置配置隐式预填卡拉尔出身与种族，改由基础 MOD 层首先注入；移除 `HUMAN`/`CENTRAL_CONTINENT` 默认值）。
   - `ModManifestValidator` / `ModManifestRuleHelper`：校验参考基准由 `GameConfig` 硬编码表切换为“当前栈基础包清单 + 引擎 Schema 约束”，且遵循 `has_prologue_dag` 控制是否校验 `dag_graphs`。
   - `AuthoritativeReincarnationSolver`、`ReincarnationOriginEngine`、`InnateTraitRegistry`、`CreationUiSnapshotBuilder`：清除 `IMPERIAL_NOBLE`、`HUMAN`、`CENTRAL_CONTINENT`、`PRIMORDIAL_RESONANCE`、中文种族映射字典等所有硬编码默认项，所有可用池为空时 fail-closed 返回错误。
   - `StarterLoadoutDispatcher`：同时索引激活包覆盖后的 `items.*` 与 `items.mod_*`，清除 `_build_items_spec_lookup()` 仅查 `items.core` 及中文武器名称硬分支；缺失默认装备映射时明确返回错误而非静默发 50 金币。
   - `ProloguePlaceholderResolver`、`AgentPlaythroughSessionFactory`、`AgentPlaythroughSession`：完全消费 `adapted_mod_manifest.custom_i18n` 及覆盖后 `narratives.*` 表，消除 `"FORTRESS_GUARD"`、`"default_world"` 及中文硬编码节点按钮文案。

### 3.2 `WorldGatewayFSM`、档案锁与联机鉴权闭环

1. **自动发现与显式栈绑定**:
   - `ENTER_GATEWAY` 可调用探测服务刷新当前可用本地 MOD 目录视图；`ModeReadinessProbe` 增加 `base_content_mod_ready` 检测项，当未选中有效基础包时明确标示无法开局（SP/MP 均需明确基于内容包）。
   - `WorldGatewayFSM.enter_world()` 在写入或校验 `world_mod_lock.json` 时，**严格依据用户在网关选择的 `active_mods` 顺序栈**（禁止重扫未选中的磁盘全量目录！），同步写入 `{pack_id, version, content_sha256, priority}`。
   - 读档重入（含 `SaveLoadRoutingSolver._execute_direct_restore_branch()`）：读取存档内 `world_mod_lock.json` 后，自动比对当前已发现池并在校验通过后**完整重放 Tier 3 叠层配置、`adapted_mod_manifest` 与 `creation_ui_snapshot`**；若缺失必选基座或版本/摘要漂移则阻塞进世并指引玩家去工作台修复。
2. **联机权威清单协商 (`AntiBridgeGuard` + `reconcile_realm_mod_manifest`)**:
   - 废除 `WorldGatewayFSM.purge_and_fallback_to_vanilla()` 将全部 Tier 3 与清单直接清空的暴力做法。
   - 新增 `WorldGatewayFSM.reconcile_realm_mod_manifest(realm_manifest: Dictionary)`：按服务端下发 `realm_mod_manifest` 验证所需 `OFFICIAL_BASE` 与服务端白名单 MOD 的 `{pack_id, version, content_sha256}` 匹配度；精确移除并卸载不在白名单内的客户端本地扩展 MOD，保留并重算合法叠层；改写 `AntiBridgeGuard._is_vanilla_pack()` 消除仅凭 `"vanilla_*"` / `"official_*"` 字符串前缀自证官方身份的漏洞。
3. **会话清理闭环**:
   - `RuntimeSessionState` 增加 `active_mods`、`adapted_mod_manifest`、`narrative_dag_session` 字段（随存档和运行时快照重置对齐）。
   - `WorldGatewayFSM.exit_to_gateway()` 与 `logout()` 在清理运行时字段前同步调用 `Tier3ContentOverrideLoader.revert_all_overrides()` 与 `GameConfig.clear_mod_overlay_tables()`。

---

## 四、 全端新增 UI 视图与真实服务容器接线规范

### 4.1 `NavManager` 新增全链路 3 大视图设计

在 [nav_manager.gd](../../../../frontend/navigation/nav_manager.gd) 的 `_init_default_registry()` 与 `config/frontend/views.json` 注册以下 3 个独立视图目录（严格遵循 `BaseScreen`、`DesignTokens`、独立 Tabs/Subpanels 拆分防文件超载）：

| 视图路由 ID | 目录路径（阶段 2 创建） | 职责与核心 UI 控件 | 后端服务与迁移去向 |
| :--- | :--- | :--- | :--- |
| `"world_gateway"` | `frontend/views/world_gateway/` | 单机 / 联机模式选择、世界档案列表与创建入口、当前激活 MOD 栈摘要徽标、存档锁冲突诊断条（`缺失/版本漂移` 一键高亮）、前往 MOD 工作台入口按钮 | `IWorldService` (`probe_modes_async`, `list_worlds_async`, `select_or_create_world_async`, `get_world_mod_diagnostics_async`, `select_mode_async`) -> 合规校验后迁移至 `account_entry(CHARACTER_SELECT/CREATE)` 或直接恢复进场 |
| `"mod_workbench"` | `frontend/views/mod_workbench/` | 已发现 MOD 列表（展示 `pack_profile`、`trust_tier`、`version`、`content_sha256` 前缀）、启用/禁用勾选开关、上下调整加载优先级按钮、依赖链与冲突诊断面板、前检生效与返回网关按钮 | `IWorldService` (`list_installed_mods_async`, `set_mod_selection_async`, `precheck_mod_stack_async`) |
| `"prologue"` | `frontend/views/prologue/` | 序章 DAG 节点标题/富文本展示框、动态占位符替换后文本、动态生成 `BRANCH_CHOICE` 多分支交互按钮组、过场视频桥接占位符、终局 `TERMINAL_EXIT` 进入主界面的确认按钮 | `IPrologueService` (`start_prologue_async`, `get_prologue_state_async`, `advance_prologue_async`, `complete_prologue_async`) + `cutscene_player` -> 完结后导航至 `"main_hud"` |

### 4.2 既有视图去模拟、去卡拉尔硬编码与 `"real"` 容器收口

1. **重构 `AccountEntryView` & `AccountEntryTabs` ([account_entry_view.gd](../../../../frontend/views/account_entry/account_entry_view.gd))**:
   - 登录后不再直接调单机占位跳过全部选区建角；改为导流至 `"world_gateway"` 由玩家确认世界档案与 MOD 栈状态。
   - 创角面板彻底清除硬编码卡拉尔种族/出身/天赋按钮列表与示例占位文案；统一监听并消费后端通过 `RealCharacterService.get_creation_ui_snapshot_async()` 返回的 `creation_ui_snapshot` 动态生成可选种族/出身/特质控件，提交时调用 `RealCharacterService.create_character_async()` 而非绕道 `RealAuthService`。
   - 创角成功后依据后端返回 `prologue_session` 状态导航进入 `"prologue"` 视图（或无未完结序章的既成角色进入 `"main_hud"`）。
2. **`config/frontend/ui.json` 默认 `service_mode = "real"` 与 `RealServiceContainer` 补齐**:
   - 将 `config/frontend/ui.json` 的 `service_mode` 默认值切换为 `"real"`。
   - 在 [real_service_container.gd](../../../../frontend/domain_boundary/services/real_service_container.gd) 为前端主视图依赖的服务域清理掉指向含硬编码卡拉尔地标/角色 `MockDataCatalog` 的静态兜底；在 `RealWorldService` 去除硬编码回退路径（地图地标从 `apply_snapshot` 或覆盖后的 `domains.world_map` 读取）。
   - 清理 `MainHUDView` / `MainHUDSubpanels` / `WorldMapView` / `SystemSaveView` 中残余的卡拉尔硬编码技能 ID（`SKILL_SLASH`/`SKILL_FIREBALL`）、固定 3 任务占位词条与瓦兰地标常量，并在 `SystemSaveView` / `SettingsCenterView` 增加只读或诊断级当前挂载 MOD 列表摘要面板。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 改造 `GameConfig` 可组合叠层栈（`_active_mod_layers`、`_purged_prefixes`、purge-aware JIT 与 `reload_config()` 重放）、`GameConfigLoader` 与 `GameBootstrap.teardown()` 对称清空。
- [x] Step 2.2: 重构 `AssetPathResolver`（统一 `is_engineering_build()`、移除 `official://` 硬绑 `res://assets/`、接入 `.kmod` ZIP 内部资源读取）与 `ModPackageDiscoverySolver`（`is_active`、碰撞防静默、依赖/冲突/版本校验与环依赖 fail-closed）。
- [x] Step 2.3: 扩展 `Tier3ContentOverrideLoader` 全品类解析与应用器（补全 `entities`、`quests`、`events`、`narratives`、`copywriting`、`cutscenes`、`i18n`），并接入所有下游运行时单例重建通知。
- [x] Step 2.4: 废除线性 4 阶段 `PrologueExecutionKernel` 兜底与模板伪造，统一接入 `NarrativeDagExecutionEngine`；清理 9 处后端创角/装备/代理会话文件内的所有卡拉尔硬编码默认值，落地 0-MOD `ERR_NO_BASE_CONTENT_MOD` 拒绝逻辑。
- [x] Step 2.5: 重构 `WorldGatewayFSM`、`WorldModAffinityManager`、`SaveLoadRoutingSolver`、`AntiBridgeGuard` 与 `RuntimeSessionState`，落地选中栈绑定、`world_mod_lock.json` 读档重载、联机权威 `realm_mod_manifest` 摘要校验与退出防泄漏清算。
- [x] Step 2.6: 新建 `world_gateway`、`mod_workbench`、`prologue` 三个全套前端视图并注册至 `NavManager` 与 `views.json`；重构 `AccountEntryView` / `MainHUDView` / `WorldMapView` / `SystemSaveView`、`RealServiceContainer` 与 `ui.json` 默认 `"real"` 模式，确保 `TestFrontendBoundaryGuard` 100% 通过。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P130-0201** | `GameConfig` 多层叠加与 JIT 防污染 | 先挂基础 MOD，再叠扩展 MOD 含 `purged_prefixes`，触发 JIT 读取被清表及 `exit_to_gateway()` | 前置基础 MOD 不丢失；被清表不从 `res://config/` 回灌；退出网关后 100% 回归纯净底座态 |
| **DOD-P130-0202** | 零 MOD 严格拒绝与单轨 DAG 执行 | 0 内容 MOD 调用建角/创世/序章协议 | 返回 `ERR_NO_BASE_CONTENT_MOD`；全源码不存在线性 4 阶段兜底路径或 `HUMAN`/`IMPERIAL_NOBLE` 默值 |
| **DOD-P130-0203** | 联机摘要鉴权与精确卸载 | 携带非法三方扩包与有效官方基座进入联机协商 | 官方基座保留并验证 SHA-256 一致，仅非法三方包被精确卸载并触发叠加层重算 |
| **DOD-P130-0204** | 全端新建视图与真实容器接线 | 检查 `NavManager`、3 个新视图源码、重构后 `AccountEntryView` 及 `TestFrontendBoundaryGuard` | 新视图均可独立实例化并响应 `apply_snapshot`；静态边界 17 项断言 0 违规；`ui.json` 默认 `"real"` |
