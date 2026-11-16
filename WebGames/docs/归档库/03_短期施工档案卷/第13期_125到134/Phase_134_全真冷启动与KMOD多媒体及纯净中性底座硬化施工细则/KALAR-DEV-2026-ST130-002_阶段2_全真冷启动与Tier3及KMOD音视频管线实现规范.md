---
档号: KALAR-DEV-2026-ST130-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST130 (Phase_134_全真冷启动与KMOD多媒体及纯净中性底座硬化施工细则)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_134_全真冷启动与KMOD多媒体及纯净中性底座硬化施工细则 —— 阶段2：全真冷启动与Tier3及KMOD音视频管线实现规范
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: manifest.json
---

# 施工细则：全真冷启动与KMOD多媒体及纯净中性底座硬化 —— 阶段2：全真冷启动与Tier3及KMOD音视频管线实现规范

> 状态: 已验收 (Phase 134 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 实现 `RealVersionService`/`RealProtocolBridge`/`RealAuthService` 冷启动协议闭环与真实 `app_root.tscn` E2E 启动测试；打通 `kmod_bundler`、`ModPackageArchiveReader`、`Tier3ContentOverrideLoader`、`Tier3IdentityDestinyApplier`、`StarterLoadoutDispatcher` 与 `check_mod_schema.py` 的 `.kmod` 全链路消费；升级 `CutsceneAsyncLoader`、音频总线桥接与导出打包脚本的真实多媒体与发布支持。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST130-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST130-001_阶段1_全真冷启动协议与KMOD多媒体解耦架构规范.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST130-003_阶段3_去卡拉尔纯净中性底座与分发打包及硬编码阻断规范.md) ｜ [阶段4](KALAR-DEV-2026-ST130-004_阶段4_真冷启动与KMOD多媒体及中性底座全栈回归验收矩阵.md)

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [阶段1_全真冷启动协议与KMOD多媒体解耦架构规范.md](KALAR-DEV-2026-ST130-001_阶段1_全真冷启动协议与KMOD多媒体解耦架构规范.md) · [kmod_bundler.py](../../../../../scripts/py/lib/kmod_bundler.py) · [mod_package_archive_reader.gd](../../../../../backend/domains/narrative_orchestration/mod_package_archive_reader.gd)
- **核心不变量约束断言**: 所有冷启动集成测试必须在 `ServiceLocator` `"real"` 模式下通过 `app_root.tscn` 实例化执行并在 teardown 后实现 0 ObjectDB/RID 泄漏；`CutsceneAsyncLoader` 在确定性夹具模式外严禁伪造成功状态。
- **最高指示断言**: `package-webgames.{ps1,sh}` 保持跨平台参数面与输出结构 100% 同构对等。

---

## 一、 核心工程实现方案

1. **全真冷启动边界与 `app_root.tscn` 无头集成链路**:
   - 更新 [real_version_service.gd](../../../../../frontend/domain_boundary/services/real_version_service.gd) 在 `check_version_async()` 补充 `"compatible": bool(gate_verdict.get("allowed", true))` 并兼容 `VersionActivationGate` 判定结果。
   - 加固 [real_protocol_bridge.gd](../../../../../frontend/domain_boundary/services/real_protocol_bridge.gd) 对畸形响应、`Callable` 有效性及错误上下文进行统一防守。
   - 修复 [real_auth_service.gd](../../../../../frontend/domain_boundary/services/real_auth_service.gd) 第 179 行，按 `ERROR_CODE_I18N_MAP.get(bind_error_code, ERROR_CODE_I18N_MAP["ERR_BIND_FAILED"])` 解析真实失败映射键。
   - 新增全真冷启动 E2E 集成测试套件（挂载 `app_root.tscn` 执行 `AppBootstrap.bootstrap` 在 `"real"` 模式下完成初始化与资源回收）并接入 `TestRegistry`。
