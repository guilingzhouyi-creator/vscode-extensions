# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 编排世界栏生命周期跃迁、单机/联机模式路由、拦截直接跳界与全域事件发布
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name WorldGatewayFSM
extends RefCounted

const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")

var context: WorldGatewayContextDTO = null

func _init(account_id: String) -> void:
	context = WorldGatewayContextDTO.new()
	context.account_id = account_id
	context.current_phase = WorldGatewayModel.GatewayPhase.AUTHENTICATED

## 1. 登录后进入世界栏
func enter_gateway() -> Dictionary:
	if context.current_phase != WorldGatewayModel.GatewayPhase.AUTHENTICATED:
		return _fail("INVALID_TRANSITION", "当前状态不可重复进入网关: %d" % context.current_phase)

	context.current_phase = WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED
	var modes: Array = GameConfig.get_array("domains.world_gateway", "gateway_modes/available_modes", [
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		WorldGatewayModel.GameMode.MULTIPLAYER
	])
	var gw_hooks: Dictionary = GameConfig.get_dict("domains.world_gateway", "gateway_hooks", {})
	_notify_event("world_gateway.entered", {
		"account_id": context.account_id,
		"available_modes": modes,
		"configured_hooks": gw_hooks.get("on_gateway_entered", [])
	})
	return {"success": true, "phase": context.current_phase, "context": context.to_dto(), "available_modes": modes}

## 2. 选择游戏模式与解析档位世界（支持显式指定 target_world_id 与 target_slot_id）
func select_mode(
	mode: int,
	canary_flags: Dictionary = {},
	account_slots: Array = [],
	target_world_id: String = "",
	target_slot_id: String = ""
) -> Dictionary:
	if context.current_phase != WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED:
		return _fail("INVALID_TRANSITION", "未处于世界栏主界面，当前阶段: %d" % context.current_phase)
	var slot_conversion: Dictionary = _convert_account_slots(account_slots)
	if not bool(slot_conversion.get("success", false)):
		return _fail(String(slot_conversion.get("error_code", "INVALID_ACCOUNT_SLOTS")), "账号槽位数据无效")

	var all_worlds := _load_worlds_catalog()
	var route_res := GameModeRoutingSolver.resolve_mode_entry(
		context.account_id, mode, all_worlds, slot_conversion["slots"], canary_flags, target_world_id, target_slot_id
	)

	if not route_res.success:
		return _fail(route_res.error_code, route_res.message)
	var primary_slot: SaveSlotStateDTO = _pick_target_slot(route_res.available_slots, target_slot_id)
	if primary_slot == null:
		return _fail("GATEWAY_ERR_SLOT_NOT_FOUND", "指定档位不存在: %s" % target_slot_id)

	context.selected_mode = mode
	context.selected_world_id = route_res.resolved_world.world_id
	context.current_phase = WorldGatewayModel.GatewayPhase.MODE_SELECTED

	context.selected_slot_id = primary_slot.slot_id
	context.is_first_time_creation = (primary_slot.bound_character_id.is_empty() or primary_slot.is_first_creation)

	# 若为新开档或角色未就绪，流转至待创角/选角阶段
	if context.is_first_time_creation:
		context.current_phase = WorldGatewayModel.GatewayPhase.CHARACTER_PENDING
	else:
		context.active_character_id = primary_slot.bound_character_id
		context.current_phase = WorldGatewayModel.GatewayPhase.SLOT_WORLD_RESOLVED

	var gw_hooks: Dictionary = GameConfig.get_dict("domains.world_gateway", "gateway_hooks", {})
	_notify_event("world_gateway.mode_selected", {
		"account_id": context.account_id,
		"mode": mode,
		"world_id": context.selected_world_id,
		"slot_id": context.selected_slot_id,
		"requires_creation": context.is_first_time_creation,
		"configured_hooks": gw_hooks.get("on_mode_selected", []),
		"phase": context.current_phase
	})

	return {"success": true, "context": context.to_dto(), "route_result": route_res}

