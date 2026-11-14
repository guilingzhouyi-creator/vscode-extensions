# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/world_calendar_environment_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 世界历法与环境天候状态传输对象，承载年月历、时辰相位与以太浓度。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldCalendarEnvironmentDTO：Value Object DTO / Data Transport Model
class_name WorldCalendarEnvironmentDTO
extends RefCounted

var calendar_years: int = 0
var calendar_months: int = 1
var calendar_days: int = 1
var travel_hours: int = 0
var day_phase_key: String = "MIDNIGHT"
var mana_density_tier: int = 1

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"calendar_years": calendar_years,
		"calendar_months": calendar_months,
		"calendar_days": calendar_days,
		"travel_hours": travel_hours,
		"day_phase_key": day_phase_key,
		"mana_density_tier": mana_density_tier
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> WorldCalendarEnvironmentDTO:
	var environment := WorldCalendarEnvironmentDTO.new()
	environment.calendar_years = maxi(0, int(serialized_payload.get("calendar_years", 0)))
	environment.calendar_months = maxi(1, int(serialized_payload.get("calendar_months", 1)))
	environment.calendar_days = maxi(1, int(serialized_payload.get("calendar_days", 1)))
	environment.travel_hours = maxi(0, int(serialized_payload.get("travel_hours", 0)))
	environment.day_phase_key = String(serialized_payload.get("day_phase_key", "MIDNIGHT"))
	environment.mana_density_tier = maxi(1, int(serialized_payload.get("mana_density_tier", 1)))
	return environment
