# 施工细则：全域非阻塞CG视频播放与剧情通用Hook引擎 —— 阶段1：视频与CG媒体数据契约参数化DTO与Hook配置标准规范

> 施工开始日期: 2026-11-08
> 状态: 进行中

> [!NOTE]
> 【施工目标】
> 确立卡拉尔引擎全域 CG 与视频媒体资源的标准数据模型、强类型请求 DTO、多语言字幕映射契约与配置驱动 Hook 规则规范；
> 彻底确立剧情逻辑中零视频硬编码（Zero-Hardcoding）以及纯净裸流免加密（Zero-Encryption）存储标准。

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针
- 契约规范真源：`WebGames/mod_sdk/docs/SPECIFICATION.md`
- 剧情因果 DAG 引擎：[`NarrativeDagExecutionEngine`](../../../../backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd)
- 异步工作流抽象：[`StorageContractInterfaces`](../../../../backend/domains/persistence_protocol/storage_contract_interfaces.gd)

### 1.2 核心不变量约束断言
- **零硬编码不变量 (Inv-ZERO-HARDCODE-1)**：剧情 DAG 节点、任务定义与战斗逻辑中严禁出现任何视频物理路径（如 `res://...*.ogv`）或播放器 API 显式硬编码；
- **纯净免加密不变量 (Inv-PLAIN-STREAM-2)**：视频与 CG 资产属于大体积连续媒体流，采用标准裸流存储，不经过 LCG 流掩码或压缩，保障硬件流式解码最高吞吐；
- **强类型可重入不变量 (Inv-REENTRANT-DTO-3)**：所有播放参数封装于不可变 `CutsceneRequestDTO` 中，支持多线程或协程安全流转。

### 1.3 防漂移最高指示
严禁以快速实现为由在剧情脚本中临时引入播放器单例直调；所有调用必须通过 Hook 规则表或参数化请求 DTO 进行收口分发。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] Step 1.1: 创建参数化请求模型 `CutsceneRequestDTO`（支持跳过、音轨、字幕、音量、黑屏过渡与上下文）。
- [ ] Step 1.2: 创建播放状态追踪模型 `CutscenePlaybackStateDTO` 与资产清单模型 `CutsceneManifestDTO`。
- [ ] Step 1.3: 建立全域资产注册表 `config/domains/media_cutscene/cutscene_registry.json`。
- [ ] Step 1.4: 建立全域 Hook 路由拦截表 `config/domains/media_cutscene/cutscene_hooks.json`。
- [ ] Step 1.5: 在 MOD SDK 下发布 `cutscene_schema.json` 供扩展模组使用。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-CS-0101** | 参数化 DTO 默认值与字段覆盖 | 实例化 `CutsceneRequestDTO.new()` | 12 个参数字段齐备，默认 `skippable=true`, `fade_in_sec=0.5` |
| **DOD-CS-0102** | 状态 DTO 序列化往返等价 | `CutscenePlaybackStateDTO.to_dict()` | 往返字典序列化数据完全一致 |
| **DOD-CS-0103** | 配置表 Schema 静态校验 | 验证 `cutscene_registry.json` 与 `cutscene_hooks.json` | 格式合规且能被 `GameConfig` 正常检索 |
