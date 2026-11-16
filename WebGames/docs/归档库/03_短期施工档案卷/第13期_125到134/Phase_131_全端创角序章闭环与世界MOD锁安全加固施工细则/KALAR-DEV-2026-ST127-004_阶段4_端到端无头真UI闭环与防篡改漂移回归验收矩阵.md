---
档号: KALAR-DEV-2026-ST127-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST127 (Phase_131_全端创角序章闭环与世界MOD锁安全加固施工细则)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_131_全端创角序章闭环与世界MOD锁安全加固施工细则 —— 阶段4：端到端无头真UI闭环与防篡改漂移回归验收矩阵
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: Sequential; Final; 存量测试套件精准增强矩阵; 全栈真 UI 无头 E2E 集成套件; 全栈回归验证流水线
---

# 施工细则：全端创角序章闭环与世界MOD锁安全加固 —— 阶段4：端到端无头真UI闭环与防篡改漂移回归验收矩阵

> 施工开始日期: 2026-11-15
> 状态: 已验收 (Phase 131 Completed)

> [!NOTE]
> **【施工目标】** 本阶段构建面向 P0 修复的全方位自动化无头回归验证矩阵，同步覆盖“真实 UI 场景树点击与跳转闭环（Mock + Real 双容器）”、“世界 MOD 锁完整 SHA-256 固化与摘要篡改零降级 Fail-Closed 防御”、“有锁单机强制锁栈重校”、“联机清污与错误回滚”及“全量静态门禁”，确保 Round 2 交付零回归、零跳过、证据可复验。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST127-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST127-001_阶段1_全端入口交互契约与世界MOD锁安全规范.md) ｜ [阶段2](KALAR-DEV-2026-ST127-002_阶段2_网关创角链路重构与联机清污幂等状态机实现规范.md) ｜ [阶段3](KALAR-DEV-2026-ST127-003_阶段3_ESC协议收口与配置及导航上下文保真接入规范.md) ｜ **阶段4 (当前)**

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 前序阶段细则: [阶段1_全端入口交互契约与世界MOD锁安全规范.md](KALAR-DEV-2026-ST127-001_阶段1_全端入口交互契约与世界MOD锁安全规范.md) · [阶段2_网关创角链路重构与联机清污幂等状态机实现规范.md](KALAR-DEV-2026-ST127-002_阶段2_网关创角链路重构与联机清污幂等状态机实现规范.md) · [阶段3_ESC协议收口与配置及导航上下文保真接入规范.md](KALAR-DEV-2026-ST127-003_阶段3_ESC协议收口与配置及导航上下文保真接入规范.md)
- 既有核心测试与守卫: [test_registry.gd](../../../../../tests/test_registry.gd) · [test_architecture_guard.gd](../../../../../tests/guards/test_architecture_guard.gd) · [test_frontend_boundary_guard.gd](../../../../../tests/guards/test_frontend_boundary_guard.gd) · [test_fe_01_account_entry.gd](../../../../../tests/unit/frontend/test_fe_01_account_entry.gd) · [test_frontend_architecture_and_bootstrap.gd](../../../../../tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd) · [test_world_mod_lock_reentry_and_drift.gd](../../../../../tests/integration/pipelines/test_world_mod_lock_reentry_and_drift.gd) · [test_mod_sdk_and_realm_security_pipeline.gd](../../../../../tests/integration/pipelines/test_mod_sdk_and_realm_security_pipeline.gd) · [test_client_protocol_space_and_boundary_pipeline.gd](../../../../../tests/integration/pipelines/test_client_protocol_space_and_boundary_pipeline.gd) · [test_full_lifecycle_chain_and_esc_flow_pipeline.gd](../../../../../tests/integration/pipelines/test_full_lifecycle_chain_and_esc_flow_pipeline.gd) · [world_mod_lock_test_helper.gd](../../../../../tests/support/world_mod_lock_test_helper.gd)

### 1.2 核心不变量约束断言

