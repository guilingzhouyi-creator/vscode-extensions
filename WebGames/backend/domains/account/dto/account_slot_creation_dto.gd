# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/dto/account_slot_creation_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 封装账号角色槽位创建与封面初始化的参数上下文，消除散落标量参数泥团（GOV-DAT-001）。
# 设计依据: 业务领域第一性原理 / Phase 97 施工细则规范
# ==============================================================================

class_name AccountSlotCreationDTO
extends RefCounted

var account: AccountProfileAggregate = null
var slot_id: String = ""
var character_name: String = ""
var title_prefix: String = ""
var is_permadeath: bool = false
var allow_default_fallback: bool = true

func _init(
	p_account: AccountProfileAggregate = null,
	p_slot_id: String = "",
	p_character_name: String = "",
	p_title_prefix: String = "",
	p_is_permadeath: bool = false,
	p_allow_default_fallback: bool = true
) -> void:
	account = p_account
	slot_id = p_slot_id
	character_name = p_character_name
	title_prefix = p_title_prefix
	is_permadeath = p_is_permadeath
	allow_default_fallback = p_allow_default_fallback
