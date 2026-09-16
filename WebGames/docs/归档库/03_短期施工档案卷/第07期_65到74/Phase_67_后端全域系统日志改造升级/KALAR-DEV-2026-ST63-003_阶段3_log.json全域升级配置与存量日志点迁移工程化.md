---
档号: KALAR-DEV-2026-ST63-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST63 (Phase_67_后端全域系统日志改造升级)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_67_后端全域系统日志改造升级 —— 阶段3：log.json全域升级配置与存量日志点迁移工程化
形成日期: 2026-09-06
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: LogRetentionCleaner; 增补四段配置; 脱敏规则默认集; LogCollector 与 P66 通道衔接; log.json
---

# 施工细则：Phase 67 后端全域系统日志改造升级 —— 阶段3：log.json 全域升级配置与存量日志点迁移工程化

> 施工开始日期：2026-09-06
> 验收完成日期：2026-09-06
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（DoD 100% 达成，85 套测试 574 项全 PASS，18 项门禁全绿）

> [!NOTE]
> **【施工目标】**：在阶段2 算法（`LogCollector` / `LogRingBuffer` / `TelemetryAggregate` / `LogQueryService`）基础上，完成配置驱动扩展与全域存量日志点迁移：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST63-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST63-ATT_附件_案卷共享契约与上下文.md)。
> 1. `log.json` 增补 `structured` / `redaction` / `telemetry` / `retention` 四段配置，支撑环形缓冲容量、脱敏规则、遥测窗口采样、日志保留期——全域日志参数全配置驱动（Inv-LS-1/4 + 有界收敛）；
> 2. `structured_log_record` 脱敏规则注册表入配置（`log.json redaction`），敏感键（token/指纹/口令/密钥）掩码策略零硬编码（Inv-LS-2 安全红线）；
> 3. 存量日志点逐文件迁移：散落 `print` / `push_warning` 业务日志点收敛到 `LogCollector.log` 统一采集管线（Inv-LS-1 结构化完整性），附迁移清单与计数目标；
> 4. 日志保留期与运维接线：导出文件按 `retention` 段滚动清理，运维/测试经 `LogQueryService` 只读检索（Inv-LS-5）。
> **对应需求源**：后端无头模块四维度审查报告 → 维度四日志体系升级；P67 阶段1/2 契约（Inv-LS-1~5）工程化落地。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST63-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST63-001_阶段1_全域结构化日志数据模型设计.md) ｜ [阶段2](KALAR-DEV-2026-ST63-002_阶段2_日志采集导出脱敏遥测聚合与检索算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST63-004_阶段4_全域日志改造升级全量验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - `config/infrastructure/log.json`：既有 `levels`/`default_level`/`format` + P66 增补 `export` 段——P67 增补 `structured`/`redaction`/`telemetry`/`retention` 四段；
  - `backend/infrastructure/log_collector.gd`（P67 阶段2）：统一采集入口（`LogCollector.log`）；
  - `backend/infrastructure/log_ring_buffer.gd`（P67 阶段2）：环形缓冲（容量配置驱动）；
  - `backend/infrastructure/log_file_exporter.gd`（P66 阶段2）：NDJSON 落盘导出器（保留期清理与导出器联动）；
  - `backend/infrastructure/game_config.gd:L46-L108`：`_required_tables` 清单与热重载版本机制。

* **核心不变量约束断言**：
  - `Inv-LS-1`（结构化完整性不变量）：存量 `print`/`push_warning` 业务日志点迁移后，全域日志经 `LogCollector.log` 统一采集，零自由拼串文本入日志流；
  - `Inv-LS-2`（脱敏不可逆不变量）：`log.json redaction` 规则驱动掩码，Token/指纹/口令/密钥零明文路径（含调试级）；
  - `Inv-LS-4`（遥测单向不变量）：遥测参数（窗口/采样）仅配置遥测聚合自身，禁反向影响日志级别/内容；
  - `Inv-LS-5`（检索只读不变量）：运维/测试检索只经 `LogQueryService`，零写操作；
  - 有界收敛：环形缓冲容量、遥测窗口、保留期全部配置驱动，内存与磁盘零无界增长。

* **防漂移最高指示**：
  - `log.json` 增段必须过 `audit_config` 值域校验与 `audit-all.sh` 文档门禁，零新增违规；
  - 存量日志点迁移为逐文件增量登记（附迁移清单 M1~Mn），禁止一次大改破坏 `emit_log`/`print` 既有语义；
  - 脱敏边界为安全红线：`redaction` 规则缺失时默认保守掩码（宁过掩不露明），禁止为「日志可读性」放宽脱敏。

---

## 一、 配置表结构映射 (Config Schema Mapping)

### 1.1 `config/infrastructure/log.json` 增补四段配置

```json
{
  "levels": { "debug": "DEBUG", "info": "INFO", "warn": "WARN", "error": "ERROR" },
  "default_level": "info",
  "format": "[%s] %s",
  "export": {
    "enabled": true,
    "directory": "user://logs",
    "file_prefix": "kalar",
    "max_bytes": 5242880,
    "max_files": 5,
    "min_level": "info",
    "include_channels": []
  },
  "structured": {
    "enabled": true,
    "ring_buffer_capacity": 1000,
    "json_indent": 0
  },
  "redaction": {
    "enabled": true,
    "rules": [
      { "field_pattern": "token|session_token", "mask_mode": "mask", "mask_prefix_len": 4, "mask_suffix_len": 4, "replace_with": "****" },
      { "field_pattern": "fingerprint|device_fingerprint", "mask_mode": "mask", "mask_prefix_len": 4, "mask_suffix_len": 0, "replace_with": "****" },
      { "field_pattern": "password|password_hash|secret|seal_key", "mask_mode": "drop" },
      { "field_pattern": "account_id", "mask_mode": "hash" }
    ],
    "default_mode": "mask"
  },
  "telemetry": {
    "enabled": true,
    "window_seconds": 60,
    "sample_size": 256
  },
  "retention": {
    "enabled": true,
    "max_days": 7,
    "cleanup_interval_seconds": 3600
  }
}
```

**四段字段映射**：

| JSON 段 | 键 | 消费方 | 说明 |
| :--- | :--- | :--- | :--- |
| `structured` | `enabled` | `LogCollector` | 结构化采集总开关；false 时退化为 P66 文本记录 |
| `structured` | `ring_buffer_capacity` | `LogRingBuffer` | 环形缓冲容量（有界收敛，默认 1000） |
| `structured` | `json_indent` | 落盘序列化 | NDJSON 行式（0）或美化缩进（调试用） |
| `redaction` | `enabled` / `rules` | `RedactionRule` | 脱敏开关 + 规则表（Inv-LS-2 安全红线） |
| `redaction` | `default_mode` | `RedactionRule` | 未命中规则敏感键的保守兜底（默认 mask） |
| `telemetry` | `enabled` / `window_seconds` / `sample_size` | `TelemetryAggregate` | 遥测开关/窗口/分位样本量（Inv-LS-4 单向） |
| `retention` | `enabled` / `max_days` / `cleanup_interval_seconds` | `LogFileExporter` 清理任务 | 导出文件保留期滚动清理（磁盘有界） |

**热重载语义**：四段配置经 `config_reload_version()` 版本比对，`RedactionRule`/`LogRingBuffer`/`TelemetryAggregate`/保留期清理任务各自守卫重建（复用 Phase 64 P2 模式）。

### 1.2 脱敏规则默认集（安全基线，Inv-LS-2）

| 敏感键模式 | 掩码模式 | 说明 |
| :--- | :--- | :--- |
| `token` / `session_token` | mask（前缀4+后缀4） | 会话凭证部分掩码，保留可辨识性 |
| `fingerprint` / `device_fingerprint` | mask（前缀4+后缀0） | 设备指纹首 4 位可辨识 |
| `password` / `password_hash` / `secret` / `seal_key` | drop | 口令/密钥整键丢弃，零入流 |
| `account_id` | hash | 账号 ID 保留 SHA-256 指纹（一致性比对，不还原） |
| 未命中规则的其他潜在敏感键 | default_mode=mask | 保守兜底：宁过掩不露明 |

**安全红线断言**：全库测试断言——构造含上述键的 context 记录后，落盘/环形缓冲/检索结果中零明文（阶段4 TC-LS-19）。

## 二、 存量日志点迁移清单 (Migration Checklist)

**原则**：逐文件增量迁移，`LogCollector.log` 统一采集；`print` 调试点收敛为 `debug` 级结构化日志（禁保留裸 print 于业务路径）；`push_warning` 收敛语义与 P66 迁移清单（M1~M10）衔接（错误码走 `ErrorReporter`，业务日志走 `LogCollector`）。

| # | 源文件:行 | 现状 | 收敛目标 | 级别 |
| :--- | :--- | :--- | :--- | :--- |
| M1 | `combat_round_coordinator.gd:284` 等 | `print("[Combat] ...")` 战报直打 | `LogCollector.log("debug", "combat_round_coordinator", msg, {"round": n})` | debug |
| M2 | `tertiary_timeline_engine.gd:121` | `print("[Timeline] ...")` 事件直打 | `LogCollector.log("debug", "tertiary_timeline_engine", msg, {"event": e})` | debug |
| M3 | `world_gateway_fsm.gd:112` | `print("[Gateway] ...")` 状态直打 | `LogCollector.log("info", "world_gateway_fsm", msg, {"phase": p})` | info |
| M4 | `account_entry_view.gd:505` 等 | `print("[AccountEntry] ...")` 前端占位 | 前端侧迁移到 `LogCollector.log`（或保持前端控制台，标记 non-backend） | debug |
| M5 | `main_hud_view.gd` 战报直打 | `print("[HUD] ...")` 占位 | 前端战报经 EventBus 叙事通道（已有），裸 print 清理 | debug |
| M6 | `game_lifecycle_service.gd:117` | `emit_log("info", ...)`（P66 已统一） | 补充 trace_id（停机管线入口 begin_trace） | info |
| M7 | `save_manager.gd:84` | `emit_log("info", ...)` | 补充 trace_id + event_category（persistence） | info |
| M8 | `auth_service.gd` 鉴权日志 | `emit_log` 无结构 | `LogCollector.log(..., {"account_id_hash": ...})`（account_id 走 hash 脱敏） | info |
| M9 | `starter_loadout_dispatcher.gd:24` 等 | `print` 发放直打 | `LogCollector.log("info", "starter_loadout_dispatcher", ...)` | info |
| M10 | `event_bus.gd:83` | `emit_narrative` 内联 `log_message_posted` | 保留（前端通道），结构化记录走 `emit_log_record` 旁路 | — |

**迁移验收**：M1~M9 落地后，全库业务路径 `grep -rn "print("` 断言零残留（`scripts/py` 与测试夹具豁免）；`LogCollector.log` 调用点 ≥ 迁移清单目标数。

## 三、 全域接线工程化 (Wiring & Engineering)

### 3.1 `LogCollector` 与 P66 通道衔接

- `EventBus.emit_log` 委托 `LogCollector.log`（channel 缺省 ""），既有 P66 `LogFileExporter` 消费方零改动；
- `emit_log_record` 广播链路保持：前端信号转发 + 环形缓冲 append + 遥测 consume + 导出落盘四路齐发（P67 采集管线下游全接）。

### 3.2 保留期清理任务（磁盘有界）

```gdscript
# backend/infrastructure/log_retention_cleaner.gd
class_name LogRetentionCleaner extends RefCounted:

    ## 周期清理：删除超出 max_days 的轮转归档（主文件保留，仅清理过期归档）
    static func sweep_if_due(now_utc: int = -1) -> int:
        var now := now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
        var cfg := GameConfig.get_dict("infrastructure.log", "retention", {})
        if not bool(cfg.get("enabled", true)):
            return 0
        var max_days := int(cfg.get("max_days", 7))
        if max_days <= 0:
            return 0
        var interval := int(cfg.get("cleanup_interval_seconds", 3600))
        if now - _last_sweep < interval:
            return 0
        _last_sweep = now
        var dir := GameConfig.get_string("infrastructure.log", "export/directory", "user://logs")
        var prefix := GameConfig.get_string("infrastructure.log", "export/file_prefix", "kalar")
        var removed := 0
        var da := DirAccess.open(dir)
        if da == null:
            return 0
        for f in da.get_files():
            if f.begins_with(prefix + ".") and f.ends_with(".log"):
                var ts := _extract_timestamp(f)
                if ts > 0 and now - ts > max_days * 86400:
                    if DirAccess.remove_absolute("%s/%s" % [dir, f]) == OK:
                        removed += 1
        return removed

    static var _last_sweep: int = 0
```

**要点**：仅清理**过期轮转归档**（主文件保留），间隔配置驱动（默认 3600s 一次），磁盘零无界增长；`_extract_timestamp` 从归档文件名时间戳段解析（与阶段3 P66 轮转命名「前缀.unix时间戳.log」对齐）。

### 3.3 运维/测试检索接线

- 运维终端/调试面板经 `LogQueryService.query(Criteria)` 只读检索（Inv-LS-5）；
- 测试套件经 `LogRingBuffer.query` / `TelemetryAggregate.snapshot` 断言日志行为（阶段4 用例基座）。

## 四、 阶段3 交付物与验收断言

| 交付物 | 路径 | 验收断言 |
| :--- | :--- | :--- |
| `log.json` 四段配置 | `config/infrastructure/log.json` | `structured`/`redaction`/`telemetry`/`retention` 四段字段齐备；值域校验过 |
| `RedactionRule` 配置驱动 | `backend/infrastructure/redaction_rule.gd` | 规则表装载正确；default_mode 兜底生效 |
| 存量迁移 M1~M9 | 见迁移清单 | 全库业务路径 `print(` 零残留；`LogCollector.log` 调用点达标 |
| `LogRetentionCleaner` | `backend/infrastructure/log_retention_cleaner.gd` | 过期归档清理正确；主文件保留；间隔节流生效 |
| 检索接线 | `backend/infrastructure/log_query_service.gd` | 运维/测试经只读检索；环形缓冲 + 文件双源合并 |
