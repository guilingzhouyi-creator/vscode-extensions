# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 编排世界栏生命周期跃迁、单机/联机模式路由、拦截直接跳界与全域事件发布
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name WorldGatewayFSM
extends RefCounted

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
	_notify_event("world_gateway.entered", {
		"account_id": context.account_id,
		"available_modes": [
			WorldGatewayModel.GameMode.SINGLE_PLAYER,
			WorldGatewayModel.GameMode.MULTIPLAYER
		]
	})
	return { "success": true, "phase": context.current_phase, "context": context.to_dto() }

## 2. 选择游戏模式与解析档位世界
func select_mode(mode: int, canary_flags: Dictionary = {}, account_slots: Array = []) -> Dictionary:
	if context.current_phase != WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED:
		return _fail("INVALID_TRANSITION", "未处于世界栏主界面，当前阶段: %d" % context.current_phase)

	var all_worlds := _load_worlds_catalog()
	var route_res := GameModeRoutingSolver.resolve_mode_entry(
		context.account_id, mode, all_worlds, account_slots, canary_flags
	)

	if not route_res.success:
		return _fail(route_res.error_code, route_res.message)

	context.selected_mode = mode
	context.selected_world_id = route_res.resolved_world.world_id
	context.current_phase = WorldGatewayModel.GatewayPhase.MODE_SELECTED

	var primary_slot: SaveSlotStateDTO = route_res.available_slots[0]
	context.selected_slot_id = primary_slot.slot_id
	context.is_first_time_creation = route_res.requires_character_creation

	# 若为新开档或角色未就绪，流转至待创角/选角阶段
	if route_res.requires_character_creation:
		context.current_phase = WorldGatewayModel.GatewayPhase.CHARACTER_PENDING
	else:
		context.active_character_id = primary_slot.bound_character_id
		context.current_phase = WorldGatewayModel.GatewayPhase.SLOT_WORLD_RESOLVED

	_notify_event("world_gateway.mode_selected", {
		"account_id": context.account_id,
		"mode": mode,
		"world_id": context.selected_world_id,
		"slot_id": context.selected_slot_id,
		"requires_creation": context.is_first_time_creation,
		"phase": context.current_phase
	})

	return { "success": true, "context": context.to_dto(), "route_result": route_res }

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
	return { "success": true, "phase": context.current_phase, "context": context.to_dto() }

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
	return { "success": true, "phase": context.current_phase, "context": context.to_dto() }

func _notify_event(channel: String, payload: Dictionary) -> void:
	# 统一经 EventBus.emit_domain_event 官方唯一入口广播（先发 domain_event 结构化信号，
	# 再按文案表渲染叙事文案二次广播），禁止裸 emit_signal 绕行。
	EventBusCore.get_instance().emit_domain_event(channel, payload)

func _fail(code: String, msg: String) -> Dictionary:
	return { "success": false, "error_code": code, "message": msg, "context": context.to_dto() }

func _load_worlds_catalog() -> Dictionary:
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	var catalog: Dictionary = {}
	for wid in raw_catalog.keys():
		catalog[wid] = WorldInstanceDTO.from_dto(raw_catalog[wid], wid)
	return catalog
