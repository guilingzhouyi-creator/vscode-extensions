# ==============================================================================
# 模块归属: 业务领域层 (Domains · 叙事、任务与探索集群 (Narrative & Quests))
# 文件路径: res://backend/domains/commission_quest/commission_acceptance_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: commission_quest | 配置: config/domains/commission_quest.json | 信号: EventBus 领域广播
# 职责说明: 封装委托任务接取与派发的状态机构造上下文，消除多参泥团（GOV-DAT-001）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CommissionAcceptanceDTO：Value Object DTO / Data Transport Model
class_name CommissionAcceptanceDTO
extends RefCounted

var commission_id: String = ""
var character_id: String = ""
var guild_id: String = ""
var accept_time_utc: int = 0
var timeout_duration_sec: int = 0
var metadata: Dictionary = {}

## 构造委托接取数据传输对象。
func _init(
	initial_commission_id: String = "",
	initial_character_id: String = "",
	initial_guild_id: String = "",
	initial_accept_time_utc: int = 0,
	initial_timeout_duration_seconds: int = 0,
	initial_metadata: Dictionary = {}
) -> void:
	commission_id = initial_commission_id
	character_id = initial_character_id
	guild_id = initial_guild_id
	accept_time_utc = initial_accept_time_utc
	timeout_duration_sec = initial_timeout_duration_seconds
	metadata = initial_metadata
