---
档号: KALAR-DEV-2026-ST128-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST128 (Phase_132_MOD运行时全消费链路及真异步UI与KMOD资产闭环施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_132_MOD运行时全消费链路及真异步UI与KMOD资产闭环施工细则 —— 阶段3：全端真异步UI改造与KMOD资产安全防线规范
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 全端真异步UI改造; KMOD资产安全防线规范
---

# 施工细则：MOD 运行时全消费链路与真异步 UI 及 .kmod 资产闭环 —— 阶段3：真异步前端改造与资产安全防线规范

> 状态: 已验收 (Phase 132 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 将前端入口、世界网关、MOD 工坊、序章面板与引导装配彻底改造为回调内部推进状态，杜绝 `*_async()` 后同步读空局部变量；同时统一 `AssetPathResolver` 的 `mod_discovery` 读取、`.kmod` `<pack_id>_<version>.kmod` 寻址、`mod://` 类目歧义识别、`CutsceneAsyncLoader` 虚路径二进制纹理装载及路径穿越 Fail-Closed 拦截。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST128-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST128-001_阶段1_MOD运行时消费与真异步及资产闭环架构规范.md) ｜ [阶段2](KALAR-DEV-2026-ST128-002_阶段2_MOD运行时多语言DAG卡牌与拓扑全消费实现规范.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST128-004_阶段4_MOD运行时全消费与真异步及资产验收矩阵.md)

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段2_MOD运行时多语言DAG卡牌与拓扑全消费实现规范.md](KALAR-DEV-2026-ST128-002_阶段2_MOD运行时多语言DAG卡牌与拓扑全消费实现规范.md) · [mock_base_service.gd](../../../../../frontend/domain_boundary/mocks/mock_base_service.gd) · [kmod_bundler.py](../../../../../scripts/py/lib/kmod_bundler.py)
- **核心不变量约束断言**: 所有 `*_async()` 后续状态更新、导航压栈与错误提示必须在异步回调内执行；严格路径防线对编码穿越（`%2e%2e`/`%2f`/`%5c`）、空字节（`\u0000`/`%00`）、`..` 及越界链接零容忍返回空路径。
- **最高指示断言**: 真异步改造须同时兼容延时 `MockBaseService` 与立即回调 `Real*Service`，并保持既有 `TC-APR-01 ~ TC-APR-05` 测试契约全绿。

---

## 一、 核心实现方案

1. **前端五处控制器真异步重构**:
   - [world_gateway_tabs.gd](../../../../../frontend/views/world_gateway/world_gateway_tabs.gd): `refresh_gateway_state()` 废除尾部空 `merged_snapshot` 覆盖，每个服务回调到达后直接增量提交 `_view.apply_snapshot(patch)`，并在首个 `worlds` 回调中按需刷新选中世界诊断；`create_new_world()`、`enter_selected_world()`、`delete_selected_world()` 与 `save_and_apply_mod_selection()` 状态转移及导航全迁入回调内。
   - [world_gateway_realm_session_helper.gd](../../../../../frontend/views/world_gateway/world_gateway_realm_session_helper.gd) 与 [mod_workbench_screen_tabs.gd](../../../../../frontend/views/mod_workbench/mod_workbench_screen_tabs.gd): `switch_gateway_mode()`、`verify_and_enter_selected_realm()`、`join_verified_realm()` 与 `commit_selection_and_precheck()` 全部在回调中更新 UI 状态、触发界域入场及弹出告警 Toast，并提供可选完成回调参数。
   - [prologue_tabs.gd](../../../../../frontend/views/prologue/prologue_tabs.gd)、[account_entry_tabs.gd](../../../../../frontend/views/account_entry/account_entry_tabs.gd) 及 [app_bootstrap.gd](../../../../../frontend/app/app_bootstrap.gd): 序章查询不到活跃节点时在 `get_prologue_state_async` 回调内链式调用 `start_prologue_async`，完结回调内执行 `replace_screen("main_hud", ...)`；账号登录/注册及入世推进全在回调内切换状态/压栈；`AppBootstrap._drive_lifecycle_boot()` 在版本校验回调确认后再推进生命周期状态与入口压栈（支持同步服务下即时入栈）。
2. **`.kmod` / `mod://` 闭环与沙盒硬防御**:
   - [asset_path_resolver.gd](../../../../../backend/infrastructure/resource_governance/asset_path_resolver.gd):
     - `get_mod_discovery_roots()` 读取 `domains.narrative_orchestration#mod_discovery` 保持工程/发行版隔离。
     - `resolve_mod_asset_path()` 按高覆盖优先级检查已存在目录与 `.kmod`（兼容 `<pack_id>.kmod` 与 `<pack_id>_<version>.kmod` 清单匹配）；`asset_exists()` 识别 `.kmod!/` 虚路径；`_resolve_mod_scheme_uri()` 识别 `mod://<category>/...` 与 `fallback_mod_id` 组合。
     - `sanitize_sandbox_path()` 先过滤空字节与解码 `%2e`/`%2f`/`%5c` 后保持既有兼容净化；新增 `sanitize_sandbox_path_strict()` 对任何 `..`、空字节、盘符、UNC 与越界链接返回 `""`，并接入 `resolve_mod_asset_path()` 与 `resolve_unified_uri("mod://...")`。
   - [cutscene_async_loader.gd](../../../../../backend/infrastructure/media/cutscene_async_loader.gd): 识别 `.kmod!/` 虚路径及非 `res://` 外部图像文件，调用 `AssetPathResolver.read_mod_asset_bytes()` 解码生成 `ImageTexture` 并缓存交付回调。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 改造 `WorldGatewayTabs`、`WorldGatewayRealmSessionHelper`、`ModWorkbenchScreenTabs` 实现纯异步回调闭环。
- [x] Step 3.2: 改造 `PrologueTabs`、`AccountEntryTabs`/`AccountEntryView`、`AppBootstrap` 实现异步链式回调状态推进。
- [x] Step 3.3: 升级 `AssetPathResolver` 的 `mod_discovery` 读取、`.kmod` `<pack>_<ver>.kmod` 解析、`mod://` 类目歧义修正与严格路径防线。
- [x] Step 3.4: 升级 `CutsceneAsyncLoader` 支持 `.kmod!/` 及外部松散图像资产加载，通过 GDScript 静态检查。

---

## 三、 真异步与资产安全验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P132-S3-01 | 延迟异步 UI 刷新完整性 | `MockWorldService` 延迟 50ms 执行 `refresh_gateway_state()` | 定时器触发后 `_view.saved_worlds`/`remote_realms` 全量更新且未被早期空快照抹除 |
| DOD-P132-S3-02 | 带版本号 `.kmod` 资产解析与加载 | 生成 `sample_1.2.0.kmod` 含 PNG 图标经 `CutsceneAsyncLoader` 加载 | `asset_exists` 为 true 且异步回调返回有效 `ImageTexture` |
| DOD-P132-S3-03 | `mod://` 类别首段消歧 | `resolve_unified_uri("mod://textures/a.png", "my_pack")` | 正确解析至 `my_pack` 下资产目录而不误判 `textures` 为 MOD ID |
| DOD-P132-S3-04 | 严格编码路径穿越拦截 | `mod://pkg/%2e%2e/%2e%2e/secret` 与含 `%00` 路径 | 返回空串 `""` 并拒绝读盘或读包 |
