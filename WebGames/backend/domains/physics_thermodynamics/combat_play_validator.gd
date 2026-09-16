# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_play_validator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 回合抽卡卡牌打出制的出牌前置校验——**手牌持有 + AP 势能轴**双条件。 AP > 0  先攻主动态：可消耗 ap_cost 打出任意手牌； AP < 0  硬直受制态：禁止主动打出消耗 AP 的攻击/魔法卡，仅可打出 被动招架类防御卡（PARRY/BLOCK/INTER，verb 或效果层声明）； AP = 0  均势态：允许（先手判定由 CombatPipelineFSM 既有逻辑处理）。 区间与防御动词集配置化（combat.json ap_axis/guard_verbs），零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatPlayValidator
extends RefCounted

## 出牌校验：hand 为持有手牌（Array[CombatActionCardEntity] 或 id 数组均可），
## current_ap 为参与者当前势能；返回受控失败码或放行。
static func validate_play(
	card: PhysicalVerbRegistry.CombatActionCardEntity,
	hand: Array,
	current_ap: int
) -> Dictionary:
	if card == null or card.card_id.is_empty():
		return {"success": false, "error_code": "CARD_NOT_DEFINED"}
	if not _hand_contains(hand, card.card_id):
		return {"success": false, "error_code": "HAND_NOT_CONTAIN", "card_id": card.card_id}

	var stagger_min := GameConfig.get_int("domains.combat", "ap_axis/stagger_min", -10)
	var guard_verbs: Array = GameConfig.get_array("domains.combat", "guard_verbs", ["PARRY", "BLOCK", "INTER"])
	if current_ap < 0:
		if current_ap < stagger_min:
			return {"success": false, "error_code": "AP_OVERFLOW_BELOW_STAGGER", "ap": current_ap}
		if not _is_guard_card(card, guard_verbs):
			return {
				"success": false,
				"error_code": "AP_INSUFFICIENT_OR_STAGGERED",
				"ap": current_ap,
				"card_id": card.card_id,
			}
	return {"success": true, "card_id": card.card_id, "ap": current_ap}

## 防御类放行判定：物理防御动词 或 效果层声明 guard/defense 的卡
static func _is_guard_card(card: PhysicalVerbRegistry.CombatActionCardEntity, guard_verbs: Array) -> bool:
	if guard_verbs.has(card.verb_type):
		return true
	for effect in card.effects:
		if effect is Dictionary:
			var kind := str(effect.get("kind", ""))
			if kind == "guard" or kind == "defense":
				return true
	return false

static func _hand_contains(hand: Array, card_id: String) -> bool:
	for item in hand:
		if item is PhysicalVerbRegistry.CombatActionCardEntity:
			if item.card_id == card_id:
				return true
		elif str(item) == card_id:
			return true
	return false
