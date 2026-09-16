# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_mutation_events_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 当角色仅发生单项属性或钱包变动时，避免高频广播完整大快照， 提供精准增量事件流。 取值域契约： - StatMutation.stat_name   -> CharacterPhysiologySheet 六维 attribute 键 - WalletMutation.currency_type -> CharacterWalletEntity.CURRENCY_FIELDS
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name HudMutationEventsDTO
extends RefCounted

## 角色单项属性增量突变
class StatMutation extends RefCounted:
	var character_id: String = ""
	var stat_name: String = ""
	var old_value: float = 0.0
	var new_value: float = 0.0
	var delta: float = 0.0
	var cause_event: String = ""
	var timestamp_utc: int = 0

	func to_dto() -> Dictionary:
		return {
			"character_id": character_id,
			"stat_name": stat_name,
			"old_value": old_value,
			"new_value": new_value,
			"delta": delta,
			"cause_event": cause_event,
			"timestamp_utc": timestamp_utc
		}

## 钱包货币增量突变
class WalletMutation extends RefCounted:
	var account_id: String = ""
	var currency_type: String = "gold"
	var old_amount: int = 0
	var new_amount: int = 0
	var delta: int = 0
	var reason_key: String = ""
	var timestamp_utc: int = 0

	func to_dto() -> Dictionary:
		return {
			"account_id": account_id,
			"currency_type": currency_type,
			"old_amount": old_amount,
			"new_amount": new_amount,
			"delta": delta,
			"reason_key": reason_key,
			"timestamp_utc": timestamp_utc
		}
