---
档号: KALAR-DEV-2026-ST130-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST130 (Phase_134_全真冷启动与KMOD多媒体及纯净中性底座硬化施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_134_全真冷启动与KMOD多媒体及纯净中性底座硬化施工细则 —— 阶段1：全真冷启动协议与KMOD多媒体解耦架构规范
形成日期: 2026-11-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 全真冷启动协议; KMOD多媒体解耦架构规范; manifest.json
---

# 施工细则：全真冷启动与KMOD多媒体及纯净中性底座硬化 —— 阶段1：全真冷启动协议与KMOD多媒体解耦架构规范

> 状态: 已验收 (Phase 134 Completed)
> 施工开始日期: 2026-11-15

> [!NOTE]
> **【施工目标】** 确立无预设夹具的 `app_root.tscn` 全真冷启动架构契约、`.kmod` 全资产打包与 `TOTAL_CONVERSION` 严格隔离规范、多格式视听媒体（`.ogv`/`.ogg`/`.wav`）在 `.kmod!/` 与 `user://` 下的真实流式解码与失败显式语义，以及“空底座零剧情专有名词、空默认值严禁静默遮蔽真缺口”的中性母机硬化边界。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST130-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST130-002_阶段2_全真冷启动与Tier3及KMOD音视频管线实现规范.md) ｜ [阶段3](KALAR-DEV-2026-ST130-003_阶段3_去卡拉尔纯净中性底座与分发打包及硬编码阻断规范.md) ｜ [阶段4](KALAR-DEV-2026-ST130-004_阶段4_真冷启动与KMOD多媒体及中性底座全栈回归验收矩阵.md)

---

## 📌 第一性原理溯源指针

- **精准上游规范指针**: [app_root.gd](../../../../../frontend/app/app_root.gd) · [app_bootstrap.gd](../../../../../frontend/app/app_bootstrap.gd) · [cutscene_async_loader.gd](../../../../../backend/infrastructure/media/cutscene_async_loader.gd) · [tier3_content_override_loader.gd](../../../../../backend/domains/narrative_orchestration/tier3_content_override_loader.gd)
- **核心不变量约束断言**: (1) 缺失 `assets/manifest.json` 或缺失物理媒体文件在非确定性运行模式下必须显式返回 `STATUS_FAILED` 与结构化错误码，严禁静默返回空资源的 `STATUS_LOADED`；(2) `TOTAL_CONVERSION` 全转换模组严禁污染或覆写 `official_pack_id`；(3) 基座配置、项目元数据与 SDK 默认参数严禁硬编码单一世界观专有名词，也不得以空字符串 `""` 掩盖配置缺失。
- **最高指示断言**: 坚持结构正交与真源唯一，所有音频/媒体加载、`.kmod` 打包与冷启动校验必须以无头 E2E 真场景挂载验证为最终准绳。

---

## 一、 核心架构与契约设计

1. **全真冷启动与边界协议完整性契约 (`cold_start_protocol`)**:
   - [real_version_service.gd](../../../../../frontend/domain_boundary/services/real_version_service.gd) 在 `check_version_async()` 响应中显式透传 `compatible: bool`（与 `VersionActivationGate` 及运行版本兼容门禁对齐）。
   - [real_protocol_bridge.gd](../../../../../frontend/domain_boundary/services/real_protocol_bridge.gd) 对空载荷、异常响应体与异步回调调度提供结构化错误码映射，消除隐式空引用。
   - [real_auth_service.gd](../../../../../frontend/domain_boundary/services/real_auth_service.gd) 在 `create_character_async()` 角色槽绑定失败分支中，通过 `ERROR_CODE_I18N_MAP.get(bind_error_code, ...)` 透传具体错误键，防止吞没精确失败原因。