2. **`.kmod` 打包、`Tier3` 装载与 SDK Schema 闭合**:
   - 修复 [kmod_bundler.py](../../../../../scripts/py/lib/kmod_bundler.py) 仅排除根目录 `manifest.json` 以保留 `assets/manifest.json`，并统一默认产包命名为 `{pack_id}_v{version}.kmod`。
   - 扩展 [mod_package_archive_reader.gd](../../../../../backend/domains/narrative_orchestration/mod_package_archive_reader.gd) 完整装载 `content/**` 与 `cutscenes/**`；升级 [tier3_content_override_loader.gd](../../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd) 原生读取 `.kmod` 包并阻止 `TOTAL_CONVERSION` 覆盖 `official_pack_id`。
   - 移除 [world_mod_affinity_manager.gd](../../../../../backend/domains/narrative_orchestration/world_mod_affinity_manager.gd) `"official_kalar"` 字面量硬编码；升级 [tier3_identity_destiny_applier.gd](../../../../../backend/domains/narrative_orchestration/tier3_identity_destiny_applier.gd) 从 `races_catalog` 字典同步抽取 `attribute_coefficients`；升级 [starter_loadout_dispatcher.gd](../../../../../backend/domains/character_creation/starter_loadout_dispatcher.gd) 优先读取 `loc_name_key`。
   - 更新 [check_mod_schema.py](../../../../../mod_sdk/tools/check_mod_schema.py) 接入 `races` (`races_catalog.schema.json`) 与 `cutscenes/cutscene_hooks.json` (`cutscene_manifest.schema.json`) 校验。
3. **多媒体真实流式解码与跨平台发行打包脚本升级**:
   - 改造 [cutscene_async_loader.gd](../../../../../backend/infrastructure/media/cutscene_async_loader.gd)：支持 `.ogg` / `.wav` 音频缓冲区真实解码为 `AudioStreamOggVorbis` / `AudioStreamWAV`；在非确定性模式下遇到缺失文件、读取失败或未知后缀时明确输出 `STATUS_FAILED` 与结构化 `error_code`（零静默伪造 `STATUS_LOADED`）。
   - 在 [audio_bus_pipeline.gd](../../../../../backend/domains/event_driven_audio/audio_bus_pipeline.gd) 与 [ui_audio_bridge.gd](../../../../../frontend/ui_infrastructure/ui_audio_bridge.gd) 接入面向 `mod://` / `user://` / `.kmod!/` 的动态音频流解析与触发路径。
   - 升级 [package-webgames.ps1](../../../../../scripts/ps1/package-webgames.ps1) 与 [package-webgames.sh](../../../../../scripts/sh/package-webgames.sh)：支持 `-Target`/`--target`、`--export-release`、UTC `Z` 时间戳、`mods/` 与 `config.kdat` 外部捆绑，并显式排除 `res://dev_harness/` 测试夹具。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 修复 `RealVersionService`、`RealProtocolBridge`、`RealAuthService` 并新增真实 `app_root.tscn` `"real"` 冷启动 E2E 套件。
- [x] Step 2.2: 修复 `kmod_bundler.py`、`ModPackageArchiveReader`、`Tier3ContentOverrideLoader`、`world_mod_affinity_manager.gd`、`Tier3IdentityDestinyApplier`、`StarterLoadoutDispatcher` 与 `check_mod_schema.py`。
- [x] Step 2.3: 改造 `CutsceneAsyncLoader` 音视频真实解码及 `STATUS_FAILED` 错误码路径，并打通 `AudioBusPipeline`/`UIAudioBridge` MOD 音频消费链。
- [x] Step 2.4: 升级 `package-webgames.ps1` 与 `package-webgames.sh` 发行参数、UTC 时间戳、`config.kdat`/`mods/` 打包与 `dev_harness` 剔除。

---

## 三、 冷启动与多媒体功能验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P134-S2-01 | `app_root.tscn` `"real"` 真冷启动 | 在 `"real"` 模式下实例化 `app_root.tscn` 并校验版本与建角错误处理 | `compatible` 为布尔值，建角错误码精确还原，退出 0 泄漏 |
| DOD-P134-S2-02 | `.kmod` 打包与 Tier3 全兼容 | 将含 `assets/manifest.json`、`races_catalog`、`cutscene_hooks` 的包打包并加载 | `assets/manifest.json` 保留，字典形态种族系数生效，`TOTAL_CONVERSION` 不篡改 `official_pack_id` |
| DOD-P134-S2-03 | `.ogg`/`.wav` 解码与缺失失败契约 | 分别加载 `.kmod!/` 真实 WAV/OGG 字节与不存在媒体路径 | 真实流返回 `AudioStream`；缺失文件非确定性模式返回 `STATUS_FAILED` + 错误码 |
| DOD-P134-S2-04 | `package-webgames` 双脚同构 | `audit_pair_parity.py` 及目标打包演练 | `.ps1` 与 `.sh` 参数面、UTC `Z` 时间戳及剔除规则完全一致 |
