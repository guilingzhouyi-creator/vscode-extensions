# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 编排世界栏生命周期跃迁、单机/联机模式路由、拦截直接跳界与全域事件发布
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldGatewayFSM：Domain FSM / Lifecycle Session Engine
class_name WorldGatewayFSM
extends RefCounted

const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const WorldModAffinityManager = preload("res://backend/domains/narrative_orchestration/world_mod_affinity_manager.gd")
const ModPackageDiscoverySolver = preload("res://backend/domains/narrative_orchestration/mod_package_discovery_solver.gd")
const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const WorldGatewayWorldCatalogHelper = preload("res://backend/domains/world_gateway/world_gateway_world_catalog_helper.gd")

var context: WorldGatewayContextDTO = null
var _last_probe_reports: Dictionary = {}
var active_mods: Array = []
var adapted_mod_manifest: Dictionary = {}
var creation_ui_snapshot: Dictionary = {}

func _init(account_id: String) -> void:
    context = WorldGatewayContextDTO.new()
    context.account_id = account_id
    context.current_phase = WorldGatewayModel.GatewayPhase.AUTHENTICATED
    _last_probe_reports = {}
    active_mods = []
    adapted_mod_manifest = {}
    creation_ui_snapshot = {}

## 设置当前网关激活的模组清单
func set_active_mods(mods: Array) -> void:
    active_mods = mods.duplicate()

## 获取当前网关激活的模组清单
func get_active_mods() -> Array:
    return active_mods

## 获取当前已预检合并的命途MOD清单
func get_adapted_mod_manifest() -> Dictionary:
    return adapted_mod_manifest

## 获取当前已生成的创角UI适配快照
func get_creation_ui_snapshot() -> Dictionary:
    return creation_ui_snapshot

## 单机模式显性MOD预检与多包列表合并配置
func precheck_and_configure_single_player_mods(candidate_packs: Array, enabled_pack_ids: Array = ["*"]) -> Dictionary:
    if context.selected_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        return _fail(
            AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING,
            "Multiplayer mode strictly forbids custom narrative paths and UI extension mods."
        )

    var precheck_result: Dictionary = ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(candidate_packs, enabled_pack_ids)
    if not bool(precheck_result.get("success", false)):
        adapted_mod_manifest.clear()
        creation_ui_snapshot.clear()
        var err_code: String = str(precheck_result.get("error_code", precheck_result.get("error", "ERR_MOD_PRECHECK_FAILED")))
        var fail_dict: Dictionary = precheck_result.duplicate(true)
        fail_dict["success"] = false
        fail_dict["error_code"] = err_code
        fail_dict["error"] = err_code
        if not fail_dict.has("precheck_checklist"):
            fail_dict["precheck_checklist"] = []
        if not fail_dict.has("conflicts"):
            fail_dict["conflicts"] = []
        return fail_dict

    var raw_manifest: Variant = precheck_result.get("adapted_manifest", {})
    adapted_mod_manifest = (raw_manifest as Dictionary).duplicate(true) if raw_manifest is Dictionary else {}
    var raw_ui_snap: Variant = precheck_result.get("creation_ui_snapshot", {})
    creation_ui_snapshot = (raw_ui_snap as Dictionary).duplicate(true) if raw_ui_snap is Dictionary else {}
    var raw_enabled: Variant = precheck_result.get("enabled_pack_ids", [])
    active_mods = (raw_enabled as Array).duplicate(true) if raw_enabled is Array else []

    _notify_event("world_gateway.mods_prechecked", {
        "account_id": context.account_id,
        "enabled_pack_ids": active_mods,
        "precheck_checklist": precheck_result.get("precheck_checklist", [])
    })
    return precheck_result

## 扫描并配置单机模式显性 MOD（三级级联全包扫描与预检适配）
func discover_and_configure_single_player_mods(custom_roots: Array = [], enabled_pack_ids: Array = ["*"]) -> Dictionary:
    if context.selected_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        return _fail(
            AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING,
            "Multiplayer mode strictly forbids custom narrative paths and UI extension mods."
        )
    var candidates: Array[Dictionary] = ModPackageDiscoverySolver.scan_installed_full_mod_packages(custom_roots)
    return precheck_and_configure_single_player_mods(candidates, enabled_pack_ids)

