# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/visual_cue_dto.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线空间表现载荷 DTO：封装事件 ID、发射源坐标、宿主目标、视觉效果标记（FX/Sound/CameraShake）与衰减权重。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name VisualCueDTO
extends RefCounted

## 语义化视觉令牌枚举
enum CueToken {
	UNKNOWN = 0,
	ATTACK_SLASH_LIGHT = 1,
	ATTACK_SLASH_HEAVY = 2,
	HIT_IMPACT_BLUNT = 10,
	HIT_IMPACT_SLASH = 11,
	SPELL_BURST_ELEMENTAL = 20,
	FOOTSTEP_GROUND = 30,
	STATUS_BUFF_ACTIVE = 40,
	STATUS_DEBUFF_ACTIVE = 41
}

## 表现挂载点枚举
enum AnchorPoint {
	ORIGIN_FEET = 0,
	PRIMARY_HAND = 1,
	SECONDARY_HAND = 2,
	CHEST_CENTER = 3,
	HEAD_OVERHEAD = 4
}

var cue_token: int = CueToken.UNKNOWN
var anchor: int = AnchorPoint.ORIGIN_FEET
var intensity: float = 1.0
var duration_sec: float = 0.0
var custom_params: Dictionary = {}