1. **红绿真验证与零弱化断言不变量**: 新增端到端测试须直接实例化真实 `.tscn` 并挂载进无头 `SceneTree`（或经 `AppRoot` + `NavManager`），使用 `service_mode = "real"` 完成注册 → 网关 → 创角 → 序章 → HUD → ESC 退回/停机实跑，同时保留存量全部单元测试与安全管道测试零删除、零放松断言。
2. **安全负向用例完备不变量**: 必须对 P0 所有曾存在的安全旁路补全对称负向测试（篡改锁摘要叠加 `allow_safe_degrade = true` 被拒、自动发现已填充后有锁世界仍强制按锁收敛、传毒联机拦截与洁净切换联机自动洗脱、验签失败后残留叠层清零）。
3. **测试注册与沙盒对称清理不变量**: 所有新增测试文件必须同步登记至 [test_registry.gd](../../../../../tests/test_registry.gd) 与 [test_architecture_guard.gd](../../../../../tests/guards/test_architecture_guard.gd) 的 `CROSS_CUTTING_SUITES`，且 `teardown` 清理全部临时 `user://` 账户/世界/锁文件及场景树节点，不留孤儿节点或对象泄漏。

### 1.3 验收闭环防漂移最高指示

- **实跑收尾令**: 任何声明“完成”的报告必须在最后一次编辑后重新执行全套脚本门禁与无头测试并据实汇报精确统计结果；禁止用早期缓存输出替代末次验证，严禁隐藏任何 FAIL 或 SKIP。

---

## 一、 专项测试增强与新增验证套件设计

### 1.1 存量测试套件精准增强矩阵

| 存量套件 | 增强验证焦点 | 预期新增/强化断言 |
| :--- | :--- | :--- |
| [test_world_mod_lock_reentry_and_drift.gd](../../../../../tests/integration/pipelines/test_world_mod_lock_reentry_and_drift.gd) | 真实 SHA-256 固化与摘要漂移禁降级 | 1) 权威创角后读回 `world_mod_lock.json`，断言 `locked_packs[*].content_sha256` 非空且匹配 64 位 HEX；2) 当 `digest_drifts` 非空时即使传入 `allow_safe_degrade = true` 也必须 Fail-Closed 阻断并返回 `MOD_ERR_REALM_DIGEST_MISMATCH`；3) `SaveLoadRoutingSolver` 二次读档同步拦截摘要篡改；4) 已因 `select_mode` 自动发现挂载额外包时，`ensure_single_player_world_mods_ready` 仍强行收敛至 `locked_pack_ids` |
| [test_mod_sdk_and_realm_security_pipeline.gd](../../../../../tests/integration/pipelines/test_mod_sdk_and_realm_security_pipeline.gd) | 联机清污状态转移与验签失败回滚 | 1) `switch_gateway_mode(MULTIPLAYER)` 在残留本地单机扩展（非传毒入参）时自动执行净化清洗并清零 `_selected_mod_pack_ids`/`_has_explicit_mod_selection`；2) 显式携带 `custom_mods` 或 `TC-MSS-02` 预置毒包走 `select_mode` 仍返回 `SECURITY_ERR_MULTIPLAYER_MOD_POISONING`；3) `verify_and_reconcile_realm_manifest` 失败后 `active_mods` 与 `adapted_mod_manifest` 必须归零 |
| [test_fe_01_account_entry.gd](../../../../../tests/unit/frontend/test_fe_01_account_entry.gd) & [test_frontend_architecture_and_bootstrap.gd](../../../../../tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd) | 入口信号完整性与 `NavManager` 栈保真 | 1) 实例化 `account_entry_view.tscn` 触发 `char_slot_0..2` 与 `char_reroll` 零信号断联错误；2) `NavManager` 注册 `"character_creation"` 且 `pop_screen()` 无损恢复入栈前参数 |

### 1.2 新增全栈真 UI 无头 E2E 集成套件（Round 2 落地与注册）

