# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/seal_fsm.gd
# 架构定位: Domain FSM / State Advancer (Phase 88 角色归位：apply_/cleanup_ 状态推进，允许实例与注入状态)
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 魔法封印（打出封印行动卡 → 魔法进入封印状态）与魔法解放（释放封印 魔法）。封印行动卡 → 解放行动卡的语义常驻建模为 MagicRuleState 持续 状态（禁复制新卡）。持有对象/时长/可封印数量/重复封印/解放清理/异常 回退/与升格叠加关系均由配置与状态实体承载。 六角色归位（Phase 88）：本文件对调用方注入的 seals 状态执行 apply_ / cleanup_ 推进，属 fsm 语义（《后端逻辑处理标准 v1》存量渐进归位），不再声明为纯求解器。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name SealFsm
extends RefCounted

const SEAL_STATUS_ACTIVE: int = MagicRuleState.StateStatus.ACTIVE

## 封印：seals 为持有者封印清单（holder_id -> {magic_ref -> MagicRuleState}），
## 由调用方持有（可注入内存态/存档态）。配置源 seal_config 来自 magic_rules。
static func apply_seal(
	seals: Dictionary,
	holder_id: String,
	magic_ref: String,
	source_card_id: String,
	seal_config: Dictionary = {}
) -> Dictionary:
	if holder_id.is_empty() or magic_ref.is_empty():
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var max_seals := int(seal_config.get("max_seals_per_holder", 3))
	var allow_repeat := bool(seal_config.get("allow_repeat_seal", false))
	if not allow_repeat:
		var holder_map: Dictionary = seals.get(holder_id, {})
		if holder_map.has(magic_ref):
			var existing: MagicRuleState = holder_map[magic_ref]
			if existing.is_active():
				return {"success": false, "error_code": "ALREADY_SEALED", "magic_ref": magic_ref}
	# 可封印数量上限（仅统计 ACTIVE）
	var active_count := _active_seal_count(seals, holder_id)
	if active_count >= max_seals:
		return {"success": false, "error_code": "SEAL_SLOT_FULL", "max_seals": max_seals}

	var state := MagicRuleState.new()
	state.state_id = UniqueIdGenerator.next_id("SEAL_")
	state.kind = MagicRuleState.StateKind.SEAL
	state.status = MagicRuleState.StateStatus.ACTIVE
	state.holder_id = holder_id
	state.magic_ref = magic_ref
	state.source_card_id = source_card_id
	state.duration_seconds = int(seal_config.get("default_duration_seconds", 0))
	state.remain_seconds = state.duration_seconds
	var holder_map2: Dictionary = seals.get(holder_id, {})
	holder_map2[magic_ref] = state
	seals[holder_id] = holder_map2
	return {"success": true, "state_id": state.state_id, "magic_ref": magic_ref, "holder_id": holder_id}

## 解放：封印状态 → RELEASED（清理）
static func apply_release(seals: Dictionary, holder_id: String, magic_ref: String) -> Dictionary:
	var holder_map: Dictionary = seals.get(holder_id, {})
	if not holder_map.has(magic_ref):
		return {"success": false, "error_code": "NOT_SEALED", "magic_ref": magic_ref}
	var state: MagicRuleState = holder_map[magic_ref]
	if not state.is_active():
		return {"success": false, "error_code": "NOT_SEALED", "magic_ref": magic_ref}
	state.transition_to(MagicRuleState.StateStatus.RELEASED)
	holder_map.erase(magic_ref)
	if holder_map.is_empty():
		seals.erase(holder_id)
	return {"success": true, "released": true, "magic_ref": magic_ref, "holder_id": holder_id}

## 封印状态查询（未封印返回 false）
static func is_sealed(seals: Dictionary, holder_id: String, magic_ref: String) -> bool:
	var holder_map: Dictionary = seals.get(holder_id, {})
	if not holder_map.has(magic_ref):
		return false
	var state: MagicRuleState = holder_map[magic_ref]
	return state.is_active()

## 异常回退：封印打出失败时将本封印状态标记 ROLLED_BACK 并移除（无副作用）
static func rollback_seal(seals: Dictionary, holder_id: String, magic_ref: String) -> void:
	var holder_map: Dictionary = seals.get(holder_id, {})
	if not holder_map.has(magic_ref):
		return
	var state: MagicRuleState = holder_map[magic_ref]
	state.transition_to(MagicRuleState.StateStatus.ROLLED_BACK)
	holder_map.erase(magic_ref)
	if holder_map.is_empty():
		seals.erase(holder_id)

## 超时清扫：remain_seconds > 0 且递减至 0 → EXPIRED 清理（由时钟/回合边界调用）
static func cleanup_expired(seals: Dictionary, holder_id: String) -> int:
	var holder_map: Dictionary = seals.get(holder_id, {})
	var cleaned := 0
	for magic_ref in holder_map.keys():
		var state: MagicRuleState = holder_map[magic_ref]
		if state.duration_seconds > 0:
			state.remain_seconds = maxi(0, state.remain_seconds - 1)
			if state.remain_seconds == 0:
				state.transition_to(MagicRuleState.StateStatus.EXPIRED)
				holder_map.erase(magic_ref)
				cleaned += 1
	if holder_map.is_empty():
		seals.erase(holder_id)
	return cleaned

static func _active_seal_count(seals: Dictionary, holder_id: String) -> int:
	var holder_map: Dictionary = seals.get(holder_id, {})
	var count := 0
	for state in holder_map.values():
		if state is MagicRuleState and state.is_active():
			count += 1
	return count
