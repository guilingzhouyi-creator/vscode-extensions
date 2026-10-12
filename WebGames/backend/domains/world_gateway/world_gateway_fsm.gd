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
const WorldModAffinityManager = preload("res://backend/domains/narrative_orchestration/world_mod_affinity_manager.gd")
const ModPackageDiscoverySolver = preload("res://backend/domains/narrative_orchestration/mod_package_discovery_solver.gd")
const CrossWorldPerturbationBroker = preload("res://backend/domains/narrative_orchestration/cross_world_perturbation_broker.gd")

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
            "联机模式严禁启用自定义命途与UI扩展MOD"
        )

    var res: Dictionary = ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(candidate_packs, enabled_pack_ids)
    if not bool(res.get("success", false)):
        adapted_mod_manifest.clear()
        creation_ui_snapshot.clear()
        var err_code: String = str(res.get("error_code", res.get("error", "ERR_MOD_PRECHECK_FAILED")))
        var fail_dict: Dictionary = res.duplicate(true)
        fail_dict["success"] = false
        fail_dict["error_code"] = err_code
        fail_dict["error"] = err_code
        if not fail_dict.has("precheck_checklist"):
            fail_dict["precheck_checklist"] = []
        if not fail_dict.has("conflicts"):
            fail_dict["conflicts"] = []
        return fail_dict

    var raw_manifest: Variant = res.get("adapted_manifest", {})
    adapted_mod_manifest = (raw_manifest as Dictionary).duplicate(true) if raw_manifest is Dictionary else {}
    var raw_ui_snap: Variant = res.get("creation_ui_snapshot", {})
    creation_ui_snapshot = (raw_ui_snap as Dictionary).duplicate(true) if raw_ui_snap is Dictionary else {}
    var raw_enabled: Variant = res.get("enabled_pack_ids", [])
    active_mods = (raw_enabled as Array).duplicate(true) if raw_enabled is Array else []

    _notify_event("world_gateway.mods_prechecked", {
        "account_id": context.account_id,
        "enabled_pack_ids": active_mods,
        "precheck_checklist": res.get("precheck_checklist", [])
    })
    return res

