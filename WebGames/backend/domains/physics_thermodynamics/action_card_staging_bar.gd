# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/action_card_staging_bar.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 维护参与者手牌待发栏（Staging Bar）队列、容量上限与满载溢出缓冲机制。 待发栏满载时第三时间轴绝不阻塞，依配置执行 DISCARD_OLDEST 或 CONVERT_AP。 配置由 config/domains/combat.json staging_bar 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ActionCardStagingBar
extends RefCounted

class StagingBarSnapshotDTO extends RefCounted:
	var owner_id: String = ""
	var max_capacity: int = 5
	var card_slots: Array[Dictionary] = []     # 已装载的待发行动卡 DTO 列表
	var is_full: bool = false
	var total_overflow_count: int = 0          # 历史满载溢出次数
	var accumulated_overflow_energy: int = 0   # 溢出转换能量/AP

	## 序列化待发栏快照为字典（卡牌 DTO 列表深拷贝）
	func to_dto() -> Dictionary:
		return {
			"owner_id": owner_id,
			"max_capacity": max_capacity,
			"card_slots": card_slots.duplicate(true),
			"is_full": is_full,
			"total_overflow_count": total_overflow_count,
			"accumulated_overflow_energy": accumulated_overflow_energy,
		}

var owner_id: String = ""
var max_capacity: int = 5
var cards: Array[PhysicalVerbRegistry.CombatActionCardEntity] = []
var total_overflow_count: int = 0
var accumulated_overflow_energy: int = 0

## 初始化待发栏：属主/容量（配置兜底）/清空统计
func initialize(in_owner_id: String, capacity: int = -1) -> void:
	owner_id = in_owner_id
	if capacity > 0:
		max_capacity = capacity
	else:
		max_capacity = GameConfig.get_int("domains.combat", "staging_bar/max_capacity", 5)
	cards.clear()
	total_overflow_count = 0
	accumulated_overflow_energy = 0

## 将抽取到的卡牌推入待发栏（满载时执行配置策略，绝不阻塞时间轴流逝）
func enqueue_card(card: PhysicalVerbRegistry.CombatActionCardEntity) -> Dictionary:
	if card == null:
		return {"success": false, "reason": "NULL_CARD"}

	var overflow_policy := GameConfig.get_string("domains.combat", "staging_bar/overflow_policy", "DISCARD_OLDEST")
	var was_full := cards.size() >= max_capacity

	if was_full:
		total_overflow_count += 1
		match overflow_policy:
			"DISCARD_OLDEST":
				var discarded := cards.pop_front() as PhysicalVerbRegistry.CombatActionCardEntity
				cards.append(card)
				return {
					"success": true,
					"action": "OVERFLOW_DISCARD_OLDEST",
					"discarded_card_id": discarded.card_id if discarded else "",
					"inserted_card_id": card.card_id
				}
			"CONVERT_AP":
				var bonus_ap := GameConfig.get_int("domains.combat", "staging_bar/overflow_ap_bonus", 1)
				accumulated_overflow_energy += bonus_ap
				return {
					"success": true,
					"action": "OVERFLOW_CONVERT_AP",
					"bonus_ap": bonus_ap,
					"rejected_card_id": card.card_id
				}
			_:
				return {
					"success": false,
					"action": "OVERFLOW_REJECTED",
					"rejected_card_id": card.card_id
				}

	cards.append(card)
	return {"success": true, "action": "ENQUEUED", "card_id": card.card_id}

## 消耗/打出手牌
func pop_card(card_id: String) -> PhysicalVerbRegistry.CombatActionCardEntity:
	for i in range(cards.size()):
		if cards[i].card_id == card_id:
			var card := cards[i]
			cards.remove_at(i)
			return card
	return null

## 待发栏快照（容量/满载/溢出统计/卡牌列表）
func get_snapshot() -> StagingBarSnapshotDTO:
	var snap := StagingBarSnapshotDTO.new()
	snap.owner_id = owner_id
	snap.max_capacity = max_capacity
	snap.is_full = (cards.size() >= max_capacity)
	snap.total_overflow_count = total_overflow_count
	snap.accumulated_overflow_energy = accumulated_overflow_energy
	for c in cards:
		snap.card_slots.append(c.to_dto())
	return snap
