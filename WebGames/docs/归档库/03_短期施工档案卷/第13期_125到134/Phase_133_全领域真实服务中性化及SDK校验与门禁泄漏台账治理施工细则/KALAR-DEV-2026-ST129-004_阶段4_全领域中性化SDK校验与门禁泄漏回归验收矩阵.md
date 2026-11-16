---
档号: KALAR-DEV-2026-ST129-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST129 (Phase_133_全领域真实服务中性化及SDK校验与门禁泄漏台账治理施工细则)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_133_全领域真实服务中性化及SDK校验与门禁泄漏台账治理施工细则 —— 阶段4：全领域中性化SDK校验与门禁泄漏回归验收矩阵
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 全领域中性化SDK校验
---

# 施工细则：全领域真实服务、去卡拉尔中性化、SDK强校验与门禁泄漏台账治理 —— 阶段4：全领域中性化SDK校验与门禁泄漏回归验收矩阵

> 状态: 已验收 (Phase 133 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 构建并执行 `Phase 133` 端到端综合验证测试套件与全栈静态/动态/跨工作区门禁流水线，验证全端真实服务无缝运转、多命名空间物品标识、基座零卡拉尔硬编码、`total_conversion_sample` 与 `official_kalar` 双侧闭环、零解析告警与零实例泄漏，最终闭合全部四阶段清单与路线图索引。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST129-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST129-001_阶段1_全端真实服务与配置中性化及门禁泄漏治理架构规范.md) ｜ [阶段2](KALAR-DEV-2026-ST129-002_阶段2_全领域真实服务接入与多命名空间及基座去卡拉尔化实现规范.md) ｜ [阶段3](KALAR-DEV-2026-ST129-003_阶段3_SDK强Schema校验去内置化与静态门禁泄漏台账治理规范.md) ｜ **阶段4 (当前)**

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段3_SDK强Schema校验去内置化与静态门禁泄漏台账治理规范.md](KALAR-DEV-2026-ST129-003_阶段3_SDK强Schema校验去内置化与静态门禁泄漏台账治理规范.md) · [test_registry.gd](../../../../../tests/test_registry.gd) · [test_architecture_guard.gd](../../../../../tests/guards/test_architecture_guard.gd)
- **核心不变量约束断言**: 所有新增测试必须覆盖真实 `"real"` 模式与干净引擎隔离环境并在 teardown 彻底释放节点/资源；禁止通过删减或放宽既有断言换取通过率。
- **最高指示断言**: 所有验证须在最终一次代码/文档修改完成后重跑全量命令行并实测 100% 通过后方可验收合拢。

---

## 一、 核心验收范围

1. **新增端到端验收套件**:
   - 文件目标: `WebGames/tests/integration/pipelines/test_neutrality_sdk_and_gates_pipeline.gd`（同步登记到 [test_registry.gd](../../../../../tests/test_registry.gd) 与 [test_architecture_guard.gd](../../../../../tests/guards/test_architecture_guard.gd) `CROSS_CUTTING_SUITES`）。
2. **存量守卫与单测增强**:
   - [test_item_namespace_registry.gd](../../../../../tests/unit/domains/test_item_namespace_registry.gd): 多命名空间合法性与非法格式拒绝全覆盖；
   - [test_frontend_boundary_guard.gd](../../../../../tests/guards/test_frontend_boundary_guard.gd): 覆盖 `frontend/systems/`、`service_mode == "real"` 与视图/系统零直连 `MockServiceContainer`。
3. **全栈最终回归清单**:
   - `WebGames/scripts/ps1/check-gdscript.ps1`
   - `WebGames/scripts/ps1/test-run.ps1`
   - `godot --headless --path WebGames -s res://tests/test_fe_runner.gd`
   - `WebGames/scripts/ps1/audit-all.ps1`
   - `WebGames/scripts/ps1/audit-docs.ps1`
   - `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mods/official_kalar` 与 `total_conversion_sample`
   - 工作区 `validate-skills.js`、`sync-doc-metrics.js --check`、`validate-physical-hygiene.js` 及根目录 `scripts/ps1/audit-all.ps1`。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 新建并注册 `test_neutrality_sdk_and_gates_pipeline.gd`，覆盖全真实服务解析、多命名空间物品、中性化基座配置、`total_conversion_sample` 发现加载与单例 teardown 零残留。
- [x] Step 4.2: 运行 `check-gdscript.ps1`、`test-run.ps1` 与 `test_fe_runner.gd`，验证 100% 通过、0 NUL/格式化告警与 0 泄漏。
- [x] Step 4.3: 运行 `audit-all.ps1`、`audit-docs.ps1`、`kalar_mod.py check`（`official_kalar` + `total_conversion_sample`）与 `audit_refactor_metrics.py --strict` 全数通过。
- [x] Step 4.4: 同步工作区元指标/技能镜像，更新 Phase 133 四阶段清单 `[x]`/`(已验收)` 与 [路线图总索引.md](../../../../路线图/路线图总索引.md)，执行最终全量回归验证。

---

## 三、 Phase 133 最终验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P133-01 | 全领域 `"real"` 容器无缝切换 | `ServiceLocator` `"real"` 模式遍历全业务域接口 | 全量域方法正常执行并回执有效数据，零回退失败 |
| DOD-P133-02 | 中性化底座与多命名空间 | 无 MOD 基座表检索与非卡拉尔命名空间道具注册 | 无卡拉尔专有名词泄漏；`NEXUS:ITEM:CORE:RELIC_01` 注册合规 |
| DOD-P133-03 | SDK 与引擎双端样例全绿 | `kalar_mod.py check total_conversion_sample` 与引擎发现预检 | 0 Schema 错误、资产存在、无内置硬编码兜底依赖 |
| DOD-P133-04 | 静态门禁与零泄漏全栈收口 | 全量脚本与测试运行完毕 | 0 NUL 警告、0 格式化报错、0 ObjectDB/RID 泄漏、全部工作区门禁 100% PASS |