- 规划新建文件：`res://tests/integration/pipelines/test_real_ui_chain_and_lock_security_pipeline.gd`
- 核心测试场景清单：
  1. **`TC-E2E-UI-01` (Real 模式新用户完整开局主干)**: 挂树加载 `NavManager` + `AccountEntryView` → 触发注册（`auto_login = true`，校验 `current_session_token` 非空且非 `"TOKEN_..."` 伪串） → 自动进 `WorldGatewayView` → 新建单机世界 → 自动跳转 `CharacterCreationView`（校验 `GET_CREATION_UI_SNAPSHOT` 与 `ROLL_CHARACTER_PREVIEW` 可用） → 权威创角后自动入世跳转 `PrologueView` → 推进至 DAG 终章交接 `MainHUDView`。
  2. **`TC-E2E-UI-02` (ESC 收口返关、Nav 栈参数保真与优雅停机)**: 在 `MainHUDView` 呼出子面板点击返还网关（经 `ServiceLocator.esc_menu().exit_to_gateway_async` 无鉴权报错退回网关），再进 `ModWorkbench` 后 `pop_screen()` 返回验证上下文 intact；切换至联机 Tab 联动 `switch_gateway_mode`，校验单机包被清污；点击 `QuitGameBtn` 正常触发 `request_graceful_shutdown_async`。
  3. **`TC-E2E-UI-03` (老存档有锁直入复核)**: 复用 `TC-E2E-UI-01` 已创角色与锁定世界重进网关选中该存档，直接自动挂载绑定角色并进入 `MainHUDView`（不误跳创角页，且重复校验 `world_mod_lock.json`）。

### 1.3 全栈回归验证流水线 (Sequential Final Gate)

Round 2 所有文件改动并自审 5D 复杂度达标后，按序现场执行以下最终校验并记录真实结果：

1. `pwsh -File WebGames/scripts/ps1/audit-all.ps1`（静态配置、架构、文档、SDK、Mermaid 全部审计项）
2. `pwsh -File WebGames/scripts/ps1/test-run.ps1`（全量 GDScript 单元、守卫、集成管道与前端无头测试套件）
3. `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mods/official_kalar`（官方底座包离线规范与清单检查）
4. `pwsh -File scripts/ps1/audit-all.ps1`（顶层工作区六大支柱全绿验证）
5. `pwsh -File scripts/ps1/pre-commit-gate.ps1`（物理卫生、5D 复杂度预算与提交前阻塞审查）

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 强化 `test_world_mod_lock_reentry_and_drift.gd` 与 `test_mod_sdk_and_realm_security_pipeline.gd` 的锁摘要/篡改拒载/清污回滚安全断言。
- [x] Step 4.2: 补全 `test_fe_01_account_entry.gd` 与 `test_frontend_architecture_and_bootstrap.gd` 对 `.tscn` 信号、`character_creation` 路由及 `pop_screen` 上下文保真的校验。
- [x] Step 4.3: 编写并注册 `test_real_ui_chain_and_lock_security_pipeline.gd` 到 `test_registry.gd` 与 `CROSS_CUTTING_SUITES`，完成沙盒物理对称清理。
- [x] Step 4.4: 连续实跑全部 WebGames 内部静态审计、Godot 无头测试、`kalar_mod.py check` 与顶层工作区六大支柱门禁，取得 100% PASS。
- [x] Step 4.5: 收尾将 Phase 131 四阶段细则清单勾为 `[x]`，同步 `WebGames/docs/路线图/路线图总索引.md` 阶段状态与验收证据记录。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P131-0401** | 真 UI 端到端链路无头实跑通关 | 运行新增套件 `test_real_ui_chain_and_lock_security_pipeline.gd` | 注册→网关→创角→序章→HUD→ESC 返关→联机清污→优雅停机全链路 PASS，零假令牌/断联告警 |
| **DOD-P131-0402** | MOD 锁摘要篡改与跨界隔离 Fail-Closed | 运行 `test_world_mod_lock_reentry_and_drift.gd` 与 `test_mod_sdk_and_realm_security_pipeline.gd` | 空摘要彻底消除，`digest_drifts` 下 `allow_safe_degrade = true` 被拒绝，有锁自动重校与清污全过 |
| **DOD-P131-0403** | 全量测试套件零退化与零跳过 | 运行 `pwsh -File WebGames/scripts/ps1/test-run.ps1` | 全量 Suites 100% PASS，0 Failed，0 Skipped |
| **DOD-P131-0404** | 全域审计与六大支柱门禁 | 运行 `WebGames/scripts/ps1/audit-all.ps1` 与顶层 `scripts/ps1/audit-all.ps1` | 全部审查支柱绿牌退出，物理卫生与 5D ELOC 门禁无违规 |
