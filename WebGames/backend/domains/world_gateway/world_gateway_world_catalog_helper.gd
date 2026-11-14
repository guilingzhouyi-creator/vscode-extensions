# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_world_catalog_helper.gd
# 架构定位: Domain Support Helper / Gateway Guards, Slot Normalization & World Perturbation Assimilation
# 依赖与触发: 上游: WorldGatewayFSM | 下游: AntiBridgeGuard, CrossWorldPerturbationBroker, WorldArchiveRepository, GameConfig | 配置: config/domains/world_gateway.json | 信号: 无
# 职责说明: 为 WorldGatewayFSM 提供模式切换安全守卫预校验、账号存档槽位归一化、世界配置目录加载与虚空扰动片段同化能力。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldGatewayWorldCatalogHelper：Domain Support Helper / Gateway Guards & World Assimilation
class_name WorldGatewayWorldCatalogHelper
extends RefCounted

const CrossWorldPerturbationBroker = preload("res://backend/domains/narrative_orchestration/cross_world_perturbation_broker.gd")


## 执行选择运行模式前的模组纪律与状态机安全守卫联合校验
static func validate_mode_entry_guards(
    context: WorldGatewayContextDTO,
    target_mode: int,
    active_mods: Array,
    last_probe_reports: Dictionary
) -> Dictionary:
    var mode_report: Variant = null
    if target_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
        mode_report = last_probe_reports.get("single_player", null)
    elif target_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
        mode_report = last_probe_reports.get("multiplayer", null)

    var phase_transition_guard: Dictionary = AntiBridgeGuard.validate_mode_transition(
        context.current_phase,
        WorldGatewayModel.GatewayPhase.MODE_SELECTED,
        context.selected_mode,
        target_mode,
        null
    )
    if not bool(phase_transition_guard.get("allowed", false)):
        return {
            "allowed": false,
            "error_code": str(phase_transition_guard.get("error_code", "SECURITY_ERR_TRANSITION_BLOCKED")),
            "message": str(phase_transition_guard.get("message", "Mode transition was blocked by security guard.")),
            "params": {}
        }

    if context.current_phase != WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED:
        return {
            "allowed": false,
            "error_code": "INVALID_TRANSITION",
            "message": "World gateway is not in entered state; current phase: {current_phase}.",
            "params": {"current_phase": context.current_phase}
        }

    var mod_discipline_result: Dictionary = AntiBridgeGuard.validate_mod_realm_discipline(target_mode, active_mods)
    if not bool(mod_discipline_result.get("allowed", false)):
        return {
            "allowed": false,
            "error_code": str(mod_discipline_result.get("error_code", AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING)),
            "message": str(mod_discipline_result.get("message", "Multiplayer mode strictly forbids custom narrative paths and UI extension mods.")),
            "params": {}
        }

    var probe_guard_result: Dictionary = AntiBridgeGuard.validate_mode_transition(
        context.current_phase,
        WorldGatewayModel.GatewayPhase.MODE_SELECTED,
        context.selected_mode,
        target_mode,
        mode_report
    )
    if not bool(probe_guard_result.get("allowed", false)):
        return {
            "allowed": false,
            "error_code": str(probe_guard_result.get("error_code", "SECURITY_ERR_TRANSITION_BLOCKED")),
            "message": str(probe_guard_result.get("message", "Mode transition was blocked by security guard.")),
            "params": {}
        }

    return {"allowed": true}


## 将输入槽位数组统一归一化为严格校验的 SaveSlotStateDTO 列表
static func convert_account_slots(account_slots: Array) -> Dictionary:
    var converted: Array[SaveSlotStateDTO] = []
    var seen_slots: Dictionary = {}
    for raw_slot_entry in account_slots:
        var slot: SaveSlotStateDTO = null
        if raw_slot_entry is SaveSlotStateDTO:
            slot = raw_slot_entry
        elif raw_slot_entry is Dictionary:
            slot = SaveSlotStateDTO.from_dto(raw_slot_entry as Dictionary)
        else:
            return {"success": false, "error_code": "INVALID_ACCOUNT_SLOT_TYPE"}
        if slot.slot_id.is_empty() or seen_slots.has(slot.slot_id):
            return {"success": false, "error_code": "EMPTY_OR_DUPLICATE_ACCOUNT_SLOT"}
        seen_slots[slot.slot_id] = true
        converted.append(slot)
    return {"success": true, "slots": converted}


## 从候选槽位集合中匹配指定槽位（空 ID 回退首槽）
static func pick_target_slot(slots: Array, target_slot_id: String) -> SaveSlotStateDTO:
    if not target_slot_id.is_empty():
        for slot_entry in slots:
            if slot_entry is SaveSlotStateDTO and slot_entry.slot_id == target_slot_id:
                return slot_entry
        return null
    if slots.is_empty():
        return null
    return slots[0] as SaveSlotStateDTO


## 加载 GameConfig 中配置的世界目录映射表
static func load_worlds_catalog() -> Dictionary:
    var raw_worlds_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
    var worlds_catalog: Dictionary = {}
    for world_id in raw_worlds_catalog.keys():
        worlds_catalog[world_id] = WorldInstanceDTO.from_dto(raw_worlds_catalog[world_id], world_id)
    return worlds_catalog


## 拉取并同化外部虚空因果扰动至目标单机世界档案
static func assimilate_perturbations(effective_world_id: String) -> void:
    var perturbation_broker := CrossWorldPerturbationBroker.get_instance()
    if perturbation_broker == null:
        return
    var perturbations: Array[CrossWorldPerturbationDTO] = perturbation_broker.poll_perturbations_for_world(effective_world_id)
    if perturbations.is_empty():
        return
    var archive_repository := WorldArchiveRepository.get_instance()
    if archive_repository == null:
        return
    var world_instance: WorldInstance = archive_repository.load_world(effective_world_id)
    if world_instance == null:
        return

    for perturbation in perturbations:
        _append_single_perturbation_fragment(world_instance, perturbation)
        perturbation_broker.mark_world_visited(perturbation.perturbation_id, effective_world_id)
    archive_repository.save_world(world_instance)


static func _append_single_perturbation_fragment(
    world_instance: WorldInstance,
    perturbation: CrossWorldPerturbationDTO
) -> void:
    var fragment: Dictionary = {
        "event": "VOID_PERTURBATION_ASSIMILATED",
        "type": "VOID_PERTURBATION_ASSIMILATED",
        "perturbation_id": perturbation.perturbation_id,
        "origin_world_id": perturbation.origin_world_id,
        "resonance_intensity": perturbation.resonance_intensity,
        "timestamp_utc": int(Time.get_unix_time_from_system())
    }
    world_instance.append_history_fragment(fragment)
