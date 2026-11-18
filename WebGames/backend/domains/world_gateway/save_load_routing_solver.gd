# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/save_load_routing_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, persistence_protocol, character_creation, world_state, lifecycle | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 求解二次载入双通道流向（边界 A 序章重放重初始化 vs 边界 B 成熟存档直载），提供占位符世界槽位校验与 ESC 停机串联。
# 退出语义与设计依据: 业务域第一性原理 / 二次载入与双通道路由契约规范
# ==============================================================================

## SaveLoadRoutingSolver：Headless Discrete Solver / Numerical Calculator
class_name SaveLoadRoutingSolver
extends RefCounted

const ENTRY_PATH_PROLOGUE_REPLAY: int = 1
const ENTRY_PATH_DIRECT_RESTORE: int = 2

## 二次载入路径判定纯函数：边界 A（序章重放重初始化）与边界 B（成熟存档直载）精准分流
static func evaluate_entry_path(slot: SaveSlotDTO) -> int:
	if slot == null:
		return ENTRY_PATH_PROLOGUE_REPLAY
	if not slot.prologue_completed:
		return ENTRY_PATH_PROLOGUE_REPLAY
	if slot.play_time_seconds <= 0 or slot.is_fallen:
		return ENTRY_PATH_PROLOGUE_REPLAY
	return ENTRY_PATH_DIRECT_RESTORE

## 世界槽位与占位符防御校验
static func validate_world_slot(account: AccountProfile, world_id: String) -> Dictionary:
	if world_id.is_empty():
		return {"success": false, "error_code": "UNBOUND_WORLD_ID", "message": "Target world slot not specified"}
	if account != null and account.is_world_slot_placeholder(world_id):
		return {"success": false, "error_code": "UNBOUND_WORLD_SLOT", "message": "Target world slot is unbound or in placeholder state"}
	return {"success": true, "world_id": world_id}

