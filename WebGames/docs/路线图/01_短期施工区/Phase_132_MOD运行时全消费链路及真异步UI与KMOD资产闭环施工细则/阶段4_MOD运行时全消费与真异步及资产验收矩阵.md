# 施工细则：MOD 运行时全消费链路及真异步 UI 及 .kmod 资产闭环 —— 阶段4：全链路消费、真异步与资产安全验收矩阵

> 状态: 已验收 (Phase 132 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 构建并运行 `Phase 132` 端到端集成回归流水线与 `test_asset_path_resolver.gd` 安全扩充测试，覆盖 `i18n` 分语言热切换与卸载清理、序章 DAG Hook 与路由规则、`.kmod` `prologue_routing_rules` / `skill_cards` / `cdkeys` / `mod_world_topology` 消费、真实 `SceneTree` 延迟异步回调及 `.kmod` 资产编码防穿越，并完成全库测试、门禁与台账收口。

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段3_全端真异步UI改造与KMOD资产安全防线规范.md](阶段3_全端真异步UI改造与KMOD资产安全防线规范.md) · [test_registry.gd](../../../../tests/test_registry.gd) · [test_asset_path_resolver.gd](../../../../tests/unit/infrastructure/test_asset_path_resolver.gd)
- **核心不变量约束断言**: 所有测试套件严格清理临时 `user://` 测试目录与 `.kmod` 文件，调用 `CutsceneHookRegistry.get_instance().clear_for_tests()` 与 `ServiceLocator.reset()`，确保跨套件零状态污染与零 `ObjectDB` 泄漏。
- **最高指示断言**: 全域无头单元测试、23 项静态门禁、文档四域门禁及跨套件架构守卫闭环必须 100% 绿灯后方可合拢阶段状态。

---

## 一、 核心验收范围

1. **新增综合集成验收套件**:
   - 文件目标: `WebGames/tests/integration/pipelines/test_mod_runtime_async_and_assets_pipeline.gd`（同步登记于 [test_registry.gd](../../../../tests/test_registry.gd) 与 [test_architecture_guard.gd](../../../../tests/guards/test_architecture_guard.gd) `CROSS_CUTTING_SUITES`）。
2. **存量单元测试强化**:
   - 扩充 [test_asset_path_resolver.gd](../../../../tests/unit/infrastructure/test_asset_path_resolver.gd)：验证 `user > res` 覆盖优先次序、`<pack_id>_<version>.kmod` 寻址、`.kmod!/` 存在性与 `%2e%2e`/`%00` 穿越拒载，同时确保原有 `TC-APR-01 ~ TC-APR-05` 全量通过。
3. **全栈回归验证**:
   - 执行 [check-gdscript.ps1](../../../../scripts/ps1/check-gdscript.ps1)、[test-run.ps1](../../../../scripts/ps1/test-run.ps1)、[audit-all.ps1](../../../../scripts/ps1/audit-all.ps1) 与 `kalar_mod.py check mods/official_kalar`。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 新建并注册 `test_mod_runtime_async_and_assets_pipeline.gd`（覆盖 `TC-P132-01 ~ TC-P132-05`），同步登记到 `test_registry.gd` 与 `CROSS_CUTTING_SUITES`。
- [x] Step 4.2: 扩充 `test_asset_path_resolver.gd` `.kmod` 版本命名、覆盖次序及编码穿越拒载断言。
- [x] Step 4.3: 实跑 `check-gdscript.ps1`、`test-run.ps1`（含真 `SceneTree` 帧步进验证异步定时器）与 `audit-all.ps1` 全数通过。
- [x] Step 4.4: 更新 Phase 132 四阶段清单为 `[x]` 与 `(已验收)`，并同步更新 [路线图总索引.md](../../路线图总索引.md)。

---

## 三、 Phase 132 最终验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P132-01 | 多语包分流与还原 | 同一 MOD 包注入中英双语并在运行期热切换 | 语言切换生效；卸载与 teardown 后基座词条完整复原 |
| DOD-P132-02 | 序章 DAG Hook 与规则/扩展表消费 | 官方序章首步及自定义 `skill_cards`/`cdkeys`/`mod_world_topology` MOD | `CutsceneHookRegistry` 命中并在重置清零；手牌与世界拓扑地标均按 MOD 生效 |
| DOD-P132-03 | 真异步 UI `SceneTree` 时序 | 在 `SceneTree` 下延迟 50ms 触发网关、工坊与序章异步调用 | 延时到达后视图数据完整落地，无过早空读 |
| DOD-P132-04 | `.kmod` 资产管线与编码穿越防御 | `<pack_id>_<version>.kmod` PNG 资产与 `%2e%2e` 穿越 URI | `.kmod` 图片加载出有效 `ImageTexture`；穿越 URI 返回空串拦截 |
| DOD-P132-05 | 全栈门禁与套件全绿 | `test-run.ps1` + `audit-all.ps1` + `check-gdscript.ps1` | 测试套件 100% PASS，23 项静态门禁 0 Error / 0 Warn |
