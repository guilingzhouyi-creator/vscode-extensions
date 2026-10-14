# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/resolvers/world_calendar_environment_resolver.gd
# 架构定位: Environment Resolver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 世界历法与时辰相位解析器，基于旅行历经时辰严密推导天候时相与环境载荷。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldCalendarEnvironmentResolver：Environment Resolver / Numerical Calculator
class_name WorldCalendarEnvironmentResolver
extends RefCounted

const PHASE_DAWN: String = "DAWN"
const PHASE_NOON: String = "NOON"
const PHASE_DUSK: String = "DUSK"
const PHASE_MIDNIGHT: String = "MIDNIGHT"

## 根据累积旅行时辰解析当前日夜相位
## 边界契约：5..11 为 DAWN，11..17 为 NOON，17..21 为 DUSK，其余为 MIDNIGHT
static func resolve_day_phase(travel_hours: int) -> String:
	var normalized_hour: int = posmod(travel_hours, 24)

	if normalized_hour >= 5 and normalized_hour < 11:
		return PHASE_DAWN

	if normalized_hour >= 11 and normalized_hour < 17:
		return PHASE_NOON

	if normalized_hour >= 17 and normalized_hour < 21:
		return PHASE_DUSK

	return PHASE_MIDNIGHT

## 构建并填充标准历法与环境天候状态传输对象
static func resolve_environment(
	years: int,
	months: int,
	days: int,
	travel_hours: int,
	mana_tier: int = 1
) -> WorldCalendarEnvironmentDTO:
	var dto := WorldCalendarEnvironmentDTO.new()
	dto.calendar_years = maxi(0, years)
	dto.calendar_months = maxi(1, months)
	dto.calendar_days = maxi(1, days)
	dto.travel_hours = maxi(0, travel_hours)
	dto.day_phase_key = resolve_day_phase(travel_hours)
	dto.mana_density_tier = maxi(1, mana_tier)
	return dto
