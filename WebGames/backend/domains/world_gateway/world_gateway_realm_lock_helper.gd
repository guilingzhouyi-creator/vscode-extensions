# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_realm_lock_helper.gd
# 架构定位: Domain Support Helper / Realm MOD Authority & World Lock Sync
# 依赖与触发: 上游: WorldGatewayFSM | 下游: WorldGatewayModHelper, WorldModAffinityManager, Tier3ContentOverrideLoader, AntiBridgeGuard | 配置: config/domains/world_gateway.json | 信号: 无
# 职责说明: 负责联机界域授权清单挂载、非官方第三方模组清洗卸载以及单机世界存档 MOD 锁的一致性核验。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldGatewayRealmLockHelper：联机界域权威挂载、非官方清理与单机档案锁校验器
class_name WorldGatewayRealmLockHelper
extends RefCounted

const WorldGatewayModHelper = preload("res://backend/domains/world_gateway/world_gateway_mod_helper.gd")
const WorldModAffinityManager = preload("res://backend/domains/narrative_orchestration/world_mod_affinity_manager.gd")
const ModPackageDiscoverySolver = preload("res://backend/domains/narrative_orchestration/mod_package_discovery_solver.gd")
const Tier3ContentOverrideLoader = preload("res://backend/domains/narrative_orchestration/tier3_content_override_loader.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")


## 联机权威校验通过后重建本地授权 MOD 描述符并重放 Tier 3 覆盖层
static func mount_authorized_realm_packages(
    gateway_fsm: Variant,
    installed_packages: Array[Dictionary],
    authorized_ids: Array
) -> void:
    WorldGatewayModHelper.clear_fsm_mod_overlays(gateway_fsm)
    if authorized_ids.is_empty():
        return
    var authorized_candidates := WorldGatewayModHelper.collect_enabled_candidate_packages(installed_packages, authorized_ids)
    if authorized_candidates.is_empty():
        return
    var adapt_result := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(authorized_candidates, authorized_ids)
    if not bool(adapt_result.get("success", false)):
        return
    gateway_fsm.adapted_mod_manifest = (adapt_result.get("adapted_manifest", {}) as Dictionary).duplicate(true)
    gateway_fsm.creation_ui_snapshot = (adapt_result.get("creation_ui_snapshot", {}) as Dictionary).duplicate(true)
    var verified_active_descriptors: Array = _build_verified_descriptors(authorized_candidates)
    gateway_fsm.active_mods = verified_active_descriptors if not verified_active_descriptors.is_empty() else (adapt_result.get("enabled_pack_ids", []) as Array).duplicate(true)
    Tier3ContentOverrideLoader.apply_enabled_packages(authorized_candidates)
    WorldSessionRuntimeService.set_active_mod_context(gateway_fsm.active_mods, gateway_fsm.adapted_mod_manifest)


static func _build_verified_descriptors(authorized_candidates: Array) -> Array:
    var verified_active_descriptors: Array = []
    for candidate_pkg in authorized_candidates:
        if candidate_pkg is Dictionary:
            var candidate_map := candidate_pkg as Dictionary
            verified_active_descriptors.append({
                "pack_id": str(candidate_map.get("pack_id", "")),
                "version": str(candidate_map.get("version", "1.0.0")),
                "pack_profile": str(candidate_map.get("pack_profile", "")),
                "is_official": bool(candidate_map.get("is_official", false)),
                "trust_tier": str(candidate_map.get("trust_tier", "")),
                "content_sha256": str(candidate_map.get("content_sha256", ""))
            })
    return verified_active_descriptors


