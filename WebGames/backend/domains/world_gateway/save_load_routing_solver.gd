# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/save_load_routing_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, persistence_protocol, character_creation, world_state, lifecycle | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 求解二次载入双轨流向（边界 A 序章重放重初始化 vs 边界 B 成熟存档直载），提供占位符世界槽位校验与 ESC 停机串联。
# 设计依据: 业务域第一性原理 / 二次载入与双轨路由契约规范
# ==============================================================================

class_name SaveLoadRoutingSolver
extends RefCounted

const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const PrologueExecutionKernel = preload("res://backend/domains/character_creation/prologue_execution_kernel.gd")
const OpeningEventStreamDTO = preload("res://backend/domains/character_creation/opening_event_stream_dto.gd")
const HudStateSyncService = preload("res://backend/domains/world_state/hud_state_sync_service.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const CharacterPhysiologySheet = preload("res://backend/domains/lifecycle_physiology/physiology_entities.gd")
const CharacterWalletEntity = preload("res://backend/domains/currency_economy/currency_entities.gd")

const ENTRY_PATH_PROLOGUE_REPLAY: int = 1
const ENTRY_PATH_DIRECT_RESTORE: int = 2

## 二次载入路径判定纯函数：边界 A（序章重放重初始化）与边界 B（成熟存档直载）精准分流
static func evaluate_entry_path(slot: SaveSlotSummaryDTO) -> int:
	if slot == null:
		return ENTRY_PATH_PROLOGUE_REPLAY
	if not slot.prologue_completed:
		return ENTRY_PATH_PROLOGUE_REPLAY
	if slot.play_time_seconds <= 0 or slot.is_fallen:
		return ENTRY_PATH_PROLOGUE_REPLAY
	return ENTRY_PATH_DIRECT_RESTORE

## 世界槽位与占位符防御校验
static func validate_world_slot(account: AccountProfileAggregate, world_id: String, allow_default_fallback: bool = true) -> Dictionary:
	var target_id := world_id
	if target_id.is_empty():
		if not allow_default_fallback:
			return {"success": false, "error_code": "UNBOUND_WORLD_ID", "message": "目标世界槽位未指定"}
		target_id = AccountProfileAggregate.WORLD_DEFAULT_SP_01

	if account != null and account.is_world_slot_placeholder(target_id):
		if not allow_default_fallback:
			return {"success": false, "error_code": "UNBOUND_WORLD_SLOT", "message": "目标世界槽位为未绑定或占位符状态"}
		target_id = AccountProfileAggregate.WORLD_DEFAULT_SP_01

	return {"success": true, "world_id": target_id}

## 执行边界 A：序章重放与初始生理/货币重新派发
static func _execute_prologue_replay_branch(
	account: AccountProfileAggregate,
	slot: SaveSlotSummaryDTO,
	context: Dictionary,
	allow_default_fallback: bool
) -> Dictionary:
	slot.prologue_completed = false
	var opening: OpeningEventStreamDTO = context.get("opening_stream", null)
	if opening == null:
		opening = OpeningEventStreamDTO.new()
		opening.account_id = account.account_id
		opening.character_id = slot.character_name.sha256_text().substr(0, 16)
		opening.character_name = slot.character_name
		opening.starting_location_id = "loc_city_kalar_01"
		opening.opening_quest_line_id = "quest_prologue_01"
		opening.race_id = "HUMAN"

	var boot_res := PrologueExecutionKernel.boot_character_prologue(opening, opening.race_id, allow_default_fallback)
	if not bool(boot_res.get("success", false)):
		return boot_res

	return {
		"success": true,
		"entry_path": ENTRY_PATH_PROLOGUE_REPLAY,
		"replayed": true,
		"slot_id": slot.slot_id,
		"prologue_context": boot_res.get("context", null),
		"event_packet": boot_res.get("packet", null),
		"starter_kit": boot_res.get("kit", {})
	}

## 执行边界 B：成熟物理存档反装配与各业务域状态恢复
static func _execute_direct_restore_branch(slot: SaveSlotSummaryDTO) -> Dictionary:
	var load_res := SaveDataAccessLayer.load_game(slot.slot_id)
	var applied_domains: Dictionary = {}
	var has_physical_save := bool(load_res.get("success", false))

	if has_physical_save and load_res.get("data", null) is Dictionary:
		var save_payload: Dictionary = load_res["data"]
		applied_domains = SaveDataAccessLayer.apply_save_data(save_payload)

	return {
		"success": true,
		"entry_path": ENTRY_PATH_DIRECT_RESTORE,
		"replayed": false,
		"slot_id": slot.slot_id,
		"physical_save_loaded": has_physical_save,
		"applied_domains": applied_domains
	}

## 二次载入总调度引擎
static func execute_secondary_load(context: Dictionary) -> Dictionary:
	var account: AccountProfileAggregate = context.get("account", null)
	var slot: SaveSlotSummaryDTO = context.get("slot", null)
	var target_world_id: String = String(context.get("target_world_id", ""))
	var allow_default_fallback: bool = bool(context.get("allow_default_fallback", true))

	if account == null:
		return {"success": false, "error_code": "ERR_ACCOUNT_MISSING", "message": "账号聚合根缺失"}
	if slot == null:
		return {"success": false, "error_code": "ERR_SLOT_MISSING", "message": "目标存档槽位摘要缺失"}

	var world_val := validate_world_slot(account, target_world_id, allow_default_fallback)
	if not bool(world_val.get("success", false)):
		return world_val
	var effective_world_id: String = world_val["world_id"]

	var path: int = evaluate_entry_path(slot)
	var load_result: Dictionary = {}

	if path == ENTRY_PATH_PROLOGUE_REPLAY:
		load_result = _execute_prologue_replay_branch(account, slot, context, allow_default_fallback)
	else:
		load_result = _execute_direct_restore_branch(slot)

	load_result["effective_world_id"] = effective_world_id
	return load_result

## HUD 汇聚同步：无论是序章重放还是成熟直载，统一生成并广播主页快照
static func synchronize_hud_entry(
	account: AccountProfileAggregate,
	slot: SaveSlotSummaryDTO,
	physiology: CharacterPhysiologySheet = null,
	wallet: CharacterWalletEntity = null
) -> HudStatusSnapshotDTO:
	var char_id := slot.character_name.sha256_text().substr(0, 16)
	var location := slot.current_location_name
	var race_id := ""
	if physiology != null and not physiology.race_id.is_empty():
		race_id = physiology.race_id

	return HudStateSyncService.trigger_initial_world_sync(
		account.account_id,
		char_id,
		slot.character_name,
		physiology,
		wallet,
		location,
		race_id,
		true
	)

## ESC 呼出菜单项配置获取
static func get_esc_menu_options() -> Array[Dictionary]:
	return [
		{"action": "RESUME", "label_key": "esc.action.resume", "default_text": "继续冒险"},
		{"action": "SETTINGS", "label_key": "esc.action.settings", "default_text": "系统设置"},
		{"action": "SAVE", "label_key": "esc.action.save", "default_text": "保存当前进度"},
		{"action": "EXIT", "label_key": "esc.action.exit", "default_text": "保存并退出游戏"}
	]

## ESC 菜单确认退出触发优雅停机管线
static func execute_esc_exit(
	slot_id: String,
	providers: Dictionary = {},
	allow_default_fallback: bool = true
) -> GameShutdownDTO.Response:
	var req := GameShutdownDTO.Request.new()
	req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	req.target_save_slot = slot_id
	req.idempotency_key = "ESC_EXIT_" + slot_id + "_" + str(Time.get_ticks_usec())
	return GameLifecycleService.execute_graceful_shutdown(req, providers, allow_default_fallback)
