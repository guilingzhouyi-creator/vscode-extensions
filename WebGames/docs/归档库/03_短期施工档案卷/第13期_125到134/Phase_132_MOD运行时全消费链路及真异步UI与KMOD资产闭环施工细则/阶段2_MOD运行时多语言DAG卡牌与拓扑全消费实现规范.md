# 施工细则：MOD 运行时全消费链路与真异步 UI 及 .kmod 资产闭环 —— 阶段2：多语言、DAG Hook 与配置表消费实现规范

> 状态: 已验收 (Phase 132 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 实现 MOD 包 `i18n/*.json` 分语言载入与前端/后端词库协同热刷新和卸载清除；在 `PrologueExecutionKernel` 接入过场 Hook 拦截并对齐官方卡拉尔节点配置；兼容 `.kmod` 内 `prologue_routing_rules` 与扁平/嵌套优先级路由规则；打通战斗卡牌池 `skill_cards`、可兑换 `cdkeys` 及世界拓扑 `mod_world_topology` / `landmarks` 消费链路。

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段1_MOD运行时消费与真异步及资产闭环架构规范.md](阶段1_MOD运行时消费与真异步及资产闭环架构规范.md) · [localization_registry_catalog.gd](../../../../backend/domains/localization_i18n/localization_registry_catalog.gd)
- **核心不变量约束断言**: 所有 `i18n/*.json` 键按标准化 `locale` 分桶隔离存储；`unload_all_mod_translations()` 与 `clear_viewed_records()` 在任何退回网关/卸载 MOD/测试 teardown 时幂等执行；`PrologueDagRegistry` 对 `match_condition` 与扁平键共用单一标准化解算函数。
- **最高指示断言**: 严格维护单一真源配置消费，复用既有 `Tier3ContentRecordParser` 与 `ModPackageArchiveReader` 工具链，零跨文件复制逻辑。

---

## 一、 核心实现方案

1. **分语言 `i18n` 解析与前后端词库双清**:
   - 在 [mod_package_archive_reader.gd](../../../../backend/domains/narrative_orchestration/mod_package_archive_reader.gd) 新增 `normalize_locale_code(stem)` 与 `merge_i18n_payload_for_locale(...)`；[mod_package_discovery_solver.gd](../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) 与 `.kmod` 加载器共同调用构建 `custom_i18n_by_locale`。
   - [localization_registry_catalog.gd](../../../../backend/domains/localization_i18n/localization_registry_catalog.gd) 提供 `unload_all_mod_translations()`；[ui_text_resolver.gd](../../../../frontend/i18n/ui_text_resolver.gd) 增加 `_mod_dictionaries` 分层与 `apply_mod_translations()` / `clear_mod_translations()`；[ui_intermediary.gd](../../../../frontend/i18n/ui_intermediary.gd) 新增 `refresh_active_bindings()`；[tier3_content_override_loader.gd](../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd) 挂载/还原时驱动三者联动。
2. **序章 DAG Hook 与路由规则统一**:
   - [prologue_execution_kernel.gd](../../../../backend/domains/character_creation/prologue_execution_kernel.gd) 在 `create_dag_session()` 于 `initialize_with_graph()` 前绑定 `hook_interceptor`，命中 [cutscene_hook_registry.gd](../../../../backend/infrastructure/media/cutscene_hook_registry.gd) 时驱动 [prologue_cutscene_port.gd](../../../../backend/domains/character_creation/prologue_cutscene_port.gd) 并按 `play_once_per_save` 记账；校准 [cutscene_hooks.json](../../../../mods/official_kalar/cutscenes/cutscene_hooks.json) 至 `DAG_PROLOGUE_HUMAN_CAPITAL`/`NODE_AWAKEN_PLAZA` 与 `DAG_PROLOGUE_ELF_SANCTUARY`/`NODE_AWAKEN_GROVE`。
   - [prologue_dag_registry.gd](../../../../backend/domains/narrative_orchestration/prologue_dag_registry.gd) 提取规则归一化助手同时兼容嵌套 `match_condition` 与扁平 `race`/`origin`/`is_default`，按 `priority` 降序匹配并支持 `prologue_routing_rules`；`ModPackageArchiveReader` 同步收集 `.kmod` 的 `prologue_routing_rules`。
3. **卡牌池、`cdkeys` 与世界拓扑/地标消费**:
   - [combat_hand_generator.gd](../../../../backend/domains/physics_thermodynamics/combat_hand_generator.gd) `_instantiate_card_from_pool()` 消费 `domains.combat.mechanics#skill_cards` 与 `domains.combat#verbs`。
   - [map_and_ecology_solver.gd](../../../../backend/domains/world_navigation/map_and_ecology_solver.gd) 增加从 `domains.world#mod_world_topology` 与 `landmarks` 构建/查询图节点拓扑与连通边的入口；验证 [tier3_rules_world_override_applier.gd](../../../../backend/domains/narrative_orchestration/tier3_rules_world_override_applier.gd) `cdkeys` 在 `RewardDispatchPipeline` 中直接生效。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 升级 `ModPackageArchiveReader` 与 `ModPackageDiscoverySolver` 支持 `custom_i18n_by_locale` 与 `.kmod` `prologue_routing_rules`。
- [x] Step 2.2: 升级 `LocalizationRegistryCatalog`、`UITextResolver`、`UIIntermediary`、`CutsceneHookRegistry` 与 `Tier3ContentOverrideLoader` 完成注入、刷新与卸载还原。
- [x] Step 2.3: 校准 `official_kalar/cutscenes/cutscene_hooks.json` 并在 `PrologueExecutionKernel` 接入 DAG `hook_interceptor` 与端口派发。
- [x] Step 2.4: 升级 `PrologueDagRegistry`、`CombatHandGenerator` 与 `MapAndEcologySolver` 消费路由规则、卡牌库及世界拓扑地标表。

---

## 三、 多域消费实现验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P132-S2-01 | 多语隔离与热切换 | `zh-CN.json` + `en-US.json` 异文测试包 | `switch_locale("en_US")` 返回英文文本；卸载恢复原词典且绑定同步刷新 |
| DOD-P132-S2-02 | 序章首节点过场 Hook | `official_kalar` `DAG_PROLOGUE_HUMAN_CAPITAL` 首节点 | 命中 `hook_prologue_awakening_pre`；`play_once_per_save` 生效且清理后可复触发 |
| DOD-P132-S2-03 | `.kmod` 与扁平路由兼容 | `.kmod` `prologue_routing_rules` 与 `race` 扁平规则 | `PrologueDagRegistry` 按 `priority` 精确解析出目标 DAG ID |
| DOD-P132-S2-04 | 卡牌池与拓扑消费 | 注入自定义 `skill_cards` 与 `mod_world_topology` / `cdkeys` | 手牌生成卡牌含自定义属性；A* 寻路消费拓扑节点；CDKey 可核销发奖 |