## 强制净化卸载本地第三方模组并回退 Vanilla 原生核心与洗脱内存
func purge_and_fallback_to_vanilla() -> void:
    var cleaned_mods: Array = []
    for m in active_mods:
        if AntiBridgeGuard.is_vanilla_pack(m):
            cleaned_mods.append(m)
    active_mods = cleaned_mods
    adapted_mod_manifest.clear()
    creation_ui_snapshot.clear()
    _notify_event("world_gateway.mods_purged", {
        "account_id": context.account_id,
        "retained_mods": active_mods
    })

## 1. 登录后进入世界栏（并行收集模式就绪探针报告）
func enter_gateway() -> Dictionary:
    if context.current_phase != WorldGatewayModel.GatewayPhase.AUTHENTICATED:
        return _fail(
            "INVALID_TRANSITION",
            "Cannot re-enter world gateway from current phase: {current_phase}.",
            {"current_phase": context.current_phase}
        )

    context.current_phase = WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED

    # 调用 ModeReadinessProbe 收集全域运行模式健康与就绪报告
    _last_probe_reports = ModeReadinessProbe.probe_all_modes(context.account_id)

    var available_modes: Array = GameConfig.get_array("domains.world_gateway", "gateway_modes/available_modes", [
        WorldGatewayModel.GameMode.SINGLE_PLAYER,
        WorldGatewayModel.GameMode.MULTIPLAYER
    ])
    var gateway_hooks: Dictionary = GameConfig.get_dict("domains.world_gateway", "gateway_hooks", {})
    _notify_event("world_gateway.entered", {
        "account_id": context.account_id,
        "available_modes": available_modes,
        "configured_hooks": gateway_hooks.get("on_gateway_entered", []),
        "probe_reports": _last_probe_reports
    })
    return {
        "success": true,
        "phase": context.current_phase,
        "context": context.to_dto(),
        "available_modes": available_modes,
        "probe_reports": _last_probe_reports
    }

## 2. 选择游戏模式与解析档位世界（前置防越权守卫裁定，支持显式 target_world_id 与 target_slot_id）
func select_mode(
    mode: int,
    canary_flags: Dictionary = {},
    account_slots: Array = [],
    target_world_id: String = "",
    target_slot_id: String = "",
    custom_mods: Array = []
) -> Dictionary:
    if not custom_mods.is_empty():
        active_mods = custom_mods.duplicate()

    var guard_res: Dictionary = WorldGatewayWorldCatalogHelper.validate_mode_entry_guards(
        context, mode, active_mods, _last_probe_reports
    )
    if not bool(guard_res.get("allowed", false)):
        return _fail(
            str(guard_res.get("error_code", "SECURITY_ERR_TRANSITION_BLOCKED")),
            str(guard_res.get("message", "Mode transition was blocked by security guard.")),
            guard_res.get("params", {})
        )

    # 若为联机模式，强制卸载本地第三方模组，回退 Vanilla 原生核心并洗脱
    if mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        purge_and_fallback_to_vanilla()

    var slot_conversion: Dictionary = WorldGatewayWorldCatalogHelper.convert_account_slots(account_slots)
    if not bool(slot_conversion.get("success", false)):
        return _fail(
            String(slot_conversion.get("error_code", "INVALID_ACCOUNT_SLOTS")),
            "Account slot configuration is invalid."
        )

    var worlds_catalog := WorldGatewayWorldCatalogHelper.load_worlds_catalog()
    var route_result := GameModeRoutingSolver.resolve_mode_entry(
        context.account_id, mode, worlds_catalog, slot_conversion["slots"], canary_flags, target_world_id, target_slot_id
    )

    if not route_result.success:
        return _fail(route_result.error_code, route_result.message)
    var target_slot_dto: SaveSlotStateDTO = WorldGatewayWorldCatalogHelper.pick_target_slot(route_result.available_slots, target_slot_id)
    if target_slot_dto == null:
        return _fail(
            "GATEWAY_ERR_SLOT_NOT_FOUND",
            "Specified save slot not found: {target_slot_id}.",
            {"target_slot_id": target_slot_id}
        )

    context.selected_mode = mode
    context.selected_world_id = route_result.resolved_world.world_id
    context.current_phase = WorldGatewayModel.GatewayPhase.MODE_SELECTED
    RuntimeModeGate.set_mode(
        RuntimeModeGate.Mode.ONLINE if mode == WorldGatewayModel.GameMode.MULTIPLAYER else RuntimeModeGate.Mode.SINGLE_PLAYER
    )

    context.selected_slot_id = target_slot_dto.slot_id
    context.is_first_time_creation = (target_slot_dto.bound_character_id.is_empty() or target_slot_dto.is_first_creation)

    # 若为新开档或角色未就绪，流转至待创角/选角阶段
    if context.is_first_time_creation:
        context.current_phase = WorldGatewayModel.GatewayPhase.CHARACTER_PENDING
    else:
        context.active_character_id = target_slot_dto.bound_character_id
        context.current_phase = WorldGatewayModel.GatewayPhase.SLOT_WORLD_RESOLVED

    var gateway_hooks_map: Dictionary = GameConfig.get_dict("domains.world_gateway", "gateway_hooks", {})
    _notify_event("world_gateway.mode_selected", {
        "account_id": context.account_id,
        "mode": mode,
        "world_id": context.selected_world_id,
        "slot_id": context.selected_slot_id,
        "requires_creation": context.is_first_time_creation,
        "configured_hooks": gateway_hooks_map.get("on_mode_selected", []),
        "phase": context.current_phase
    })

    return {"success": true, "context": context.to_dto(), "route_result": route_result}