func select_mode_for_account(
	mode: int,
	account: AccountProfileAggregate,
	canary_flags: Dictionary = {},
	target_world_id: String = "",
	target_slot_id: String = ""
) -> Dictionary:
	if account == null or account.account_id != context.account_id:
		return _fail("INVALID_ACCOUNT", "账号与网关会话不匹配")
	var effective_world_id: String = target_world_id
	if effective_world_id.is_empty() and not account.world_state_ref.is_empty():
		effective_world_id = account.world_state_ref
	var account_slots: Array = AccountSlotBindingSolver.to_gateway_slot_states(account, effective_world_id)
	return select_mode(mode, canary_flags, account_slots, effective_world_id, target_slot_id)

func _convert_account_slots(account_slots: Array) -> Dictionary:
	var converted: Array[SaveSlotStateDTO] = []
	var seen_slots: Dictionary = {}
	for item in account_slots:
		var slot: SaveSlotStateDTO = null
		if item is SaveSlotStateDTO:
			slot = item
		elif item is Dictionary:
			slot = SaveSlotStateDTO.from_dto(item as Dictionary)
		else:
			return {"success": false, "error_code": "INVALID_ACCOUNT_SLOT_TYPE"}
		if slot.slot_id.is_empty() or seen_slots.has(slot.slot_id):
			return {"success": false, "error_code": "EMPTY_OR_DUPLICATE_ACCOUNT_SLOT"}
		seen_slots[slot.slot_id] = true
		converted.append(slot)
	return {"success": true, "slots": converted}

func _pick_target_slot(slots: Array, target_slot_id: String) -> SaveSlotStateDTO:
	if not target_slot_id.is_empty():
		for item in slots:
			if item is SaveSlotStateDTO and item.slot_id == target_slot_id:
				return item
		return null
	if slots.is_empty():
		return null
	return slots[0] as SaveSlotStateDTO

## 3. 关联就绪角色（创角完成或选角完成调用）
func attach_ready_character(character_id: String) -> Dictionary:
	if context.current_phase != WorldGatewayModel.GatewayPhase.CHARACTER_PENDING and context.current_phase != WorldGatewayModel.GatewayPhase.SLOT_WORLD_RESOLVED:
		return _fail("INVALID_TRANSITION", "当前状态非待就绪角色态，当前阶段: %d" % context.current_phase)

	if character_id.is_empty():
		return _fail("EMPTY_CHARACTER_ID", "挂载的角色标识不能为空")

	context.active_character_id = character_id
	context.current_phase = WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED

	_notify_event("world_gateway.ready_for_entry", {
		"account_id": context.account_id,
		"character_id": character_id,
		"world_id": context.selected_world_id,
		"slot_id": context.selected_slot_id
	})
	return {"success": true, "phase": context.current_phase, "context": context.to_dto()}

## 4. 正式进入具体游戏世界
func enter_world() -> Dictionary:
	var allow_bypass: bool = GameConfig.get_bool("domains.world_gateway", "gateway_policy/allow_direct_world_bypass", false)
	if not allow_bypass and context.current_phase != WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED:
		return _fail("DIRECT_WORLD_BYPASS_BLOCKED", "禁止绕过世界网关直接进入世界，当前阶段: %d" % context.current_phase)

	context.current_phase = WorldGatewayModel.GatewayPhase.IN_WORLD
	_notify_event("world_gateway.world_entered", {
		"account_id": context.account_id,
		"world_id": context.selected_world_id,
		"slot_id": context.selected_slot_id,
		"character_id": context.active_character_id
	})
	return {"success": true, "phase": context.current_phase, "context": context.to_dto()}

func _notify_event(channel: String, payload: Dictionary) -> void:
	# 统一经 EventBus.emit_domain_event 官方唯一入口广播（先发 domain_event 结构化信号，
	# 再按文案表渲染叙事文案二次广播），禁止裸 emit_signal 绕行。
	EventBusCore.get_instance().emit_domain_event(channel, payload)

func _fail(code: String, msg: String) -> Dictionary:
	return {"success": false, "error_code": code, "message": msg, "context": context.to_dto()}

func _load_worlds_catalog() -> Dictionary:
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	var catalog: Dictionary = {}
	for wid in raw_catalog.keys():
		catalog[wid] = WorldInstanceDTO.from_dto(raw_catalog[wid], wid)
	return catalog
