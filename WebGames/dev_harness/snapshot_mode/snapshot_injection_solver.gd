# ==============================================================================
# 模块归属: 测试与工程化工具层 (Dev Harness · 快照测试工程模式)
# 文件路径: res://dev_harness/snapshot_mode/snapshot_injection_solver.gd
# 架构定位: State Hydration Engine / Multi-Anchor Injector
# 跨域依赖: 上游: 测试用例 / 开发者控制台 | 下游: DAL, Lifecycle, WorldState, Bootstrap
# 职责说明: 提供测试快照全域状态水化与生命周期多锚点插桩流转，并在测试完成后实施对称反装配
# 设计依据: 业务域第一性原理 / 快照测试工程化规范
# ==============================================================================
class_name SnapshotInjectionSolver
extends RefCounted

const TestSnapshotBundleDTO = preload("res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd")
const SnapshotEnvironmentGuard = preload("res://dev_harness/snapshot_mode/snapshot_environment_guard.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const SessionFlowContextDTO = preload("res://backend/domains/lifecycle/dto/session_flow_context_dto.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const HudStateSyncService = preload("res://backend/domains/world_state/hud_state_sync_service.gd")
const HudStatusSnapshotDTO = preload("res://backend/domains/world_state/dto/hud_status_snapshot_dto.gd")
const CharacterPhysiologySheet = preload("res://backend/domains/lifecycle_physiology/physiology_entities.gd")
const CharacterWalletEntity = preload("res://backend/domains/currency_economy/currency_entities.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const GameBootstrap = preload("res://backend/infrastructure/game_bootstrap.gd")
const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")

static var _active_context: SessionFlowContextDTO = null
static var _active_wallet: CharacterWalletEntity = null
static var _active_physiology: CharacterPhysiologySheet = null

static func get_active_context() -> SessionFlowContextDTO:
	return _active_context

static func get_active_wallet() -> CharacterWalletEntity:
	return _active_wallet

static func get_active_physiology() -> CharacterPhysiologySheet:
	return _active_physiology

## 全域注入与状态水化入口
static func inject_and_hydrate(snapshot: TestSnapshotBundleDTO, target_stage_key: String = "") -> Dictionary:
	# 1. 环境安全守卫判定（生产构建绝对熔断）
	var env_check := SnapshotEnvironmentGuard.validate_injection_environment()
	if not bool(env_check.get("permitted", false)):
		return {
			"success": false,
			"error_code": env_check.get("error_code", "ERR_TEST_MODE_DISABLED"),
			"message": env_check.get("message", "Test mode disabled in production.")
		}

	if snapshot == null:
		return {
			"success": false,
			"error_code": "ERR_NULL_SNAPSHOT",
			"message": "快照对象不可为空"
		}

	# 2. 基础系统装配就绪
	GameBootstrap.assemble()

	# 3. 构造生理实体与钱包实体
	var physiology := CharacterPhysiologySheet.new()
	physiology.race_id = snapshot.race_id
	var raw_attr = snapshot.attributes
	if raw_attr is Dictionary:
		for k in (raw_attr as Dictionary).keys():
			physiology.attribute_levels[String(k).to_upper()] = int(raw_attr[k])

	var wallet := CharacterWalletEntity.new()
	wallet.copper = int(snapshot.wallet_data.get("copper", 0))
	wallet.silver = int(snapshot.wallet_data.get("silver", 0))
	wallet.gold = int(snapshot.wallet_data.get("gold", 1000))
	wallet.platinum = int(snapshot.wallet_data.get("platinum", 0))
	wallet.mana_monocrystals = int(snapshot.wallet_data.get("mana_monocrystals", 10))

	# 4. 通过 SaveDataAccessLayer 进行全域数据反装配灌溉
	var save_payload := {
		"account": {
			"account_id": snapshot.account_id,
			"username": snapshot.username,
			"active_world_slot": snapshot.world_id,
			"active_slot_id": snapshot.slot_id
		},
		"character_creation": {
			"character_id": snapshot.character_id,
			"character_name": snapshot.character_name,
			"selected_race_id": snapshot.race_id,
			"selected_gender": snapshot.gender,
			"level": snapshot.level,
			"attributes": snapshot.attributes
		},
		"currency_economy": {
			"copper": wallet.copper,
			"silver": wallet.silver,
			"gold": wallet.gold,
			"platinum": wallet.platinum,
			"mana_monocrystals": wallet.mana_monocrystals
		},
		"lifecycle_physiology": {
			"race_id": snapshot.race_id,
			"current_hp": snapshot.physiology_data.get("current_hp", 100),
			"max_hp": snapshot.physiology_data.get("max_hp", 100),
			"current_mp": snapshot.physiology_data.get("current_mp", 50),
			"max_mp": snapshot.physiology_data.get("max_mp", 50),
			"stamina": snapshot.physiology_data.get("stamina", 100),
			"sanity": snapshot.physiology_data.get("sanity", 100),
			"hunger": snapshot.physiology_data.get("hunger", 0),
			"thirst": snapshot.physiology_data.get("thirst", 0),
			"attribute_levels": snapshot.attributes
		},
		"inventory": {
			"items": snapshot.inventory_items
		},
		"world_navigation": {
			"current_location_id": snapshot.location_name,
			"current_location_name": snapshot.location_name,
			"coordinates_x": snapshot.coordinates_x,
			"coordinates_y": snapshot.coordinates_y
		},
		"quest_causality": snapshot.quest_dag_state
	}

	# 合并自定义领域扩展切片
	for ext_k in snapshot.domain_extensions.keys():
		save_payload[ext_k] = snapshot.domain_extensions[ext_k]

	var dal_res := SaveDataAccessLayer.apply_save_data(save_payload)
	var restored_domains: Array = dal_res.get("restored", {}).keys()

	# 5. 会话上下文 SessionFlowContextDTO 池化获取与全量注入
	var ctx := SessionFlowContextDTO.acquire()
	ctx.account_id = snapshot.account_id if not snapshot.account_id.is_empty() else "ACC_DEV_INJECTED"
	ctx.session_token = snapshot.session_token if not snapshot.session_token.is_empty() else "TOK_DEV_INJECTED"
	ctx.username = snapshot.username if not snapshot.username.is_empty() else "DevAdventurer"
	ctx.current_slot_id = snapshot.slot_id if not snapshot.slot_id.is_empty() else "SLOT_01"
	ctx.character_id = snapshot.character_id if not snapshot.character_id.is_empty() else "CHAR_DEV_INJECTED"
	ctx.character_name = snapshot.character_name if not snapshot.character_name.is_empty() else "InjectedHero"
	ctx.race_id = snapshot.race_id
	ctx.gender = snapshot.gender
	ctx.current_world_id = snapshot.world_id

	# 6. 生命周期状态机跃迁推进至 RUNNING 态
	GameLifecycleManager.reset_for_test()
	var fsm = GameLifecycleManager.get_instance()
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	# 7. 主界面 HUD 快照同步汇聚
	var hud_snapshot: HudStatusSnapshotDTO = HudStateSyncService.trigger_initial_world_sync(
		ctx.account_id,
		ctx.character_id,
		ctx.character_name,
		physiology,
		wallet,
		snapshot.location_name,
		snapshot.race_id
	)
	ctx.hud_snapshot = hud_snapshot.to_dto() if hud_snapshot != null else {}
	ctx.physiology_snapshot = snapshot.physiology_data.duplicate(true)
	ctx.wallet_snapshot = snapshot.wallet_data.duplicate(true)
	_active_context = ctx
	_active_wallet = wallet
	_active_physiology = physiology

	# 8. 目标阶段定位与桩位标记
	var effective_stage := target_stage_key if not target_stage_key.is_empty() else snapshot.target_stage_key
	ctx.stage_results["INJECTED_SNAPSHOT"] = {
		"snapshot_id": snapshot.snapshot_id,
		"target_stage_key": effective_stage,
		"timestamp_utc": int(Time.get_unix_time_from_system())
	}
	ctx.current_stage_index = _resolve_stage_index(effective_stage)

	return {
		"success": true,
		"error_code": "OK",
		"session_context": ctx,
		"hud_snapshot": hud_snapshot,
		"target_stage_key": effective_stage,
		"hydrated_domains": restored_domains,
		"physiology_sheet": physiology,
		"wallet_entity": wallet,
		"snapshot_id": snapshot.snapshot_id
	}

## 测试结束后的对称清理与状态复位
static func teardown_snapshot(ctx: SessionFlowContextDTO = null) -> void:
	_active_context = null
	_active_wallet = null
	_active_physiology = null
	AuthService.clear_sessions()
	if ctx != null:
		SessionFlowContextDTO.release(ctx)
	GameLifecycleManager.reset_for_test()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()
	SnapshotEnvironmentGuard.reset_for_test()

## 解析阶段键名对应的阶段序号
static func _resolve_stage_index(stage_key: String) -> int:
	match stage_key:
		"STAGE_01_REGISTER", "STAGE_01", "REGISTER": return 1
		"STAGE_02_INIT_SLOT", "STAGE_02", "INIT_SLOT": return 2
		"STAGE_03_SELECT_WORLD", "STAGE_03", "SELECT_WORLD": return 3
		"STAGE_04_CREATE_CHAR", "STAGE_04", "CREATE_CHAR": return 4
		"STAGE_05_PROLOGUE", "STAGE_05", "PROLOGUE": return 5
		"STAGE_06_HUD_SYNC", "STAGE_06", "HUD_SYNC": return 6
		"STAGE_07_ESC_MENU", "STAGE_07", "ESC_MENU": return 7
		"STAGE_08_EXIT_REQUEST", "STAGE_08", "EXIT_REQUEST": return 8
		"STAGE_09_SAVE_FLUSH", "STAGE_09", "SAVE_FLUSH": return 9
		"STAGE_10_FULL_EXIT", "STAGE_10", "FULL_EXIT": return 10
		_: return 6 # 默认进入主界面 HUD 阶段