## 根据账户属性与配置决策适配的游戏入口模式
func select_mode_for_account(
    mode: int,
    account: AccountProfileAggregate,
    canary_flags: Dictionary = {},
    target_world_id: String = "",
    target_slot_id: String = ""
) -> Dictionary:
    if account == null or account.account_id != context.account_id:
        return _fail(
            "INVALID_ACCOUNT",
            "Account does not match gateway session: expected {expected_account_id}, got {account_id}.",
            {
                "expected_account_id": context.account_id,
                "account_id": account.account_id if account != null else ""
            }
        )
    var effective_world_id: String = target_world_id
    if effective_world_id.is_empty() and not account.world_state_ref.is_empty():
        effective_world_id = account.world_state_ref
    var account_slots: Array = AccountSlotBindingSolver.to_gateway_slot_states(account, effective_world_id)
    return select_mode(mode, canary_flags, account_slots, effective_world_id, target_slot_id)

## 3. 关联就绪角色（创角完成或选角完成调用）
func attach_ready_character(character_id: String) -> Dictionary:
    if context.current_phase != WorldGatewayModel.GatewayPhase.CHARACTER_PENDING and context.current_phase != WorldGatewayModel.GatewayPhase.SLOT_WORLD_RESOLVED:
        return _fail(
            "INVALID_TRANSITION",
            "Current phase does not permit character attachment; current phase: {current_phase}.",
            {"current_phase": context.current_phase}
        )

    if character_id.is_empty():
        return _fail("EMPTY_CHARACTER_ID", "Character ID cannot be empty.")

    context.active_character_id = character_id
    context.current_phase = WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED

    _notify_event("world_gateway.ready_for_entry", {
        "account_id": context.account_id,
        "character_id": character_id,
        "world_id": context.selected_world_id,
        "slot_id": context.selected_slot_id
    })
    return {"success": true, "phase": context.current_phase, "context": context.to_dto()}

## 4. 正式进入具体游戏世界（校验 MOD 锁文件并同化虚空扰动）
func enter_world(target_world_id: String = "", allow_safe_degrade: bool = false) -> Dictionary:
    var allow_bypass: bool = GameConfig.get_bool("domains.world_gateway", "gateway_policy/allow_direct_world_bypass", false)
    if not allow_bypass and context.current_phase != WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED:
        return _fail(
            "DIRECT_WORLD_BYPASS_BLOCKED",
            "Direct world entry without gateway initialization is blocked; current phase: {current_phase}.",
            {"current_phase": context.current_phase}
        )

    # 联机模式进入前置安全守卫核验与强制净化
    if context.selected_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        var mod_discipline_result := AntiBridgeGuard.validate_mod_realm_discipline(context.selected_mode, active_mods)
        if not bool(mod_discipline_result.get("allowed", false)):
            return _fail(
                str(mod_discipline_result.get("error_code", AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING)),
                str(mod_discipline_result.get("message", "Multiplayer mode strictly forbids custom narrative paths and UI extension mods."))
            )
        purge_and_fallback_to_vanilla()

    var effective_world_id: String = target_world_id if not target_world_id.is_empty() else context.selected_world_id
    if not effective_world_id.is_empty():
        # 1. MOD 锁文件防坏档守卫核验（单机沙盒模式）
        if context.selected_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER or context.selected_mode == WorldGatewayModel.GameMode.UNSELECTED:
            var installed_packs: Array = ModPackageDiscoverySolver.scan_installed_packs()
            var affinity_manager := WorldModAffinityManager.new()
            var verify_result := affinity_manager.verify_and_bind_world_mods(effective_world_id, installed_packs, allow_safe_degrade)
            if not bool(verify_result.get("success", false)):
                return _fail(
                    str(verify_result.get("error", "ERR_MISSING_CRITICAL_MOD")),
                    "Mod lockfile verification failed when entering world '{world_id}': missing critical packs {missing_packs}.",
                    {
                        "world_id": effective_world_id,
                        "missing_packs": verify_result.get("missing_packs", [])
                    }
                )

            # 2. 外部虚空因果扰动同化
            WorldGatewayWorldCatalogHelper.assimilate_perturbations(effective_world_id)
        context.selected_world_id = effective_world_id

    context.current_phase = WorldGatewayModel.GatewayPhase.IN_WORLD
    WorldSessionRuntimeService.activate_world_session({
        "account_id": context.account_id,
        "gateway": self,
        "world_id": context.selected_world_id,
        "slot_id": context.selected_slot_id,
        "character_id": context.active_character_id,
        "game_mode": context.selected_mode
    }, false)
    _notify_event("world_gateway.world_entered", {
        "account_id": context.account_id,
        "world_id": context.selected_world_id,
        "slot_id": context.selected_slot_id,
        "character_id": context.active_character_id
    })
    return {"success": true, "phase": context.current_phase, "context": context.to_dto()}

