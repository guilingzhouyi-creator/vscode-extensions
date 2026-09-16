# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/tertiary_timeline_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 独立于玩家操作轴与小回合轴的第三时间轴，负责持续推演战斗虚拟时钟， 按离散随机分布排期并触发「随机发放点」与「回内紧张点」两大离散时间事件。 配置由 config/domains/combat.json tertiary_timeline 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name TertiaryTimelineEngine
extends RefCounted

enum TimelineEventType {
	RANDOM_DISPATCH,     # 随机发放点 (触发随机卡池抽取并推入手牌待发栏)
	TENSION_PULSE,       # 回内紧张点 (触发战场压力突变、环境脉冲、强行转回合等)
}

class TimelineEventPointDTO extends RefCounted:
	var event_id: String = ""
	var event_type: TimelineEventType = TimelineEventType.RANDOM_DISPATCH
	var trigger_time_ms: int = 0               # 绝对战斗时间点 (ms)
	var payload: Dictionary = {}               # 附带参数 (抽卡策略/紧张事件类型)
	var is_processed: bool = false

	func to_dto() -> Dictionary:
		return {
			"event_id": event_id,
			"event_type": int(event_type),
			"trigger_time_ms": trigger_time_ms,
			"payload": payload.duplicate(true),
			"is_processed": is_processed,
		}

var current_timeline_ms: int = 0
var scheduled_events: Array[TimelineEventPointDTO] = []
var rng: DeterministicRNG = null
var event_counter: int = 0

## 时间轴排期参数静态缓存（Phase 64 P2 模式：配置热重载版本推进自动失效重建）。
## _build_next_* 每次事件触发重排期原本 5 次 GameConfig 路径查找（dispatch/tension 区间
## 与 tension_types）——缓存后每次重排期仅一次版本比对 + 字段复制。
class TimelineParams extends RefCounted:
	var dispatch_min_ms: int = 1200
	var dispatch_max_ms: int = 2800
	var tension_min_ms: int = 4500
	var tension_max_ms: int = 8500
	var tension_types: Array = ["PRESSURE_SURGE", "ENVIRONMENT_PULSE", "FORCE_ROUND_ADVANCE"]

static var _timeline_cache: TimelineParams = null
static var _timeline_config_version: int = -1

## 时间轴排期参数缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_timeline_cache() -> void:
	if _timeline_cache != null and _timeline_config_version == GameConfig.config_reload_version():
		return
	var p := TimelineParams.new()
	p.dispatch_min_ms = maxi(1, GameConfig.get_int("domains.combat", "tertiary_timeline/dispatch_interval_min_ms", 1200))
	p.dispatch_max_ms = maxi(p.dispatch_min_ms, GameConfig.get_int("domains.combat", "tertiary_timeline/dispatch_interval_max_ms", 2800))
	p.tension_min_ms = maxi(1, GameConfig.get_int("domains.combat", "tertiary_timeline/tension_interval_min_ms", 4500))
	p.tension_max_ms = maxi(p.tension_min_ms, GameConfig.get_int("domains.combat", "tertiary_timeline/tension_interval_max_ms", 8500))
	p.tension_types = GameConfig.get_array("domains.combat", "tertiary_timeline/tension_types", [
		"PRESSURE_SURGE", "ENVIRONMENT_PULSE", "FORCE_ROUND_ADVANCE"
	]).duplicate()
	_timeline_cache = p
	_timeline_config_version = GameConfig.config_reload_version()

func initialize(start_ms: int, in_rng: DeterministicRNG) -> void:
	current_timeline_ms = start_ms
	scheduled_events.clear()
	rng = in_rng
	event_counter = 0
	scheduled_events.append(_build_next_dispatch_event())
	scheduled_events.append(_build_next_tension_event())

## 时间推进：驱动虚拟时钟前进 delta_ms，两阶段处理——
## 阶段 A 只收集到期事件；阶段 B 在循环外统一重排期（M8/Inv-TL-2：禁止迭代中修改被迭代容器）。
## 新事件 trigger 严格 > now（interval 下限 maxi(1,…)，Inv-TL-1：杜绝 interval=0 同趟再触发死循环）。
func advance_time(delta_ms: int) -> Array[TimelineEventPointDTO]:
	if delta_ms <= 0:
		return []

	current_timeline_ms += delta_ms
	var fired_events: Array[TimelineEventPointDTO] = []
	var pending_events: Array[TimelineEventPointDTO] = []

	# 阶段 A：触发收集（只读遍历 scheduled_events，不改动原容器）
	for evt in scheduled_events:
		if evt.trigger_time_ms <= current_timeline_ms:
			evt.is_processed = true
			fired_events.append(evt)
		else:
			pending_events.append(evt)

	# 阶段 B：分离重排期（新事件严格 > now），追加进 pending
	for evt in fired_events:
		if evt.event_type == TimelineEventType.RANDOM_DISPATCH:
			pending_events.append(_build_next_dispatch_event())
		elif evt.event_type == TimelineEventType.TENSION_PULSE:
			pending_events.append(_build_next_tension_event())

	scheduled_events = pending_events
	return fired_events

## 生成下一随机发放点（返回式；trigger 严格 > current_timeline_ms，M8 收敛：原 _schedule_* 原地 append 改返回式）
func _build_next_dispatch_event() -> TimelineEventPointDTO:
	_ensure_timeline_cache()
	var p := _timeline_cache
	var delta := rng.randi_range(p.dispatch_min_ms, p.dispatch_max_ms) if rng else p.dispatch_min_ms

	event_counter += 1
	var evt := TimelineEventPointDTO.new()
	evt.event_id = "EVT_DISPATCH_%d" % event_counter
	evt.event_type = TimelineEventType.RANDOM_DISPATCH
	evt.trigger_time_ms = current_timeline_ms + delta
	return evt

## 生成下一回内紧张点（返回式；空 tension_types 池回退 PRESSURE_SURGE）
func _build_next_tension_event() -> TimelineEventPointDTO:
	_ensure_timeline_cache()
	var p := _timeline_cache
	var delta := rng.randi_range(p.tension_min_ms, p.tension_max_ms) if rng else p.tension_min_ms

	var tension_types: Array = p.tension_types
	var pick_idx := rng.randi_range(0, tension_types.size() - 1) if (rng and not tension_types.is_empty()) else 0
	var selected_type: String = tension_types[pick_idx] if not tension_types.is_empty() else "PRESSURE_SURGE"

	event_counter += 1
	var evt := TimelineEventPointDTO.new()
	evt.event_id = "EVT_TENSION_%d" % event_counter
	evt.event_type = TimelineEventType.TENSION_PULSE
	evt.trigger_time_ms = current_timeline_ms + delta
	evt.payload = { "tension_type": selected_type }
	return evt
