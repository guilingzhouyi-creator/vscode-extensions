# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Clock & Timing)
# 文件路径: res://backend/infrastructure/world_clock_master.gd
# 架构定位: Deterministic Clock Master
# 依赖与触发: 上游: CombatCore, QuestCausality, WorldNavigation | 下游: 无 | 配置: config/infrastructure/clock.json | 信号: 游戏虚拟时钟心跳与昼夜更迭信号
# 职责说明: 统一调度微观战斗时钟 (Δt=20ms)、行军探索时钟 (1h) 与生理年轮时钟 (1mo)。 历法常数与事件文案由 config/infrastructure/clock.json、config/narratives/clock.json 驱动。
# 退出语义与设计依据: 确定性虚拟时钟驱动协议
# ==============================================================================

## WorldClockMaster：Deterministic Clock Master
class_name WorldClockMaster extends RefCounted

# ==============================================================================
# 一、时钟状态
# ==============================================================================

var combat_tick: int = 0      # 20ms 微观战斗推进
var travel_hours: int = 0     # 探索与行军时钟 (小时)
var calendar_days: int = 1    # 历法天数
var calendar_months: int = 1  # 历法月数
var calendar_years: int = 1   # 历法年数

var _clock_config_version: int = -1
var _hours_per_day_cached: int = 24
var _days_per_month_cached: int = 30
var _months_per_year_cached: int = 12
var _category_combat_cached: String = "combat"
var _category_travel_cached: String = "travel"
var _category_bio_cached: String = "bio"

func _ensure_clock_cache() -> void:
	var config_version: int = GameConfig.config_reload_version()
	if _clock_config_version == config_version:
		return
	_hours_per_day_cached = maxi(1, GameConfig.get_int("infrastructure.clock", "hours_per_day", 24))
	_days_per_month_cached = maxi(1, GameConfig.get_int("infrastructure.clock", "days_per_month", 30))
	_months_per_year_cached = maxi(1, GameConfig.get_int("infrastructure.clock", "months_per_year", 12))
	_category_combat_cached = EventBusCore.get_category_name("combat")
	_category_travel_cached = EventBusCore.get_category_name("travel")
	_category_bio_cached = EventBusCore.get_category_name("bio")
	_clock_config_version = config_version

# ==============================================================================
# 二、三级时钟推进
# ==============================================================================

## 微观战斗时钟推进（Δt=20ms 刻度），广播 clock/combat_tick 叙事
func tick_combat(delta_ticks: int = 1) -> int:
	combat_tick += delta_ticks
	_ensure_clock_cache()
	var event_bus := EventBusCore.get_instance()
	if event_bus.has_channel_listeners(EventChannelDefinition.WORLD_CLOCK_ADVANCED):
		event_bus.emit_world_clock_advanced(
			_category_combat_cached, combat_tick,
			EventBusCore.render_narrative("clock/combat_tick", [combat_tick, delta_ticks])
		)
	return combat_tick

## 行军探索时钟推进（小时累计→按每日小时数进位天数），广播 clock/travel_calendar 叙事
func advance_travel_hours(hours: int = 1) -> Dictionary:
	_ensure_clock_cache()
	travel_hours += hours
	@warning_ignore("integer_division")
	var days_passed := travel_hours / _hours_per_day_cached
	travel_hours = travel_hours % _hours_per_day_cached

	if days_passed > 0:
		advance_calendar_days(days_passed)

	var status := get_calendar_time_dict()
	var event_bus := EventBusCore.get_instance()
	if event_bus.has_channel_listeners(EventChannelDefinition.WORLD_CLOCK_ADVANCED):
		event_bus.emit_world_clock_advanced(
			_category_travel_cached, calendar_days,
			EventBusCore.render_narrative("clock/travel_calendar", [calendar_years, calendar_months, calendar_days, travel_hours])
		)
	return status

## 历法天数推进（月/年逐级进位）
func advance_calendar_days(days: int) -> void:
	_ensure_clock_cache()
	calendar_days += days
	while calendar_days > _days_per_month_cached:
		calendar_days -= _days_per_month_cached
		calendar_months += 1
		if calendar_months > _months_per_year_cached:
			calendar_months -= _months_per_year_cached
			calendar_years += 1

## 生理年轮时钟推进（月→年进位），广播 clock/bio_epoch 叙事
func advance_calendar_months(months: int = 1) -> Dictionary:
	_ensure_clock_cache()
	calendar_months += months
	while calendar_months > _months_per_year_cached:
		calendar_months -= _months_per_year_cached
		calendar_years += 1
	var status := get_calendar_time_dict()
	var event_bus := EventBusCore.get_instance()
	if event_bus.has_channel_listeners(EventChannelDefinition.WORLD_CLOCK_ADVANCED):
		event_bus.emit_world_clock_advanced(
			_category_bio_cached, calendar_months,
			EventBusCore.render_narrative("clock/bio_epoch", [calendar_years, calendar_months])
		)
	return status

## 当前历法/时钟全量快照（年/月/日/时/战斗刻度）
func get_calendar_time_dict() -> Dictionary:
	return {
		"year": calendar_years,
		"month": calendar_months,
		"day": calendar_days,
		"hour": travel_hours,
		"combat_tick": combat_tick
	}

## 时钟状态序列化（存档持久化用）
func serialize() -> Dictionary:
	return {
		"combat_tick": combat_tick,
		"travel_hours": travel_hours,
		"calendar_days": calendar_days,
		"calendar_months": calendar_months,
		"calendar_years": calendar_years
	}

## 时钟状态反序列化（缺省字段回退默认历法）
func deserialize(serialized_clock: Dictionary) -> void:
	combat_tick = serialized_clock.get("combat_tick", 0)
	travel_hours = serialized_clock.get("travel_hours", 0)
	calendar_days = serialized_clock.get("calendar_days", 1)
	calendar_months = serialized_clock.get("calendar_months", 1)
	calendar_years = serialized_clock.get("calendar_years", 1)

# ==============================================================================
# 三、配置读取（历法常数，clock.json 驱动）
# ==============================================================================

## 每日小时数（infrastructure.clock hours_per_day 配置，下限 1）
func _get_hours_per_day() -> int:
	return maxi(1, GameConfig.get_int("infrastructure.clock", "hours_per_day", 24))

## 每月天数（infrastructure.clock days_per_month 配置，下限 1）
func _get_days_per_month() -> int:
	return maxi(1, GameConfig.get_int("infrastructure.clock", "days_per_month", 30))

## 每年月数（infrastructure.clock months_per_year 配置，下限 1）
func _get_months_per_year() -> int:
	return maxi(1, GameConfig.get_int("infrastructure.clock", "months_per_year", 12))