2. **`.kmod` 全包归档与 Tier 3 装载隔离契约 (`kmod_tier3_isolation`)**:
   - `kmod_bundler.py` 仅忽略根目录清单元数据 `manifest.json`，完整保留 `assets/manifest.json` 并统一输出命名 `{pack_id}_v{version}.kmod`。
   - `ModPackageArchiveReader` 完整解析 `.kmod` 内的 `content/**` 与 `cutscenes/**`；`Tier3ContentOverrideLoader` 原生支持从 `.kmod` 文件直接读取全包字典，且仅当 `pack_profile == "OFFICIAL_BASE"` 或显式 `is_official == true` 时写入 `official_pack_id`。
   - [world_mod_affinity_manager.gd](../../../../../backend/domains/narrative_orchestration/world_mod_affinity_manager.gd) 拆除 `"official_kalar"` 硬编码白名单，完全依据锁定元数据 (`is_official` / `pack_profile`) 裁决必选包属性。
3. **多媒体流式加载与音频总线条带契约 (`kmod_multimedia_pipeline`)**:
   - [cutscene_async_loader.gd](../../../../../backend/infrastructure/media/cutscene_async_loader.gd) 为图像、`.ogg`（`AudioStreamOggVorbis.load_from_buffer`）与 `.wav` 音频建立统一字节流加载路径，识别 `mod://` / `user://` / `.kmod!/` 协议，并在缺失资产、空缓冲或不支持格式时在非确定性模式下返回 `STATUS_FAILED` 与 `ERR_MEDIA_MISSING` / `ERR_MEDIA_DECODE_FAILED` / `ERR_UNSUPPORTED_MEDIA_FORMAT`。
   - `AudioBusPipeline` 与 `UIAudioBridge` 接入 MOD 资源路径解析与音频流触发消费链路，分发脚本 `package-webgames.{ps1,sh}` 支持 `-Target`/`--target`、`--export-release`、UTC `Z` 时间戳及剔除 `res://dev_harness/`。
4. **纯净中性底座与静态守卫增强契约 (`neutral_base_hardening`)**:
   - 剥离基座 `config/narratives/`、`version_manifest.json`、`project.godot`、`export_presets.cfg` 与 `mod_sdk` 默认模板中的卡拉尔剧情名词并沉淀至 `mods/official_kalar/`（重算 SHA-256）；清理以 `""` 伪装默认值的配置项，由领域层提供明确中性语义默认回退。
   - 强化 `audit_hardcode.py`（收紧 `MIN_BUSINESS_STRING_LENGTH` 并对齐 `--strict` 阻断）、`TC-ARCH-06`（全前端与基础设施配置引用覆盖）、`TestConfigurationGuard` 与 `TestNeutralitySdkAndGatesPipeline`。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 1.1: 冻结阶段1冷启动、`.kmod` 隔离、多媒体流式加载与底座中性化四大架构契约。
- [x] Step 1.2: 校准所有受影响接口、Schema (`races_catalog` / `cutscene_manifest`) 与测试注册表依赖拓扑。
- [x] Step 1.3: 交付阶段2~4施工细则并在 `路线图总索引.md` 登记 `Phase_134` 为在途施工案卷。

---

## 三、 架构契约与不变量验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DOD-P134-S1-01 | 冷启动兼容字段与错误映射 | `RealVersionService`、`RealProtocolBridge`、`RealAuthService` 契约定义 | `compatible` 布尔字段必现，异常错误码 100% 结构化透传 |
| DOD-P134-S1-02 | `.kmod` 隔离与 Tier 3 装载契约 | `TOTAL_CONVERSION` 包与 `.kmod` 归档规范 | 保留 `assets/manifest.json`，零跨包污染 `official_pack_id` |
| DOD-P134-S1-03 | 非确定性多媒体失败显式语义 | 缺失音频/视频/非法后缀请求 | `STATUS_FAILED` + 结构化 `error_code`，音视频字节流可真实解码 |
| DOD-P134-S1-04 | 纯净底座零剧情与实值默认 | 无 MOD 基座配置集与静态守卫规约 | 基座无世界观专有名词，无空字符串默认遮蔽 |
