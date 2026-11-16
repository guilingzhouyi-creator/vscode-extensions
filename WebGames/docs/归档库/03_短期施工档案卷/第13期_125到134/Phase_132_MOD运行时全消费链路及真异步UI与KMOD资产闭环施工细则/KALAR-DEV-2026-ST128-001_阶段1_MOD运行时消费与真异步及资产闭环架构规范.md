---
档号: KALAR-DEV-2026-ST128-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST128 (Phase_132_MOD运行时全消费链路及真异步UI与KMOD资产闭环施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_132_MOD运行时全消费链路及真异步UI与KMOD资产闭环施工细则 —— 阶段1：MOD运行时消费与真异步及资产闭环架构规范
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: MOD运行时消费; 真异步; 资产闭环架构规范; cutscene_hooks.json
---

# 施工细则：MOD 运行时全消费链路与真异步 UI 及 .kmod 资产闭环 —— 阶段1：架构契约与消费边界规范

> 状态: 已验收 (Phase 132 Completed)
> 施工开始日期: 2026-11-15
> 架构基准: 2026-11-15 · P1 MOD 运行时全链路消费、全端真异步状态驱动与 `.kmod`/`mod://` 资产沙盒安全

> [!NOTE]
> **【施工目标】** 打通“MOD 声明 → 挂载装载 → 运行时多领域消费 → 卸载清零”的全链路闭环：升级 `i18n/*.json` 分语言键隔离与 UI 实时刷新还原；打通序章 DAG 会话 `hook_interceptor` 与官方过场节点对齐；统一扁平/嵌套序章路由、`.kmod` 路由、战斗卡牌池与世界拓扑/地标消费；全面改造前端控制器为真异步回调状态驱动；闭环 `.kmod` 版本命名、虚拟路径装载与防路径穿越 Fail-Closed 防线。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST128-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST128-002_阶段2_MOD运行时多语言DAG卡牌与拓扑全消费实现规范.md) ｜ [阶段3](KALAR-DEV-2026-ST128-003_阶段3_全端真异步UI改造与KMOD资产安全防线规范.md) ｜ [阶段4](KALAR-DEV-2026-ST128-004_阶段4_MOD运行时全消费与真异步及资产验收矩阵.md)

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [AGENTS.md](../../../../../../AGENTS.md) · [docs/路线图/路线图总索引.md](../../../../路线图/路线图总索引.md) · [Phase 131 Stage 1](../Phase_131_全端创角序章闭环与世界MOD锁安全加固施工细则/KALAR-DEV-2026-ST127-001_阶段1_全端入口交互契约与世界MOD锁安全规范.md)
- **核心不变量约束断言**: 多语言 MOD 词条按标准化语言标签隔离写入并在卸载或切联机时无残留还原；序章 DAG 初始化前完成 `hook_interceptor` 挂载与已读记录生命周期清理；前端 `*_async()` 后禁止同步读取未决局部变量；`.kmod` 归档与 `mod://` 资源解析对任意穿越向量（`%2e%2e`/`%00`/`..`/越界链接）严格 Fail-Closed。
- **最高指示断言**: 坚持先规约后实现，零硬编码、零假异步、零静态克隆、全量门禁 100% 收口。

---

## 一、 核心设计契约

1. **分语言 `i18n` 与 UI 实时绑定刷新 ([localization_registry_catalog.gd](../../../../../backend/domains/localization_i18n/localization_registry_catalog.gd) · [ui_text_resolver.gd](../../../../../frontend/i18n/ui_text_resolver.gd))**:
   - [mod_package_discovery_solver.gd](../../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) 与 [mod_package_archive_reader.gd](../../../../../backend/domains/narrative_orchestration/mod_package_archive_reader.gd) 解析 `i18n/*.json` 时须提取并规范化文件名语言标签（如 `zh-CN` → `zh_CN`），写入 `custom_i18n_by_locale[locale]`；同时依据当前活跃语言及回退顺序维护兼容扁平 `custom_i18n`。
   - [tier3_content_override_loader.gd](../../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd) 挂载/卸载 MOD 覆盖层时，同步更新 `LocalizationRegistryCatalog`、`UITextResolver` 模组词典层及经 [ui_intermediary.gd](../../../../../frontend/i18n/ui_intermediary.gd) 安全刷新活跃绑定，并在退回或反装配时清零模组词条与 [cutscene_hook_registry.gd](../../../../../backend/infrastructure/media/cutscene_hook_registry.gd) `_viewed_records`。
