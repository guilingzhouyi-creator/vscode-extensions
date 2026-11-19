# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_mod_helper.gd
# 架构定位: Domain Support Helper / Gateway MOD Stack Orchestration & Lock Sync
# 依赖与触发: 上游: WorldGatewayFSM | 下游: ModPackageDiscoverySolver, ModPrecheckAndAdaptationSolver, Tier3ContentOverrideLoader, WorldModAffinityManager, AntiBridgeGuard | 配置: config/domains/world_gateway.json | 信号: 无
# 职责说明: 为 WorldGatewayFSM 提供已安装模组摘要组装、单机 precheck/Tier3 叠层注入、联机权威清单挂载清洗及单机世界档案 MOD 锁同步验证能力。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldGatewayModHelper：Domain Support Helper / Gateway MOD Orchestration
class_name WorldGatewayModHelper
extends RefCounted


## 从多样化 MOD 描述条目提取规范化 pack_id
static func extract_pack_id(mod_entry: Variant) -> String:
    if mod_entry is String:
        return str(mod_entry).strip_edges()
    if mod_entry is Dictionary:
        var entry_map := mod_entry as Dictionary
        return str(entry_map.get("pack_id", "")).strip_edges()
    if mod_entry is Object and mod_entry.get("pack_id") != null:
        return str(mod_entry.get("pack_id")).strip_edges()
    return ""


## 按 pack_id 构建已发现包字典索引
static func index_packages_by_id(packages: Array[Dictionary]) -> Dictionary:
    var indexed: Dictionary = {}
    for package_entry in packages:
        var package_id := str(package_entry.get("pack_id", "")).strip_edges()
        if not package_id.is_empty():
            indexed[package_id] = package_entry
    return indexed


## 从候选模组包集合中按启用的包 ID 列表顺序筛选出实体包对象
static func collect_enabled_candidate_packages(candidate_packs: Array, enabled_pack_identifiers: Array) -> Array:
    var packages_by_id: Dictionary = {}
    for raw_pack in candidate_packs:
        var package_id := extract_pack_id(raw_pack)
        if not package_id.is_empty() and not packages_by_id.has(package_id):
            packages_by_id[package_id] = raw_pack
    var enabled_packages: Array = []
    for raw_identifier in enabled_pack_identifiers:
        var clean_identifier := str(raw_identifier).strip_edges()
        if packages_by_id.has(clean_identifier):
            enabled_packages.append(packages_by_id[clean_identifier])
    return enabled_packages


## 清空网关状态机持有的 MOD 叠层配置并同步运行时会话清空
static func clear_fsm_mod_overlays(gateway_fsm: Variant) -> void:
    Tier3ContentOverrideLoader.revert_all_overrides()
    GameConfig.clear_mod_overlay_tables()
    gateway_fsm.active_mods.clear()
    gateway_fsm.adapted_mod_manifest.clear()
    gateway_fsm.creation_ui_snapshot.clear()
    WorldSessionRuntimeService.set_active_mod_context([], {})


## 构建统一的零内容模组错误返回体
static func build_no_base_mod_failure() -> Dictionary:
    return {
        "success": false,
        "error_code": "ERR_NO_BASE_CONTENT_MOD",
        "enabled_pack_ids": [],
        "precheck_checklist": [],
        "conflicts": [],
        "adapted_manifest": {},
        "creation_ui_snapshot": {}
    }