## 5. 序章向大地图探索无缝交接（水化创角终态，驱动 FSM 跃迁至 WORLD_EXPLORATION 并触发 HUD 初始同步）
func handoff_prologue_to_world_exploration(handoff: PrologueHandoffDTO) -> Dictionary:
    if handoff == null or handoff.character_id.is_empty():
        return _fail(
            "INVALID_HANDOFF",
            "Prologue handoff DTO cannot be null and must specify a valid character_id."
        )

    if not handoff.active_mods.is_empty():
        active_mods = handoff.active_mods.duplicate()
    context.active_character_id = handoff.character_id
    if not handoff.assigned_start_location_id.is_empty():
        context.selected_world_id = handoff.assigned_start_location_id

    var game_loop_stack := GameLoopStateStack.new()
    game_loop_stack.switch_to(GameLoopStateStack.EngineState.WORLD_EXPLORATION, {
        "character_id": handoff.character_id,
        "character_name": handoff.character_name,
        "location_id": handoff.assigned_start_location_id,
        "gold": handoff.initial_gold,
        "race_id": handoff.race_id,
        "origin_id": handoff.origin_id,
        "attributes": handoff.allocated_attributes.duplicate(true),
        "inventory_items": handoff.initial_inventory_items.duplicate(true)
    })

    context.current_phase = WorldGatewayModel.GatewayPhase.IN_WORLD

    var hud_ctx: Dictionary = {
        "account_id": context.account_id,
        "gateway": self,
        "world_id": context.selected_world_id,
        "slot_id": context.selected_slot_id,
        "character_id": handoff.character_id,
        "character_name": handoff.character_name,
        "race_id": handoff.race_id,
        "game_mode": context.selected_mode,
        "wallet_gold": handoff.initial_gold,
        "current_location_id": handoff.assigned_start_location_id,
        "attribute_values": handoff.allocated_attributes.duplicate(true)
    }
    WorldSessionRuntimeService.activate_world_session(hud_ctx, false)
    var snapshot: AuthoritativeHudSnapshotDTO = AuthoritativeHudSyncService.trigger_initial_sync(hud_ctx)

    _notify_event("world_gateway.prologue_handed_off", {
        "account_id": context.account_id,
        "character_id": handoff.character_id,
        "location_id": handoff.assigned_start_location_id,
        "gold": handoff.initial_gold
    })

    return {
        "success": true,
        "phase": context.current_phase,
        "state": game_loop_stack.current_state,
        "snapshot": snapshot,
        "handoff": handoff.to_dto()
    }

## 退出世界回到世界栏主界面（门面方法，等价于 exit_to_gateway）
func exit_world() -> Dictionary:
    return exit_to_gateway()

