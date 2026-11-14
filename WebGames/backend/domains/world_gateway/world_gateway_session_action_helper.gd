# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界网关集群 (World Gateway Domain))
# 文件路径: res://backend/domains/world_gateway/world_gateway_session_action_helper.gd
# 架构定位: Domain Protocol Action Helper / Session & Archive Actions
# 依赖与触发: 上游: WorldGatewayProtocolHandler | 下游: WorldGatewayFSM, AccountRepository, WorldArchiveRepository, EscMenuBackendService | 配置: config/infrastructure/contracts.json | 信号: 无
# 职责说明: 承接世界网关协议中的网关入站、选档/建档、入界（含序章分流标记）、删档、离界与模式切换动作。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-GATEWAY-AUTH-2)
# ==============================================================================

## WorldGatewaySessionActionHelper：世界网关档案与会话生命周期协议辅助器
class_name WorldGatewaySessionActionHelper
extends RefCounted

const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const ModeReadinessProbe = preload("res://backend/domains/world_gateway/mode_readiness_probe.gd")
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")


## 处理 ENTER_GATEWAY：初始化网关并附带底座内容包就绪探针结果
static func handle_enter_gateway(
    request: ClientRequestEnvelopeDTO,
    active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
    var enter_result: Dictionary = {}
    if active_gateway.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED:
        enter_result = {
            "success": true,
            "context": active_gateway.context.to_dto(),
            "probe_reports": ModeReadinessProbe.probe_all_modes(active_gateway.context.account_id),
            "already_entered": true
        }
    else:
        enter_result = active_gateway.enter_gateway()
    if bool(enter_result.get("success", false)):
        enter_result["worlds"] = active_gateway.list_world_archives()
        var installed_summary := active_gateway.list_installed_mods()
        enter_result["base_content_mod_ready"] = bool(installed_summary.get("has_base_content_mod", false))
        enter_result["active_base_pack_id"] = resolve_active_base_pack_id(installed_summary, active_gateway.active_mods)
    return UnifiedProtocolFactory.create_response(
        request.request_id, bool(enter_result.get("success", false)), enter_result,
        "" if bool(enter_result.get("success", false)) else String(enter_result.get("error_code", "ERR_ENTER_GATEWAY")),
        String(enter_result.get("message", "Entered world gateway successfully"))
    )


## 处理 SELECT_MODE / SELECT_OR_CREATE_WORLD：创建缺失单机档案并绑定账号槽位与运行模式
static func handle_select_or_create_world(
    request: ClientRequestEnvelopeDTO,
    request_payload: Dictionary,
    active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
    var target_mode: int = int(request_payload.get("target_mode", request_payload.get("mode", WorldGatewayModel.GameMode.SINGLE_PLAYER)))
    var target_world_id := str(request_payload.get("world_id", ""))
    var target_slot_id := str(request_payload.get("slot_id", ""))
    if not target_world_id.is_empty() and bool(request_payload.get("create_if_missing", true)):
        var world_repository := WorldArchiveRepository.get_instance()
        if world_repository != null and not world_repository.has_world(target_world_id):
            world_repository.create_world(target_world_id, str(request_payload.get("world_name", target_world_id)), int(request_payload.get("seed_value", 20261110)))
    var account_repository := AccountRepository.get_instance()
    if account_repository != null and not account_repository.is_loaded():
        account_repository.load_all()
    var account := account_repository.find_by_id(active_gateway.context.account_id) if account_repository != null else null
    var selection_result: Dictionary
    var custom_mods: Array = request_payload.get("custom_mods", []) if request_payload.get("custom_mods") is Array else []
    if account != null:
        if not custom_mods.is_empty():
            active_gateway.set_active_mods(custom_mods)
        selection_result = active_gateway.select_mode_for_account(target_mode, account, request_payload.get("canary_flags", {}), target_world_id, target_slot_id)
    else:
        var fallback_slot := target_slot_id if not target_slot_id.is_empty() else "SLOT_01"
        var slots: Array = [{"slot_id": fallback_slot, "is_first_creation": true, "bound_world_id": target_world_id}]
        selection_result = active_gateway.select_mode(target_mode, request_payload.get("canary_flags", {}), slots, target_world_id, fallback_slot, custom_mods)
    return UnifiedProtocolFactory.create_response(
        request.request_id, bool(selection_result.get("success", false)), selection_result,
        "" if bool(selection_result.get("success", false)) else String(selection_result.get("error_code", "ERR_SELECT_MODE")),
        String(selection_result.get("message", "Gateway mode and slot selected successfully"))
    )


## 处理 ENTER_WORLD：进入世界、拉取权威 HUD 快照并判定序章分流标记
static func handle_enter_world(
    request: ClientRequestEnvelopeDTO,
    request_payload: Dictionary,
    active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
    var enter_world_id := str(request_payload.get("world_id", ""))
    var should_allow_safe_degrade := bool(request_payload.get("allow_safe_degrade", false))
    var enter_world_result := active_gateway.enter_world(enter_world_id, should_allow_safe_degrade)
    var is_enter_world_succeeded := bool(enter_world_result.get("success", false))
    if is_enter_world_succeeded:
        var live_snapshot := WorldSessionRuntimeService.pull_authoritative_hud_snapshot()
        enter_world_result["initial_hud_snapshot"] = live_snapshot.to_dto()
        var active_prologue: Variant = WorldSessionRuntimeService.get_prologue_context()
        var is_prologue_incomplete: bool = (active_prologue is Object and not bool(active_prologue.get("is_completed")))
        enter_world_result["prologue_required"] = is_prologue_incomplete or bool(active_gateway.context.is_first_time_creation)
    return UnifiedProtocolFactory.create_response(
        request.request_id, is_enter_world_succeeded, enter_world_result,
        "" if is_enter_world_succeeded else String(enter_world_result.get("error_code", "ERR_ENTER_WORLD")),
        String(enter_world_result.get("message", "Entered world successfully"))
    )


## 处理 DELETE_WORLD：阻止销毁活跃世界，清理非活跃世界档案
static func handle_delete_world(
    request: ClientRequestEnvelopeDTO,
    request_payload: Dictionary,
    active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
    var delete_world_id := str(request_payload.get("world_id", ""))
    if active_gateway.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD or WorldSessionRuntimeService.has_active_world():
        return UnifiedProtocolFactory.create_response(
            request.request_id, false, {}, "ERR_DELETE_WHILE_ACTIVE", "Cannot delete a world archive while in an active world"
        )
    var archive_repository := WorldArchiveRepository.get_instance()
    var is_delete_succeeded: bool = (archive_repository != null and archive_repository.delete_world(delete_world_id))
    return UnifiedProtocolFactory.create_response(
        request.request_id, is_delete_succeeded, {"world_id": delete_world_id, "deleted": is_delete_succeeded},
        "" if is_delete_succeeded else "ERR_DELETE_WORLD_FAILED",
        "World archive deleted successfully" if is_delete_succeeded else "Failed to delete world archive"
    )


## 处理 EXIT_WORLD_TO_GATEWAY：按需落盘退回网关并释放人工操控租约
static func handle_exit_world_to_gateway(
    request: ClientRequestEnvelopeDTO,
    request_payload: Dictionary,
    active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
    if bool(request_payload.get("auto_save", false)):
        var esc_proxy := ClientRequestEnvelopeDTO.from_dto(request.to_dto())
        esc_proxy.action_type = "ESC_EXIT_TO_GATEWAY"
        return EscMenuBackendService.handle_esc_action(esc_proxy, active_gateway)
    var scrub_result := active_gateway.exit_to_gateway()
    var is_scrub_succeeded := bool(scrub_result.get("success", false))
    if is_scrub_succeeded:
        HumanControlLeaseManager.release_lease()
    return UnifiedProtocolFactory.create_response(
        request.request_id, is_scrub_succeeded, scrub_result,
        "" if is_scrub_succeeded else String(scrub_result.get("error_code", "ERR_EXIT_GATEWAY_FAILED")),
        "Exited world and returned to gateway" if is_scrub_succeeded else String(scrub_result.get("message", "Failed to exit world"))
    )


## 处理 SWITCH_GATEWAY_MODE：安全清洗当前叠层并切换单机/联机运行模式
static func handle_switch_gateway_mode(
    request: ClientRequestEnvelopeDTO,
    request_payload: Dictionary,
    active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
    var new_mode: int = int(request_payload.get("target_mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
    var switch_account_repository := AccountRepository.get_instance()
    if switch_account_repository != null and not switch_account_repository.is_loaded():
        switch_account_repository.load_all()
    var switch_account := switch_account_repository.find_by_id(active_gateway.context.account_id) if switch_account_repository != null else null
    var slots_argument: Array = []
    if switch_account == null:
        var target_slot := str(request_payload.get("slot_id", "SLOT_01"))
        slots_argument = [{"slot_id": target_slot, "is_first_creation": true}]
    else:
        slots_argument = AccountSlotBindingSolver.to_gateway_slot_states(switch_account, str(request_payload.get("world_id", "")))
    var switch_mods: Array = request_payload.get("custom_mods", []) if request_payload.get("custom_mods") is Array else []
    var switch_result := active_gateway.switch_gateway_mode(
        new_mode, request_payload.get("canary_flags", {}), slots_argument,
        str(request_payload.get("world_id", "")), str(request_payload.get("slot_id", "")), switch_mods
    )
    return UnifiedProtocolFactory.create_response(
        request.request_id, bool(switch_result.get("success", false)), switch_result,
        "" if bool(switch_result.get("success", false)) else String(switch_result.get("error_code", "ERR_SWITCH_GATEWAY")),
        String(switch_result.get("message", "Gateway mode switch completed successfully"))
    )


## 解析当前活跃或已安装的底座内容 MOD pack_id
static func resolve_active_base_pack_id(installed_summary: Dictionary, active_mod_list: Array) -> String:
    for entry in active_mod_list:
        if entry is Dictionary and (entry as Dictionary).get("pack_profile", "") in ["OFFICIAL_BASE", "TOTAL_CONVERSION"]:
            return str((entry as Dictionary).get("pack_id", ""))
    var packages: Variant = installed_summary.get("packages", [])
    if packages is Array:
        for pkg in (packages as Array):
            if pkg is Dictionary and bool((pkg as Dictionary).get("is_base_content", false)):
                return str((pkg as Dictionary).get("pack_id", ""))
    return ""
