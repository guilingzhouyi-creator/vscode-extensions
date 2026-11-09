# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/dto/account_slot_creation_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 封装账号角色槽位创建与封面初始化的参数上下文，消除散落标量参数泥团（GOV-DAT-001）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AccountSlotCreationDTO：Value Object DTO / Data Transport Model
class_name AccountSlotCreationDTO
extends RefCounted

var account: AccountProfileAggregate = null
var slot_id: String = ""
var character_name: String = ""
var title_prefix: String = ""
var is_permadeath: bool = false
var allow_default_fallback: bool = true
var provision_disk: bool = false

func _init(init_params: Dictionary = {}) -> void:
	if init_params.is_empty():
		return
	account = init_params.get("account", null)
	slot_id = str(init_params.get("slot_id", ""))
	character_name = str(init_params.get("character_name", ""))
	title_prefix = str(init_params.get("title_prefix", ""))
	is_permadeath = bool(init_params.get("is_permadeath", false))
	allow_default_fallback = bool(init_params.get("allow_default_fallback", true))
	provision_disk = bool(init_params.get("provision_disk", false))
