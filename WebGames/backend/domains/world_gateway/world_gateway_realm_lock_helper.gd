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
    var diagnostic_report := affinity_manager.diagnose_world_mods(effective_world_id, installed_packs)
    var has_lock_file: bool = bool(diagnostic_report.get("has_lock_file", false))
    var locked_ids: Array = diagnostic_report.get("locked_pack_ids", [])
    var locked_packs: Array = diagnostic_report.get("locked_packs", [])

    if has_lock_file and not locked_ids.is_empty():
        return _reconcile_locked_world_mods(
            gateway_fsm,
            affinity_manager,
            effective_world_id,
            should_allow_safe_degrade,
            installed_packs,
            locked_ids,
            locked_packs
        )

    if gateway_fsm.adapted_mod_manifest.is_empty() and gateway_fsm.active_mods.is_empty():
        var target_selection: Array = selected_mod_pack_ids if has_explicit_mod_selection else ["*"]
        gateway_fsm.discover_and_configure_single_player_mods([], target_selection)

    var selected_pack_records := _collect_selected_pack_records_for_lock(gateway_fsm.active_mods, installed_packs)
    if not has_lock_file and selected_pack_records.is_empty() and not should_allow_safe_degrade:
        return _build_no_base_mod_failure(effective_world_id)

    var verify_outcome := affinity_manager.verify_and_bind_world_mods(
        effective_world_id,
        selected_pack_records,
        should_allow_safe_degrade
    )
    if not bool(verify_outcome.get("success", false)):
        WorldGatewayModHelper.clear_fsm_mod_overlays(gateway_fsm)
        return _build_lock_verification_failure(effective_world_id, verify_outcome)
    if selected_pack_records.is_empty() and not should_allow_safe_degrade:
        return _build_no_base_mod_failure(effective_world_id)
    return {"success": true}


static func _reconcile_locked_world_mods(
    gateway_fsm: Variant,
    affinity_manager: WorldModAffinityManager,
    effective_world_id: String,
    should_allow_safe_degrade: bool,
    installed_packs: Array,
    locked_ids: Array,
    locked_packs: Array
) -> Dictionary:
    var mounted_matches_lock := _is_mounted_state_matching_lock(gateway_fsm, locked_packs, installed_packs)
    var verification_records := (
        _collect_selected_pack_records_for_lock(gateway_fsm.active_mods, installed_packs)
        if mounted_matches_lock
        else _collect_installed_records_for_ids(locked_ids, installed_packs)
    )
    var verify_outcome := affinity_manager.verify_and_bind_world_mods(
        effective_world_id,
        verification_records,
        should_allow_safe_degrade
    )
    if not bool(verify_outcome.get("success", false)):
        WorldGatewayModHelper.clear_fsm_mod_overlays(gateway_fsm)
        return _build_lock_verification_failure(effective_world_id, verify_outcome)

    if not mounted_matches_lock:
        var remount_ids := _filter_remount_ids(locked_ids, verify_outcome.get("missing_packs", []))
        WorldGatewayModHelper.clear_fsm_mod_overlays(gateway_fsm)
        if not remount_ids.is_empty():
            gateway_fsm.discover_and_configure_single_player_mods([], remount_ids)
    return {"success": true}