## 执行边界 A：序章重放与初始生理/货币重新派发（严格走活跃 MOD 因果 DAG，无 Kalar 默认回退）
static func _execute_prologue_replay_branch(
	account: AccountProfile,
	slot: SaveSlotDTO,
	context: Dictionary,
	adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
	slot.prologue_completed = false
	var manifest: Dictionary = adapted_mod_manifest
	if manifest.is_empty() and context.get("adapted_mod_manifest") is Dictionary:
		manifest = (context.get("adapted_mod_manifest") as Dictionary)
	var opening_stream: OpeningEventStreamDTO = context.get("opening_stream", null)
	if opening_stream == null:
		opening_stream = OpeningEventStreamDTO.new()
		opening_stream.account_id = account.account_id
		opening_stream.character_id = slot.character_name.sha256_text().substr(0, 16)
		opening_stream.character_name = slot.character_name
		opening_stream.starting_location_id = slot.current_location_name if not slot.current_location_name.is_empty() else str(context.get("starting_location_id", ""))
		opening_stream.opening_quest_line_id = str(context.get("opening_quest_line_id", ""))
		opening_stream.race_id = str(context.get("race_id", _infer_first_manifest_race(manifest)))

	var boot_result := PrologueExecutionKernel.boot_character_prologue(opening_stream, opening_stream.race_id, manifest)
	if not bool(boot_result.get("success", false)):
		return boot_result

	return {
		"success": true,
		"entry_path": ENTRY_PATH_PROLOGUE_REPLAY,
		"replayed": true,
		"slot_id": slot.slot_id,
		"prologue_context": boot_result.get("context", null),
		"event_packet": boot_result.get("packet", null),
		"dag_session": boot_result.get("dag_session", null),
		"starter_kit": boot_result.get("kit", {})
	}


static func _infer_first_manifest_race(manifest: Dictionary) -> String:
	var races: Variant = manifest.get("races_catalog", {})
	if races is Dictionary and not (races as Dictionary).is_empty():
		return str((races as Dictionary).keys()[0])
	var origins: Variant = manifest.get("origins_catalog", {})
	if origins is Dictionary and not (origins as Dictionary).is_empty():
		var first_origin: Variant = (origins as Dictionary).values()[0]
		if first_origin is Dictionary:
			return str((first_origin as Dictionary).get("race_id", (first_origin as Dictionary).get("race", "")))
	return ""


## 执行边界 B：成熟物理存档反装配与各业务域状态恢复
static func _execute_direct_restore_branch(slot: SaveSlotDTO) -> Dictionary:
	var load_result := SaveDataAccessLayer.load_game(slot.slot_id)
	var applied_domains: Dictionary = {}
	var has_physical_save := bool(load_result.get("success", false))

	if has_physical_save and load_result.get("data", null) is Dictionary:
		var save_payload: Dictionary = load_result["data"]
		applied_domains = SaveDataAccessLayer.apply_save_data(save_payload)

	return {
		"success": true,
		"entry_path": ENTRY_PATH_DIRECT_RESTORE,
		"replayed": false,
		"slot_id": slot.slot_id,
		"physical_save_loaded": has_physical_save,
		"applied_domains": applied_domains
	}


## 按世界 MOD 锁还原运行时覆盖层与适配清单（Fail-Closed 防缺包/坏档）
static func _restore_world_mod_context(world_id: String, context: Dictionary) -> Dictionary:
	var installed_packages := ModPackageDiscoverySolver.scan_installed_full_mod_packages()
	var affinity_manager := WorldModAffinityManager.new()
	var diagnostic := affinity_manager.diagnose_world_mods(world_id, installed_packages)
	var has_lock_file := bool(diagnostic.get("has_lock_file", false))
	var context_manifest: Variant = context.get("adapted_mod_manifest")

	if has_lock_file:
		var digest_drifts: Array = diagnostic.get("digest_drifts", [])
		if not digest_drifts.is_empty():
			return {
				"success": false,
				"error_code": "MOD_ERR_REALM_DIGEST_MISMATCH",
				"digest_drifts": digest_drifts,
				"message": "World MOD content digest mismatch detected during secondary world load."
			}
		var missing_packs: Array = diagnostic.get("missing_packs", [])
		if not missing_packs.is_empty():
			return {"success": false, "error_code": "ERR_MISSING_CRITICAL_MOD", "missing_packs": missing_packs}

	if context_manifest is Dictionary and not (context_manifest as Dictionary).is_empty():
		return {"success": true, "adapted_manifest": context_manifest}

	if installed_packages.is_empty():
		return {"success": false, "error_code": "ERR_NO_BASE_CONTENT_MOD", "message": "No content MODs installed for secondary world load."}

	var target_pack_ids: Array = ["*"]
	if has_lock_file:
		var locked_ids: Array = (diagnostic.get("locked_pack_ids", []) as Array).duplicate()
		if not locked_ids.is_empty():
			target_pack_ids = locked_ids

	var adapted_result := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(installed_packages, target_pack_ids)
	if not bool(adapted_result.get("success", false)):
		return adapted_result

	var enabled_packages := _filter_enabled_packages(installed_packages, adapted_result.get("enabled_pack_ids", []))
	var integrity_failure := _find_enabled_package_integrity_failure(enabled_packages)
	if not integrity_failure.is_empty():
		return integrity_failure
	Tier3ContentOverrideLoader.apply_enabled_packages(enabled_packages)
	return adapted_result


static func _find_enabled_package_integrity_failure(enabled_packages: Array) -> Dictionary:
	for package_entry in enabled_packages:
		var integrity_outcome := ModPackageDiscoverySolver.verify_package_content_integrity(package_entry)
		if not bool(integrity_outcome.get("valid", true)):
			return {
				"success": false,
				"error_code": "MOD_ERR_REALM_DIGEST_MISMATCH",
				"digest_drifts": [{
					"pack_id": String(integrity_outcome.get("pack_id", "")),
					"locked": String(integrity_outcome.get("declared_content_sha256", "")),
					"installed": String(integrity_outcome.get("computed_content_sha256", ""))
				}],
				"message": "Enabled MOD package failed content digest integrity check."
			}
	return {}


static func _filter_enabled_packages(installed_packages: Array, enabled_ids: Array) -> Array:
	var enabled_packages: Array = []
	for pkg in installed_packages:
		if pkg is Dictionary and enabled_ids.has(str((pkg as Dictionary).get("pack_id", ""))):
			enabled_packages.append(pkg)
	return enabled_packages


## 二次载入总调度引擎
static func execute_secondary_load(context: Dictionary) -> Dictionary:
	var account: AccountProfile = context.get("account", null)
	var slot: SaveSlotDTO = context.get("slot", null)
	var target_world_id: String = String(context.get("target_world_id", ""))

	if account == null:
		return {"success": false, "error_code": "ERR_ACCOUNT_MISSING", "message": "Account aggregate root missing"}
	if slot == null:
		return {"success": false, "error_code": "ERR_SLOT_MISSING", "message": "Target save slot summary missing"}

	var world_validation := validate_world_slot(account, target_world_id)
	if not bool(world_validation.get("success", false)):
		return world_validation
	var effective_world_id: String = world_validation["world_id"]

	var mod_restore_result := _restore_world_mod_context(effective_world_id, context)
	if not bool(mod_restore_result.get("success", false)):
		return mod_restore_result
	var adapted_mod_manifest: Dictionary = mod_restore_result.get("adapted_manifest", {})

	var entry_path_type: int = evaluate_entry_path(slot)
	var load_result: Dictionary = {}

	if entry_path_type == ENTRY_PATH_PROLOGUE_REPLAY:
		load_result = _execute_prologue_replay_branch(account, slot, context, adapted_mod_manifest)
	else:
		load_result = _execute_direct_restore_branch(slot)

	load_result["effective_world_id"] = effective_world_id
	load_result["adapted_mod_manifest"] = adapted_mod_manifest
	return load_result

## HUD 汇聚同步：无论是序章重放还是成熟直载，统一生成并广播主页权威快照
static func synchronize_hud_entry(
	account: AccountProfile,
	slot: SaveSlotDTO,
	physiology: CharacterPhysiologySheet = null,
	wallet: CharacterWalletEntity = null
) -> AuthoritativeHudSnapshotDTO:
	var character_id := slot.character_name.sha256_text().substr(0, 16)
	var race_id := ""
	if physiology != null and not physiology.race_id.is_empty():
		race_id = physiology.race_id

	return AuthoritativeHudSyncService.trigger_initial_sync({
		"account_id": account.account_id,
		"character_id": character_id,
		"character_name": slot.character_name,
		"race_id": race_id,
		"physiology": physiology,
		"wallet": wallet,
		"current_location_id": slot.current_location_name
	})

## ESC 呼出菜单项配置获取
static func get_esc_menu_options() -> Array[Dictionary]:
	return [
		{"action": "RESUME", "label_key": "esc.action.resume", "default_text": "Resume Adventure"},
		{"action": "SETTINGS", "label_key": "esc.action.settings", "default_text": "Game Settings"},
		{"action": "SAVE", "label_key": "esc.action.save", "default_text": "Save Current Progress"},
		{"action": "EXIT", "label_key": "esc.action.exit", "default_text": "Save and Exit Game"}
	]

## ESC 菜单确认退出触发优雅停机管线
static func execute_esc_exit(
	slot_id: String,
	providers: Dictionary = {}
) -> GameShutdownDTO.Response:
	var shutdown_request := GameShutdownDTO.Request.new()
	shutdown_request.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	shutdown_request.target_save_slot = slot_id
	shutdown_request.idempotency_key = "ESC_EXIT_" + slot_id + "_" + str(Time.get_ticks_usec())
	return GameLifecycleService.execute_graceful_shutdown(shutdown_request, providers)