## 格式化本地已安装 MOD 列表与基础包就绪状态摘要
static func format_installed_mods_report(
    scan_result: Dictionary,
    selected_pack_ids: Array[String],
    has_explicit_selection: bool,
    active_mods: Array
) -> Dictionary:
    var packages: Variant = scan_result.get("packs", [])
    var formatted_packages: Array[Dictionary] = []
    var default_selected_ids: Array[String] = []
    var has_base_content := false
    if packages is Array:
        for package_entry in (packages as Array):
            var formatted_item := _format_installed_mod_summary(package_entry, selected_pack_ids, has_explicit_selection)
            if bool(formatted_item.get("is_base_content", false)):
                has_base_content = true
            if bool(formatted_item.get("is_selected", false)):
                default_selected_ids.append(str(formatted_item.get("pack_id", "")))
            formatted_packages.append(formatted_item)
    var selected_ids_out: Array = selected_pack_ids.duplicate() if has_explicit_selection else default_selected_ids
    if has_explicit_selection and not selected_pack_ids.is_empty():
        formatted_packages = _reorder_packages_by_selection(formatted_packages, selected_pack_ids)
    return {
        "success": true,
        "packages": formatted_packages,
        "diagnostics": scan_result.get("diagnostics", []),
        "has_base_content_mod": has_base_content,
        "selected_pack_ids": selected_ids_out,
        "active_pack_ids": active_mods.duplicate()
    }


static func _reorder_packages_by_selection(packages: Array[Dictionary], selected_pack_ids: Array[String]) -> Array[Dictionary]:
    var by_id: Dictionary = {}
    for pack_entry in packages:
        by_id[str(pack_entry.get("pack_id", ""))] = pack_entry
    var ordered: Array[Dictionary] = []
    var placed: Dictionary = {}
    for pack_id in selected_pack_ids:
        if by_id.has(pack_id) and not placed.has(pack_id):
            ordered.append(by_id[pack_id])
            placed[pack_id] = true
    for pack_entry in packages:
        var pack_id := str(pack_entry.get("pack_id", ""))
        if not placed.has(pack_id):
            ordered.append(pack_entry)
    return ordered


static func _format_installed_mod_summary(
    package_entry: Variant,
    selected_pack_ids: Array[String],
    has_explicit_selection: bool
) -> Dictionary:
    var entry_map: Dictionary = package_entry.to_dto() if (package_entry is Object and package_entry.has_method("to_dto")) else {}
    var pack_id := str(entry_map.get("pack_id", ""))
    var pack_profile := str(entry_map.get("pack_profile", "CONTENT_ADDON")).to_upper()
    if not entry_map.has("display_name") or str(entry_map.get("display_name", "")).is_empty():
        entry_map["display_name"] = str(entry_map.get("pack_name", pack_id))
    entry_map["is_base_content"] = pack_profile in ["OFFICIAL_BASE", "TOTAL_CONVERSION"]
    entry_map["is_selected"] = selected_pack_ids.has(pack_id) if has_explicit_selection else bool(entry_map.get("is_active", true))
    return entry_map


## 将预检成功的单机 MOD 合并结果应用至网关状态机并挂载 Tier 3 差分覆盖层
static func apply_precheck_adaptation_result(
    gateway_fsm: Variant,
    candidate_packs: Array,
    precheck_result: Dictionary
) -> Dictionary:
    var raw_manifest: Variant = precheck_result.get("adapted_manifest", {})
    gateway_fsm.adapted_mod_manifest = (raw_manifest as Dictionary).duplicate(true) if raw_manifest is Dictionary else {}
    var raw_creation_ui_snapshot: Variant = precheck_result.get("creation_ui_snapshot", {})
    gateway_fsm.creation_ui_snapshot = (raw_creation_ui_snapshot as Dictionary).duplicate(true) if raw_creation_ui_snapshot is Dictionary else {}
    var raw_enabled: Variant = precheck_result.get("enabled_pack_ids", [])
    gateway_fsm.active_mods = (raw_enabled as Array).duplicate(true) if raw_enabled is Array else []
    WorldSessionRuntimeService.set_active_mod_context(gateway_fsm.active_mods, gateway_fsm.adapted_mod_manifest)

    var enabled_packages := collect_enabled_candidate_packages(candidate_packs, gateway_fsm.active_mods)
    var tier3_summary: Dictionary = Tier3ContentOverrideLoader.apply_enabled_packages(enabled_packages)
    var enriched_result: Dictionary = precheck_result.duplicate(true)
    enriched_result["tier3_overlay_summary"] = tier3_summary
    return enriched_result
