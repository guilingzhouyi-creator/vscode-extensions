---
档号: KALAR-DEV-2026-ST130-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST130 (Phase_134_全真冷启动与KMOD多媒体及纯净中性底座硬化施工细则)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_134_全真冷启动与KMOD多媒体及纯净中性底座硬化施工细则 —— 阶段4：真冷启动与KMOD多媒体及中性底座全栈回归验收矩阵
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 真冷启动; KMOD多媒体; manifest.json
---

# 施工细则：全真冷启动与KMOD多媒体及纯净中性底座硬化 —— 阶段4：真冷启动与KMOD多媒体及中性底座全栈回归验收矩阵

> 状态: 已验收 (Phase 134 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 完成 Phase 134 全量自动化测试、`test_fe_runner.gd`、`kalar_mod.py` 双样例校验、`audit-all.ps1` 全栈门禁无错误/零警告验收，并将完成第 13 周期（第 10 卷）归档封存准备，为后续 Phase 135 开篇筑牢纯净基座。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST130-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST130-001_阶段1_全真冷启动协议与KMOD多媒体解耦架构规范.md) ｜ [阶段2](KALAR-DEV-2026-ST130-002_阶段2_全真冷启动与Tier3及KMOD音视频管线实现规范.md) ｜ [阶段3](KALAR-DEV-2026-ST130-003_阶段3_去卡拉尔纯净中性底座与分发打包及硬编码阻断规范.md) ｜ **阶段4 (当前)**

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段3_去卡拉尔纯净中性底座与分发打包及硬编码阻断规范.md](KALAR-DEV-2026-ST130-003_阶段3_去卡拉尔纯净中性底座与分发打包及硬编码阻断规范.md) · [test_registry.gd](../../../../../tests/test_registry.gd) · [audit-all.ps1](../../../../../scripts/ps1/audit-all.ps1)
- **核心不变量约束断言**: 所有验证必须在最后一次代码编辑完成后执行；ObjectDB 实体与 RenderingServer/Physics RID 泄漏量严格等于 0；`mods/official_kalar` 与 `mod_sdk/templates/total_conversion_sample` 均通过静态与运行时双检。
- **最高指示断言**: 实事求是汇报每条指令实际结果；完成本卷 10/10 验收后依法运行周期归档流水线。

---

## 一、 端到端全栈验证流程

1. **冷启动 E2E 与前端全量回归**:
   - 运行 `WebGames/scripts/ps1/test-run.ps1` 与 `godot --headless --path WebGames -s res://tests/test_fe_runner.gd`，确认新建真冷启动 E2E 用例、媒体加载失败与解码用例、`TestConfigurationGuard`、`TestArchitectureGuard` 与 `TestNeutralitySdkAndGatesPipeline` 全部通过且零 ObjectDB/RID 泄漏。
2. **SDK 工具链、`.kmod` 往返与跨平台脚本验收**:
   - 使用 `kalar_mod.py check` 验证 `mods/official_kalar` 与 `mod_sdk/templates/total_conversion_sample`；测试 `kmod_bundler.py` 打包（含 `assets/manifest.json`）并由 `ModPackageArchiveReader` / `Tier3ContentOverrideLoader` 读取验证。
   - 执行 `audit_pair_parity.py` 验证 `package-webgames.{ps1,sh}` 与其他门禁脚本同构性。
3. **全域门禁与周期封存就绪**:
   - 运行 `pwsh -NoProfile -File WebGames/scripts/ps1/audit-all.ps1` 验证全部门禁绿灯（零编译警告/错误）。
   - 将 Phase 134 阶段1~4状态更新为已完成并准备触发第 13 周期（Phase 125~134，10/10）封存归档。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 执行 `WebGames/scripts/ps1/test-run.ps1` 与 `test_fe_runner.gd` 验证真冷启动、`.kmod`、音视频解码与零泄漏。
- [x] Step 4.2: 执行 `kalar_mod.py check` 双包校验与 `kmod_bundler.py` `.kmod` 多媒体/资产往返自测。
- [x] Step 4.3: 执行 `WebGames/scripts/ps1/audit-all.ps1` 确认全量静态与文档门禁通过。
- [x] Step 4.4: 闭合本卷验收状态，更新 `路线图总索引.md` 并执行 `archive_volume.py --cycle --apply` 归档第 13 期。

---

## 三、 全真冷启动、KMOD多媒体与纯净底座端到端验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P134-01 | `app_root.tscn` `"real"` 冷启动 E2E | 真冷启动流水线套件 (`ServiceLocator` `"real"` 模式) | 版本兼容检查、建角错码透传与主场景引导全绿通过，退出零泄漏 |
| DOD-P134-02 | `.kmod` 完整闭环与 Tier3 隔离 | `kmod_bundler` + `ModPackageArchiveReader` + `Tier3ContentOverrideLoader` | `assets/manifest.json` 保留，`races_catalog` 字典生效，`TOTAL_CONVERSION` 零污染 |
| DOD-P134-03 | 真实音视频解码与显式失败码 | `.kmod!/` `.ogg`/`.wav` 加载与缺失资源加载 | 真音频流解码成功；缺失媒体返回 `STATUS_FAILED` + 错误码 |
| DOD-P134-04 | 纯净中性底座与第13期归档闭环 | `audit-all.ps1` + `kalar_mod.py check` + `archive_volume.py --cycle --apply` | 全域测试与审计绿灯，第 13 期 10 卷按规范完成封存 |
