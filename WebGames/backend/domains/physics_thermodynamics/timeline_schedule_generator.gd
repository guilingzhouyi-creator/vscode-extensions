# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/timeline_schedule_generator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 回合开局一次性生成本回合离散时间轴事件，集成最小间距约束与加发牌点/紧张点排期
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name TimelineScheduleGenerator
extends RefCounted

const TimelineEventScheduleDTOClass = preload("res://backend/domains/physics_thermodynamics/timeline_event_schedule_dto.gd")

## 在回合开始时，依据配置与约束一次性生成整回合离散事件点。
## pending_modifiers 为跨回合修饰（PendingTimelineModifierDTO，Inv-TR-5 显式契约）：
## 仅未消费修饰参与本回合排期，应用后按生命周期递减并置单次消费标记。
static func generate_round_schedule(
	round_number: int,
	max_duration_ms: int,
	rng: RefCounted = null,
	pending_modifiers: Array[PendingTimelineModifierDTO] = []
) -> TimelineEventScheduleDTO:
	var schedule: TimelineEventScheduleDTO = TimelineEventScheduleDTOClass.new()
	schedule.round_number = round_number
	schedule.max_round_duration_ms = max_duration_ms

	var min_spacing := GameConfig.get_int("domains.combat", "tertiary_timeline/min_event_spacing_ms", 1500)
	var event_count_min := GameConfig.get_int("domains.combat", "tertiary_timeline/events_per_round_min", 2)
	var event_count_max := GameConfig.get_int("domains.combat", "tertiary_timeline/events_per_round_max", 4)

	# 跨回合修饰显式消费：跳过已消费项，应用增量，按生命周期递减并置消费标记
	var consumed_modifiers: Array[Dictionary] = []
	for mod in pending_modifiers:
		if mod == null or mod.is_consumed:
			continue
		if mod.event_count_delta != 0:
			event_count_min = maxi(1, event_count_min + mod.event_count_delta)
			event_count_max = maxi(event_count_min, event_count_max + mod.event_count_delta)
		if mod.min_spacing_delta != 0:
			min_spacing = maxi(500, min_spacing + mod.min_spacing_delta)
		mod.lifetime_rounds -= 1
		if mod.lifetime_rounds <= 0:
			mod.is_consumed = true
		consumed_modifiers.append(mod.to_internal_dict())
	# 本回合实际生效的修饰留痕（来源/生命周期/消费标记齐全，可审计）
	schedule.active_modifiers = consumed_modifiers

	var target_count: int = int(rng.randi_range(event_count_min, event_count_max)) if rng else event_count_min

	# 1. 在时限区间内采样 target_count 个互不重叠且保持最小间距的时间点
	var timestamps: Array[int] = _sample_discrete_timestamps(target_count, max_duration_ms, min_spacing, rng)

	# 2. 为每个时间戳分配事件类型 (包含普通发牌点、加发牌点或紧张点)
	#    事件类型按配置权重表 event_type_weights 加权采样（零硬编码阈值，P2 修复）
	var event_weights: Dictionary = GameConfig.get_dict("domains.combat", "tertiary_timeline/event_type_weights", {
		"NORMAL_DRAW": 0.5,
		"ADD_DRAW": 0.25,
		"TENSION_PULSE": 0.25
	})
	var points: Array[TimelineEventScheduleDTO.ScheduledPoint] = []
	var has_tension := false
	var has_draw := false

	for idx in range(timestamps.size()):
		var pt := TimelineEventScheduleDTO.ScheduledPoint.new()
		pt.point_id = "ROUND_%d_EVT_%d" % [round_number, idx + 1]
		pt.trigger_time_ms = timestamps[idx]
		pt.event_kind = _sample_event_kind(event_weights, rng)
		match pt.event_kind:
			TimelineEventScheduleDTO.EventKind.ADD_DRAW:
				pt.payload = {"extra_bonus_cards": 1}
			TimelineEventScheduleDTO.EventKind.TENSION_PULSE:
				pt.payload = {"tension_type": "PRESSURE_SURGE"}
				has_tension = true
			_:
				has_draw = true
		points.append(pt)

	# 结构保证（Inv-TR-4 精神）：每回合至少 1 个普通发牌点与 1 个紧张点，防回合空转/无张力
	if not has_draw and not points.is_empty():
		points[0].event_kind = TimelineEventScheduleDTO.EventKind.NORMAL_DRAW
	if not has_tension and not points.is_empty():
		points[points.size() - 1].event_kind = TimelineEventScheduleDTO.EventKind.TENSION_PULSE
		points[points.size() - 1].payload = {"tension_type": "PRESSURE_SURGE"}

	schedule.scheduled_points = points
	return schedule

## 按配置权重表加权采样事件类型（event_type_weights，权重合计由 value_domain 归一门禁校验）
static func _sample_event_kind(weights: Dictionary, rng: RefCounted = null) -> int:
	var roll: float = float(rng.randf()) if rng else 0.5
	var accum := 0.0
	for kind_name in weights.keys():
		accum += float(weights[kind_name])
		if roll <= accum:
			match str(kind_name):
				"ADD_DRAW":
					return TimelineEventScheduleDTO.EventKind.ADD_DRAW
				"TENSION_PULSE":
					return TimelineEventScheduleDTO.EventKind.TENSION_PULSE
				_:
					return TimelineEventScheduleDTO.EventKind.NORMAL_DRAW
	return TimelineEventScheduleDTO.EventKind.NORMAL_DRAW

static func _sample_discrete_timestamps(
	count: int,
	max_duration_ms: int,
	min_spacing: int,
	rng: RefCounted = null
) -> Array[int]:
	var result: Array[int] = []
	if count <= 0:
		return result

	var usable_window := max_duration_ms - (count * min_spacing)
	if usable_window <= 0:
		# 间距过大兜底线性均匀分布
		var step := int(float(max_duration_ms) / float(count + 1))
		for i in range(count):
			result.append((i + 1) * step)
		return result

	var current_mark := 500 # 避开回合刚开始的瞬时
	var step_slot := int(float(usable_window) / float(count))
	for i in range(count):
		var jitter: int = int(rng.randi_range(0, step_slot)) if rng else int(step_slot / 2)
		var t: int = current_mark + jitter
		t = clampi(t, 100, max_duration_ms - 200)
		result.append(t)
		current_mark = t + min_spacing

	result.sort()
	return result
