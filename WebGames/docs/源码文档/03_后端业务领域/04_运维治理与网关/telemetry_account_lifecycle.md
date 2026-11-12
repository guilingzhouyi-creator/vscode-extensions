# 账号生命周期遥测与环形旁路引擎 (`telemetry_account_lifecycle`)

> 对应源码：`backend/domains/telemetry_account_lifecycle/`（3 个 `.gd`）。以旁路零阻塞方式追踪账号从注册、登录、创角、进世界到心跳的全生命周期阶段，在有界环形缓冲内积攒埋点并支持批量提取落盘。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置键 |
| :--- | :--- | :--- | :--- |
| [telemetry_event_dto.gd](../../../../backend/domains/telemetry_account_lifecycle/telemetry_event_dto.gd) | `TelemetryEventDTO` | 生命周期埋点事件 DTO | 携带事件 UUID、阶段标记、会话时长与扩展维度 |
| [telemetry_sidecar_engine.gd](../../../../backend/domains/telemetry_account_lifecycle/telemetry_sidecar_engine.gd) | `TelemetrySidecarEngine` | 有界环形缓冲旁路引擎 | `record_event()`、`flush_events_batch()`、`get_buffer_count()`；按 `buffer/max_capacity` 防溢出保护 |
| [account_lifecycle_pipeline.gd](../../../../backend/domains/telemetry_account_lifecycle/account_lifecycle_pipeline.gd) | `AccountLifecyclePipeline` | 生命周期跃迁埋点管线 | 定义 `LifecycleStage` 枚举并提供 `track_stage_transition()` |

---

## 二、关联配置与验证

- **配置映射**：`domains.telemetry_account_lifecycle.core`、`narratives.telemetry_account_lifecycle`。
- **测试入口**：[test_telemetry_account_lifecycle.gd](../../../../tests/unit/domains/test_telemetry_account_lifecycle.gd)。
