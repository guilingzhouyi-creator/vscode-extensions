# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/timeline_event_schedule_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 承载单回合开局预排期的离散时间点与事件种类定义，支持跨回合修饰
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name TimelineEventScheduleDTO
extends RefCounted

enum EventKind {
	NORMAL_DRAW,     # 普通随机发牌点 (依数量规则动态抽卡推入手牌)
	ADD_DRAW,        # 加发牌点 (局势奖励额外补发 1~2 张卡牌)
	TENSION_PULSE,   # 回内紧张点 (触发压力激增、环境脉冲或强行切轮)
}

class ScheduledPoint extends RefCounted:
	var point_id: String = ""
	var event_kind: int = EventKind.NORMAL_DRAW
	var trigger_time_ms: int = 0               # 仅后端内部持有的绝对毫秒时间戳
	var payload: Dictionary = {}               # 事件专属参数 (如紧张类型、加牌参数)
	var is_executed: bool = false              # 是否已触发完成

	func to_internal_dict() -> Dictionary:
		return {
			"point_id": point_id,
			"event_kind": event_kind,
			"trigger_time_ms": trigger_time_ms,
			"payload": payload.duplicate(true),
			"is_executed": is_executed,
		}

var round_number: int = 1
var max_round_duration_ms: int = 10000
var scheduled_points: Array[ScheduledPoint] = []
var active_modifiers: Array[Dictionary] = []

func to_internal_dto() -> Dictionary:
	var pts: Array[Dictionary] = []
	for p in scheduled_points:
		pts.append(p.to_internal_dict())
	return {
		"round_number": round_number,
		"max_round_duration_ms": max_round_duration_ms,
		"scheduled_points": pts,
		"active_modifiers": active_modifiers.duplicate(true),
	}
