# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/world_calendar_environment_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 世界历法与环境天候状态传输对象，承载年月历、时辰相位与以太浓度。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name WorldCalendarEnvironmentDTO
extends RefCounted

var calendar_years: int = 0
var calendar_months: int = 1
var calendar_days: int = 1
var travel_hours: int = 0
var day_phase_key: String = "MIDNIGHT"
var mana_density_tier: int = 1

func to_dto() -> Dictionary:
	return {
		"calendar_years": calendar_years,
		"calendar_months": calendar_months,
		"calendar_days": calendar_days,
		"travel_hours": travel_hours,
		"day_phase_key": day_phase_key,
		"mana_density_tier": mana_density_tier
	}

static func from_dto(data: Dictionary) -> WorldCalendarEnvironmentDTO:
	var dto := WorldCalendarEnvironmentDTO.new()
	dto.calendar_years = maxi(0, int(data.get("calendar_years", 0)))
	dto.calendar_months = maxi(1, int(data.get("calendar_months", 1)))
	dto.calendar_days = maxi(1, int(data.get("calendar_days", 1)))
	dto.travel_hours = maxi(0, int(data.get("travel_hours", 0)))
	dto.day_phase_key = String(data.get("day_phase_key", "MIDNIGHT"))
	dto.mana_density_tier = maxi(1, int(data.get("mana_density_tier", 1)))
	return dto