## 5. 退回世界栏主界面并实施内存全量洗脱 (Full Memory Scrubbing + 探针与模式闸门复位)
func exit_to_gateway() -> Dictionary:
    WorldSessionRuntimeService.deactivate_world_session()
    RuntimeModeGate.set_mode(RuntimeModeGate.Mode.SINGLE_PLAYER)

    # 全量洗脱重置运行时所有模式、槽位、世界与角色状态
    context.selected_mode = WorldGatewayModel.GameMode.UNSELECTED
    context.selected_slot_id = ""
    context.selected_world_id = ""
    context.active_character_id = ""
    context.is_first_time_creation = false
    context.current_phase = WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED
    active_mods.clear()
    adapted_mod_manifest.clear()
    creation_ui_snapshot.clear()

    if GameConfig.get_bool("domains.world_gateway", "gateway_policy/require_probe_refresh_on_exit", true):
        _last_probe_reports = ModeReadinessProbe.probe_all_modes(context.account_id)
    else:
        _last_probe_reports.clear()

    _notify_event("world_gateway.memory_scrubbed", {
        "account_id": context.account_id,
        "phase": context.current_phase,
        "probe_refreshed": not _last_probe_reports.is_empty()
    })

    return {
        "success": true,
        "phase": context.current_phase,
        "context": context.to_dto(),
        "probe_reports": _last_probe_reports,
        "message": "Gateway memory successfully scrubbed and returned to entered state."
    }

## 6. 切换运行网关模式（仅允许已洗脱的 GATEWAY_ENTERED 状态；活跃世界内强拦截热切换）
func switch_gateway_mode(target_mode: int, canary_flags: Dictionary = {}, account_slots: Array = [],
		target_world_id: String = "", target_slot_id: String = "", custom_mods: Array = []) -> Dictionary:
    var is_hot_swap_blocked := GameConfig.get_bool("domains.world_gateway", "gateway_policy/block_hot_swap_while_world_active", true)
    var hot_swap_error_code := GameConfig.get_string("domains.world_gateway", "gateway_policy/err_hot_swap_blocked", "ERR_HOT_SWAP_BLOCKED_IN_ACTIVE_WORLD")
    if is_hot_swap_blocked and (context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD or WorldSessionRuntimeService.has_active_world()):
        return _fail(
            hot_swap_error_code,
            "Hot switching gateway mode is blocked while active world is running."
        )
    if context.current_phase != WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED:
        return _fail(
            hot_swap_error_code,
            "Gateway mode switch requires prior state scrubbing via exit_to_gateway; current phase: {current_phase}.",
            {"current_phase": context.current_phase}
        )

    _last_probe_reports = ModeReadinessProbe.probe_all_modes(context.account_id)
    var selection_result := select_mode(target_mode, canary_flags, account_slots, target_world_id, target_slot_id, custom_mods)
    if bool(selection_result.get("success", false)):
        _notify_event("world_gateway.mode_switched", {
            "account_id": context.account_id,
            "mode": target_mode,
            "world_id": context.selected_world_id,
            "slot_id": context.selected_slot_id
        })
    return selection_result

## 7. 查询当前可用的世界档案与目录摘要列表
func list_world_archives() -> Array[Dictionary]:
    var worlds_catalog := WorldGatewayWorldCatalogHelper.load_worlds_catalog()
    var result: Array[Dictionary] = []
    var registered_world_ids: Dictionary = {}
    var archive_repo := WorldArchiveRepository.get_instance()
    if archive_repo != null:
        if not archive_repo.is_loaded():
            archive_repo.load_all()
        var empty_dto: Dictionary = {}
        for archive_summary in archive_repo.list_worlds():
            var archive_dto_dict: Dictionary = archive_summary.to_dto() if (archive_summary != null and archive_summary.has_method("to_dto")) else empty_dto
            var archive_world_id := String(archive_dto_dict.get("world_id", ""))
            if archive_world_id.is_empty():
                continue
            registered_world_ids[archive_world_id] = true
            result.append(archive_dto_dict)
    for world_id in worlds_catalog.keys():
        if registered_world_ids.has(world_id):
            continue
        var world_instance_dto: Variant = worlds_catalog[world_id]
        result.append(_format_catalog_archive_entry(world_id, world_instance_dto))
    return result

func _format_catalog_archive_entry(world_id: Variant, world_instance_dto: Variant) -> Dictionary:
    if world_instance_dto != null and world_instance_dto.has_method("to_dto"):
        return world_instance_dto.to_dto()
    return {"world_id": world_id}

func _notify_event(channel: String, payload: Dictionary) -> void:
    EventBusCore.get_instance().emit_domain_event(channel, payload)

func _fail(error_code: String, template_message: String, format_params: Dictionary = {}) -> Dictionary:
    var formatted_message: String = TemplateFormatter.format(template_message, format_params) if not format_params.is_empty() else template_message
    var error_context: Dictionary = context.to_dto()
    for key in format_params:
        error_context[str(key)] = format_params[key]
    ErrorReporter.emit_error("world_gateway", error_code, formatted_message, error_context)
    return {
        "success": false,
        "error_code": error_code,
        "error": error_code,
        "message": formatted_message,
        "context": context.to_dto()
    }