2. **DAG 过场 Hook、路由规则、卡牌与世界拓扑**:
   - [prologue_execution_kernel.gd](../../../../../backend/domains/character_creation/prologue_execution_kernel.gd) 于 `create_dag_session()` 在图初始化前绑定 `hook_interceptor`，并校准 [cutscene_hooks.json](../../../../../mods/official_kalar/cutscenes/cutscene_hooks.json) 节点映射。
   - [prologue_dag_registry.gd](../../../../../backend/domains/narrative_orchestration/prologue_dag_registry.gd) 统一消费 `match_condition` 与扁平 `race`/`origin`/`is_default` + `priority` 优先级。
   - [combat_hand_generator.gd](../../../../../backend/domains/physics_thermodynamics/combat_hand_generator.gd) 消费 `domains.combat.mechanics#skill_cards` 与 `verbs`；[map_and_ecology_solver.gd](../../../../../backend/domains/world_navigation/map_and_ecology_solver.gd) 与世界网关/地图消费 `domains.world#mod_world_topology` 与 `landmarks`。
3. **全端真异步与 `.kmod`/`mod://` 资产沙盒防线**:
   - [account_entry_tabs.gd](../../../../../frontend/views/account_entry/account_entry_tabs.gd)、[world_gateway_tabs.gd](../../../../../frontend/views/world_gateway/world_gateway_tabs.gd)、[world_gateway_realm_session_helper.gd](../../../../../frontend/views/world_gateway/world_gateway_realm_session_helper.gd)、[mod_workbench_screen_tabs.gd](../../../../../frontend/views/mod_workbench/mod_workbench_screen_tabs.gd)、[prologue_tabs.gd](../../../../../frontend/views/prologue/prologue_tabs.gd) 及 [app_bootstrap.gd](../../../../../frontend/app/app_bootstrap.gd) 全面消除调用异步服务后同步消费局部变量字典的问题。
   - [asset_path_resolver.gd](../../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd) 对齐 `mod_discovery` 配置、`.kmod` `<pack_id>_<version>.kmod` 识别、`user > install > dev` 覆盖优先级、`mod://<category>/...` 歧义修正、`.kmod!/` 虚路径存在性与 [cutscene_async_loader.gd](../../../../../backend/infrastructure/media/cutscene_async_loader.gd) 字节解码；严格拦截路径穿越。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 1.1: 冻结分语言 `custom_i18n_by_locale` 与 `LocalizationRegistryCatalog` / `UITextResolver` 双向隔离清理契约。
- [x] Step 1.2: 冻结 `PrologueExecutionKernel` Hook 拦截时序、`PrologueDagRegistry` 统一路由语法及卡牌/世界拓扑表消费契约。
- [x] Step 1.3: 冻结前端五处视图委托真异步回调链路与向后兼容测试观测契约。
- [x] Step 1.4: 冻结 `AssetPathResolver` 多根优先级、`.kmod` 二进制流加载与 `sanitize_sandbox_path_strict` 拒载边界。

---

## 三、 架构契约验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P132-S1-01 | 分语言 `i18n` 与还原对称 | 同时含 `zh-CN.json` 与 `en-US.json` 的 MOD 包 | 双语独立命中不互覆；卸载后恢复基座词库 |
| DOD-P132-S1-02 | DAG Hook 与扩展表全消费 | 官方/三方 MOD 的 Hook、`routing_rules`、`skill_cards`、`mod_world_topology` | 节点前置触发 Hook；规则、手牌与拓扑地标均按 MOD 配置生效 |
| DOD-P132-S1-03 | 真异步延迟安全性 | 在 `SceneTree` 以 `simulate_delay_ms = 50` 触发前端页面动作 | 回调延迟到达后视图状态正确更新，无空字典提前覆写 |
| DOD-P132-S1-04 | `.kmod` 资产解析与防穿越 | `<pack_id>_<version>.kmod` PNG 资产及 `%2e%2e` / `%00` 攻击串 | 合法 `.kmod!/` 资产加载为纹理资源；攻击串稳定返回空串拒载 |
