# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_hand_draw_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 承载手牌抽取输入规格与最终裁决结果，解耦数量随机与牌型抽取，支持合法0手牌
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatHandDrawDTO
extends RefCounted

## 手牌抽取输入规格
class HandDrawSpecDTO extends RefCounted:
	var is_first_encounter: bool = false       # 是否为初次遇敌首回合
	var current_round: int = 1                 # 当前小回合编号
	var current_hand_count: int = 0            # 待发栏已有手牌数
	var max_capacity: int = 5                  # 手牌待发栏上限
	var special_modifiers: Array[Dictionary] = [] # 施加于抽牌的特殊影响清单

	func to_dto() -> Dictionary:
		return {
			"is_first_encounter": is_first_encounter,
			"current_round": current_round,
			"current_hand_count": current_hand_count,
			"max_capacity": max_capacity,
			"special_modifiers": special_modifiers.duplicate(true),
		}

## 手牌抽取最终裁决结果
class HandDrawResultDTO extends RefCounted:
	var base_random_count: int = 0             # 基础随机决定的发牌数量
	var modifier_delta: int = 0                # 特殊修正总量 (可为负数)
	var final_draw_count: int = 0              # 最终实际抽牌数量 (合法支持 0)
	var actual_cards: Array = []               # 最终生成的卡牌实体列表 (CombatActionCardEntity)
	var applied_modifiers: Array[String] = []  # 实际生效的特殊影响 ID 列表
	var is_zero_hand_state: bool = false       # 是否进入合法 0 手牌状态

	func to_dto() -> Dictionary:
		var cards_dto: Array = []
		for c in actual_cards:
			if c != null and c.has_method("to_dto"):
				cards_dto.append(c.to_dto())
			elif c != null:
				var c_id: String = str(c.get("card_id")) if c.get("card_id") != null else ""
				var v_type: String = str(c.get("verb_type")) if c.get("verb_type") != null else ""
				cards_dto.append({"card_id": c_id, "verb_type": v_type})
		return {
			"base_random_count": base_random_count,
			"modifier_delta": modifier_delta,
			"final_draw_count": final_draw_count,
			"cards": cards_dto,
			"applied_modifiers": applied_modifiers.duplicate(),
			"is_zero_hand_state": is_zero_hand_state,
		}
