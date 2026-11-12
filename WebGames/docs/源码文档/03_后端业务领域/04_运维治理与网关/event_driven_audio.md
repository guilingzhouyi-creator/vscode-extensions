# 事件驱动音频、空间声相与复音限流 (`event_driven_audio`)

> 对应源码：`backend/domains/event_driven_audio/`（3 个 `.gd`）。接收战斗/剧情事件驱动多音轨分发，通过空间欧氏距离线性衰减与左右声相 Pan 求解声音参数，并以复音数限制防止同类音效过载爆音。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [audio_dispatch_command_dto.gd](../../../../backend/domains/event_driven_audio/audio_dispatch_command_dto.gd) | `AudioDispatchCommandDTO` | 音频调度指令 DTO | 定义 `AudioBusTrack` 枚举；读取 `command_defaults/{fade_duration_seconds,max_audible_distance,pitch_scale,volume_scale}` |
| [spatial_audio_solver.gd](../../../../backend/domains/event_driven_audio/spatial_audio_solver.gd) | `SpatialAudioSolver` | 空间声学计算器 | `evaluate_spatial_audio()`、`dispatch_spatial_audio_event()` 计算距离衰减、Pan 声道比及超距静默拦截 |
| [audio_bus_pipeline.gd](../../../../backend/domains/event_driven_audio/audio_bus_pipeline.gd) | `AudioBusPipeline` | 总线限流分发管线 | `dispatch_sound_event()`、`release_sound_instance()` 实施 `concurrency/max_per_sound` 复音限制并映射 `bus/tracks` |

---

## 二、关联配置与验证

- **配置映射**：`domains.event_driven_audio.core`、`narratives.event_driven_audio`。
- **测试入口**：[test_event_driven_audio.gd](../../../../tests/unit/domains/test_event_driven_audio.gd)。