## 清洗并仅保留经哈希核验的官方基础内容包，重放洁净叠层
static func purge_unofficial_mods_and_remount(gateway_fsm: Variant) -> void:
    var installed_packages: Array[Dictionary] = ModPackageDiscoverySolver.scan_installed_full_mod_packages()
    var installed_by_id: Dictionary = WorldGatewayModHelper.index_packages_by_id(installed_packages)
    var retained_mods: Array = []
    var retained_official_ids: Array[String] = []
    for mod_entry in gateway_fsm.active_mods:
        var entry_id := WorldGatewayModHelper.extract_pack_id(mod_entry)
        var verified_entry: Variant = installed_by_id.get(entry_id, mod_entry)
        if AntiBridgeGuard.is_vanilla_pack(verified_entry):
            retained_mods.append(mod_entry)
            if not entry_id.is_empty() and installed_by_id.has(entry_id):
                retained_official_ids.append(entry_id)

    WorldGatewayModHelper.clear_fsm_mod_overlays(gateway_fsm)
    if not retained_official_ids.is_empty():
        mount_authorized_realm_packages(gateway_fsm, installed_packages, retained_official_ids)
    else:
        gateway_fsm.active_mods = retained_mods


## 单机入界前校验并自动复原世界存档锁定的 MOD 集合与摘要一致性
static func ensure_single_player_world_mods_ready(
    gateway_fsm: Variant,
    effective_world_id: String,
    should_allow_safe_degrade: bool,
    selected_mod_pack_ids: Array[String],
    has_explicit_mod_selection: bool
) -> Dictionary:
    var affinity_manager := WorldModAffinityManager.new()
    var installed_packs: Array = ModPackageDiscoverySolver.scan_installed_packs()
    var lock_data := affinity_manager.load_world_mod_lock(effective_world_id)
    var has_lock: bool = bool(lock_data.get("exists", false))

    if gateway_fsm.adapted_mod_manifest.is_empty():
        if has_lock:
            var locked_ids: Array = []
            for locked_entry in lock_data.get("locked_packs", []):
                var locked_id := WorldGatewayModHelper.extract_pack_id(locked_entry)
                if not locked_id.is_empty():
                    locked_ids.append(locked_id)
            if not locked_ids.is_empty():
                gateway_fsm.discover_and_configure_single_player_mods([], locked_ids)
        elif gateway_fsm.active_mods.is_empty():
            var target_selection: Array = selected_mod_pack_ids if has_explicit_mod_selection else ["*"]
            gateway_fsm.discover_and_configure_single_player_mods([], target_selection)

    var selected_pack_records := _collect_selected_pack_records_for_lock(gateway_fsm.active_mods, installed_packs)
    if not has_lock and selected_pack_records.is_empty() and not should_allow_safe_degrade:
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "template_message": "No active base or total-conversion content MOD mounted for world '{world_id}'.",
            "params": {"world_id": effective_world_id}
        }

    var verify_result := affinity_manager.verify_and_bind_world_mods(
        effective_world_id,
        selected_pack_records,
        should_allow_safe_degrade
    )
    if not bool(verify_result.get("success", false)):
        return {
            "success": false,
            "error_code": str(verify_result.get("error", "ERR_MISSING_CRITICAL_MOD")),
            "template_message": "Mod lockfile verification failed when entering world '{world_id}': missing critical packs {missing_packs}.",
            "params": {
                "world_id": effective_world_id,
                "missing_packs": verify_result.get("missing_packs", []),
                "digest_drifts": verify_result.get("digest_drifts", [])
            }
        }
    if selected_pack_records.is_empty() and not should_allow_safe_degrade:
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "template_message": "No active base or total-conversion content MOD mounted for world '{world_id}'.",
            "params": {"world_id": effective_world_id}
        }
    return {"success": true}


static func _collect_selected_pack_records_for_lock(active_mods: Array, installed_packs: Array) -> Array:
    if active_mods.is_empty():
        return []
    var installed_map: Dictionary = {}
    for installed_entry in installed_packs:
        var entry_id := WorldGatewayModHelper.extract_pack_id(installed_entry)
        if not entry_id.is_empty():
            installed_map[entry_id] = installed_entry
    var selected_records: Array = []
    for mod_entry in active_mods:
        var mod_id := WorldGatewayModHelper.extract_pack_id(mod_entry)
        if not mod_id.is_empty() and installed_map.has(mod_id):
            selected_records.append(installed_map[mod_id])
        elif not mod_id.is_empty():
            selected_records.append(mod_entry)
    return selected_records