static func _is_mounted_state_matching_lock(
    gateway_fsm: Variant,
    locked_packs: Array,
    installed_packs: Array
) -> bool:
    if gateway_fsm.adapted_mod_manifest.is_empty():
        return false
    var locked_digest_map: Dictionary = {}
    for locked_entry in locked_packs:
        var locked_id := WorldGatewayModHelper.extract_pack_id(locked_entry)
        if locked_id.is_empty():
            continue
        var locked_digest := ""
        if locked_entry is Dictionary:
            locked_digest = String((locked_entry as Dictionary).get("content_sha256", "")).strip_edges().to_lower()
        locked_digest_map[locked_id] = locked_digest
    if locked_digest_map.is_empty():
        return false

    var enabled_ids: Variant = gateway_fsm.adapted_mod_manifest.get("enabled_pack_ids", [])
    if not (enabled_ids is Array) or not _id_array_matches_keys(enabled_ids as Array, locked_digest_map):
        return false

    var mounted_active: Array = gateway_fsm.active_mods if gateway_fsm.active_mods is Array else []
    if not _id_array_matches_keys(mounted_active, locked_digest_map):
        return false

    var installed_map := _index_installed_digests(installed_packs)
    for mod_entry in mounted_active:
        var mod_id := WorldGatewayModHelper.extract_pack_id(mod_entry)
        var expected_digest := String(locked_digest_map.get(mod_id, ""))
        if expected_digest.is_empty():
            continue
        var mounted_digest := _extract_pack_digest(mod_entry)
        if mounted_digest.is_empty():
            mounted_digest = String(installed_map.get(mod_id, ""))
        if mounted_digest != expected_digest:
            return false
    return true


static func _id_array_matches_keys(entries: Array, expected_keys: Dictionary) -> bool:
    var seen_keys: Dictionary = {}
    for entry_variant in entries:
        var pack_id := WorldGatewayModHelper.extract_pack_id(entry_variant)
        if pack_id.is_empty() or not expected_keys.has(pack_id):
            return false
        seen_keys[pack_id] = true
    return seen_keys.size() == expected_keys.size()


static func _index_installed_digests(installed_packs: Array) -> Dictionary:
    var digest_map: Dictionary = {}
    for installed_entry in installed_packs:
        var pack_id := WorldGatewayModHelper.extract_pack_id(installed_entry)
        if not pack_id.is_empty():
            digest_map[pack_id] = _extract_pack_digest(installed_entry)
    return digest_map


static func _extract_pack_digest(pack_entry: Variant) -> String:
    if pack_entry is Dictionary:
        return String((pack_entry as Dictionary).get("content_sha256", "")).strip_edges().to_lower()
    if pack_entry != null and not (pack_entry is String) and "content_sha256" in pack_entry:
        return String(pack_entry.content_sha256).strip_edges().to_lower()
    return ""


static func _collect_installed_records_for_ids(locked_ids: Array, installed_packs: Array) -> Array:
    var installed_map: Dictionary = {}
    for installed_entry in installed_packs:
        var entry_id := WorldGatewayModHelper.extract_pack_id(installed_entry)
        if not entry_id.is_empty():
            installed_map[entry_id] = installed_entry
    var collected_records: Array = []
    for locked_id_variant in locked_ids:
        var locked_id := String(locked_id_variant).strip_edges()
        if not locked_id.is_empty() and installed_map.has(locked_id):
            collected_records.append(installed_map[locked_id])
    return collected_records


static func _filter_remount_ids(locked_ids: Array, missing_packs: Array) -> Array:
    var missing_set: Dictionary = {}
    for missing_entry in missing_packs:
        missing_set[String(missing_entry).strip_edges()] = true
    var remount_ids: Array = []
    for locked_id_variant in locked_ids:
        var locked_id := String(locked_id_variant).strip_edges()
        if not locked_id.is_empty() and not missing_set.has(locked_id):
            remount_ids.append(locked_id)
    return remount_ids


static func _build_no_base_mod_failure(effective_world_id: String) -> Dictionary:
    return {
        "success": false,
        "error_code": "ERR_NO_BASE_CONTENT_MOD",
        "template_message": "No active base or total-conversion content MOD mounted for world '{world_id}'.",
        "params": {"world_id": effective_world_id}
    }


static func _build_lock_verification_failure(effective_world_id: String, verify_outcome: Dictionary) -> Dictionary:
    return {
        "success": false,
        "error_code": String(verify_outcome.get("error", "ERR_MISSING_CRITICAL_MOD")),
        "template_message": "Mod lockfile verification failed when entering world '{world_id}': missing critical packs {missing_packs}.",
        "params": {
            "world_id": effective_world_id,
            "missing_packs": verify_outcome.get("missing_packs", []),
            "digest_drifts": verify_outcome.get("digest_drifts", [])
        }
    }


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
