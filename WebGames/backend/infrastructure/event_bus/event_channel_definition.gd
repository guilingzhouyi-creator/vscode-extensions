# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_channel_definition.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 路由唯一真源常量表。整型信道热路径零字符串切分与匹配。 与旧版/P71字符串频道的迁移对齐映射表置于 config/infrastructure/event_bus_config.json。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name EventChannelDefinition
extends RefCounted

# ---- 一、核心战斗信道 (0x0100 ~ 0x01FF) ----
const COMBAT_HIT_RESOLVED: int        = 0x0101
const COMBAT_ROUND_ADVANCED: int      = 0x0102
const COMBAT_ENTITY_DIED: int         = 0x0103

# ---- 二、空间物理与移动信道 (0x0200 ~ 0x02FF) ----
const SPATIAL_POSITION_CHANGED: int   = 0x0201
const SPATIAL_COLLISION_CONTACT: int  = 0x0202
const SPATIAL_TRIGGER_ENTERED: int    = 0x0203
const SPATIAL_EXPLOSION_IMPACT: int   = 0x0204
const SPATIAL_AUDIO_PLAY: int         = 0x0205

# ---- 三、HUD 与数值状态信道 (0x0300 ~ 0x03FF，承接 P71) ----
const HUD_STATUS_SNAPSHOT: int        = 0x0301
const HUD_STAT_MUTATED: int           = 0x0302
const HUD_WALLET_MUTATED: int         = 0x0303

# ---- 四、账户与生命周期信道 (0x0400 ~ 0x04FF，承接 P71) ----
const AUTH_REGISTERED: int            = 0x0401
const AUTH_LOGIN_SUCCEEDED: int       = 0x0402
const LIFECYCLE_SHUTDOWN_STARTED: int = 0x0403

# ---- 五、系统遥测信道 (0x0500 ~ 0x050F) ----
const SYSTEM_HEARTBEAT_TICK: int      = 0x0501
const SYSTEM_TELEMETRY_METRIC: int    = 0x0502
const LOG_RECORD_POSTED: int          = 0x0503

# ---- 六、版本治理与灰度控制信道专区 (0x0510 ~ 0x05FF) ----
const VERSION_ANNOUNCED: int         = 0x0510
const UPDATE_AUTHORIZED: int         = 0x0511
const UPDATE_PROGRESS_REPORT: int    = 0x0512
const VERSION_ACTIVATED: int         = 0x0513
const VERSION_ROLLBACK_ISSUED: int   = 0x0514
const VERSION_REVOKED: int           = 0x0515

# ---- 七、叙事与泛化领域广播信道 (0x0600 ~ 0x06FF，承接旧总线退役) ----
const NARRATIVE_EVENT_TEXT: int      = 0x0601
const DOMAIN_EVENT_GENERIC: int      = 0x0602
const WORLD_CLOCK_ADVANCED: int      = 0x0603
const PROFESSION_PROMOTED: int       = 0x0604