## 扫描并配置单机模式显性 MOD（三级级联全包扫描与预检适配）
func discover_and_configure_single_player_mods(custom_roots: Array = [], enabled_pack_ids: Array = ["*"]) -> Dictionary:
    if context.selected_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        return _fail(
            AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING,
            "联机模式严禁启用自定义命途与UI扩展MOD"
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
        return _fail("INVALID_TRANSITION", "当前状态不可重复进入网关: %d" % context.current_phase)

    context.current_phase = WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED

    # 调用 ModeReadinessProbe 收集全域运行模式健康与就绪报告
    _last_probe_reports = ModeReadinessProbe.probe_all_modes(context.account_id)

    var modes: Array = GameConfig.get_array("domains.world_gateway", "gateway_modes/available_modes", [
        WorldGatewayModel.GameMode.SINGLE_PLAYER,
        WorldGatewayModel.GameMode.MULTIPLAYER
    ])
    var gw_hooks: Dictionary = GameConfig.get_dict("domains.world_gateway", "gateway_hooks", {})
    _notify_event("world_gateway.entered", {
        "account_id": context.account_id,
        "available_modes": modes,
        "configured_hooks": gw_hooks.get("on_gateway_entered", []),
        "probe_reports": _last_probe_reports
    })
    return {
        "success": true,
        "phase": context.current_phase,
        "context": context.to_dto(),
        "available_modes": modes,
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

    # 模组界域纪律气密守卫裁定（联机模式严禁加载第三方本地剧情/数值 MOD）
    var mod_check := AntiBridgeGuard.validate_mod_realm_discipline(mode, active_mods)
    if not bool(mod_check.get("allowed", false)):
        return _fail(
            str(mod_check.get("error_code", AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING)),
            str(mod_check.get("message", "联机模式严禁加载第三方本地剧情/数值 MOD"))
        )

    # 气密级防越权守卫裁定：检查模式单向冻结（防热切换）与探针就绪报告
    var mode_report: Variant = null
    if mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
        mode_report = _last_probe_reports.get("single_player", null)
    elif mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        mode_report = _last_probe_reports.get("multiplayer", null)

    var guard_res := AntiBridgeGuard.validate_mode_transition(
        context.current_phase,
        WorldGatewayModel.GatewayPhase.MODE_SELECTED,
        context.selected_mode,
        mode,
        mode_report
    )
    if not bool(guard_res.get("allowed", false)):
        return _fail(
            str(guard_res.get("error_code", "SECURITY_ERR_TRANSITION_BLOCKED")),
            str(guard_res.get("message", "模式跃迁被安全守卫拦截"))
        )

    if context.current_phase != WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED:
        return _fail("INVALID_TRANSITION", "未处于世界栏主界面，当前阶段: %d" % context.current_phase)

    # 若为联机模式，强制卸载本地第三方模组，回退 Vanilla 原生核心并洗脱
    if mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        purge_and_fallback_to_vanilla()

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

## 4. 正式进入具体游戏世界（校验 MOD 锁文件并同化虚空扰动）
func enter_world(target_world_id: String = "", allow_safe_degrade: bool = false) -> Dictionary:
    var allow_bypass: bool = GameConfig.get_bool("domains.world_gateway", "gateway_policy/allow_direct_world_bypass", false)
    if not allow_bypass and context.current_phase != WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED:
        return _fail("DIRECT_WORLD_BYPASS_BLOCKED", "禁止绕过世界网关直接进入世界，当前阶段: %d" % context.current_phase)

    # 联机模式进入前置安全守卫核验与强制净化
    if context.selected_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        var mod_check := AntiBridgeGuard.validate_mod_realm_discipline(context.selected_mode, active_mods)
        if not bool(mod_check.get("allowed", false)):
            return _fail(
                str(mod_check.get("error_code", AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING)),
                str(mod_check.get("message", "联机模式严禁加载第三方本地剧情/数值 MOD"))
            )
        purge_and_fallback_to_vanilla()

    var effective_world_id: String = target_world_id if not target_world_id.is_empty() else context.selected_world_id
    if not effective_world_id.is_empty():
        # 1. MOD 锁文件防坏档守卫核验（单机沙盒模式）
        if context.selected_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER or context.selected_mode == WorldGatewayModel.GameMode.UNSELECTED:
            var installed_packs: Array = ModPackageDiscoverySolver.scan_installed_packs()
            var affinity_mgr := WorldModAffinityManager.new()
            var verify_res := affinity_mgr.verify_and_bind_world_mods(effective_world_id, installed_packs, allow_safe_degrade)
            if not bool(verify_res.get("success", false)):
                return _fail(
                    str(verify_res.get("error", "ERR_MISSING_CRITICAL_MOD")),
                    "进入世界时 MOD 锁文件校验失败: %s" % str(verify_res.get("missing_packs", []))
                )

            # 2. 外部虚空因果扰动同化
            _assimilate_perturbations(effective_world_id)
        context.selected_world_id = effective_world_id

    context.current_phase = WorldGatewayModel.GatewayPhase.IN_WORLD
    _notify_event("world_gateway.world_entered", {
        "account_id": context.account_id,
        "world_id": context.selected_world_id,
        "slot_id": context.selected_slot_id,
        "character_id": context.active_character_id
    })
    return {"success": true, "phase": context.current_phase, "context": context.to_dto()}

## 记录单个虚空同化片段至世界历史（独立抽离避免循环内瞬态堆分配）
func _append_single_perturbation_fragment(world_inst: WorldInstance, p: CrossWorldPerturbationDTO) -> void:
    var fragment: Dictionary = {
        "event": "VOID_PERTURBATION_ASSIMILATED",
        "type": "VOID_PERTURBATION_ASSIMILATED",
        "perturbation_id": p.perturbation_id,
        "origin_world_id": p.origin_world_id,
        "resonance_intensity": p.resonance_intensity,
        "timestamp_utc": int(Time.get_unix_time_from_system())
    }
    world_inst.append_history_fragment(fragment)

## 拉取并同化外部虚空因果扰动至目标单机世界
func _assimilate_perturbations(effective_world_id: String) -> void:
    var broker := CrossWorldPerturbationBroker.get_instance()
    if broker == null:
        return
    var perturbations: Array[CrossWorldPerturbationDTO] = broker.poll_perturbations_for_world(effective_world_id)
    if perturbations.is_empty():
        return
    var repo := WorldArchiveRepository.get_instance()
    if repo == null:
        return
    var world_inst: WorldInstance = repo.load_world(effective_world_id)
    if world_inst == null:
        return

    for p in perturbations:
        _append_single_perturbation_fragment(world_inst, p)
        broker.mark_world_visited(p.perturbation_id, effective_world_id)
    repo.save_world(world_inst)

## 5. 退回世界栏主界面并实施内存全量洗脱 (Full Memory Scrubbing)
func exit_to_gateway() -> Dictionary:
    # 全量洗脱重置运行时所有模式、槽位、世界与角色状态
    context.selected_mode = WorldGatewayModel.GameMode.UNSELECTED
    context.selected_slot_id = ""
    context.selected_world_id = ""
    context.active_character_id = ""
    context.is_first_time_creation = false
    context.current_phase = WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED
    _last_probe_reports.clear()
    active_mods.clear()
    adapted_mod_manifest.clear()
    creation_ui_snapshot.clear()

    _notify_event("world_gateway.memory_scrubbed", {
        "account_id": context.account_id,
        "phase": context.current_phase
    })

    return {
        "success": true,
        "phase": context.current_phase,
        "context": context.to_dto(),
        "message": "已完成全量内存洗脱并返回世界网关"
    }

func _notify_event(channel: String, payload: Dictionary) -> void:
    EventBusCore.get_instance().emit_domain_event(channel, payload)

func _fail(code: String, msg: String) -> Dictionary:
    return {"success": false, "error_code": code, "error": code, "message": msg, "context": context.to_dto()}

func _load_worlds_catalog() -> Dictionary:
    var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
    var catalog: Dictionary = {}
    for wid in raw_catalog.keys():
        catalog[wid] = WorldInstanceDTO.from_dto(raw_catalog[wid], wid)
    return catalog
