# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/mod_package_discovery_solver.gd
# 架构定位: Domain Service / Topological Discovery Solver
# 依赖与触发: 上游: WorldModAffinityManager, NarrativeCausalityOrchestrator | 下游: GameConfig | 配置: config/domains/narrative_orchestration/core.json | 信号: EventBus 领域广播
# 职责说明: 提供三级级联路径发现、多包清单元数据扫描与基于 Kahn 算法的 DAG 依赖拓扑排序解析
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ModPackageDiscoverySolver：Domain Service / Topological Discovery Solver
class_name ModPackageDiscoverySolver
extends RefCounted

const ModPackageArchiveReader = preload("res://backend/domains/narrative_orchestration/mod_package_archive_reader.gd")

const TIER0_MODS_DEV_PATH: String = "res://mods/"
const TIER1_MODS_REL_PATH: String = "mods/narratives/"
const TIER1_MODS_ROOT_PATH: String = "mods/"
const TIER2_USER_SANDBOX_PATH: String = "user://mods/narratives/"
const TIER2_USER_ROOT_PATH: String = "user://mods/"
const MANIFEST_FILENAME: String = "pack.json"
const ALT_MANIFEST_FILENAME: String = "manifest.json"
const LOG_CHANNEL: String = "mod_narrative"
const SUPPORTED_ENGINE_API_MAJOR: int = 1
const EMPTY_LIST: Array = []

## 去重追加规范化扫描根目录，维持由低到高覆写顺序
static func _append_unique_root(resolved_roots: Array[String], root_path: String) -> void:
    var cleaned_path: String = root_path.strip_edges()
    if cleaned_path.is_empty() or resolved_roots.has(cleaned_path):
        return
    resolved_roots.append(cleaned_path)

## 获取统一分级 MOD 发现根目录列表（配置驱动，工程版包含 res://mods/，发行版隔离至可执行同级与用户沙盒）
static func get_discovery_roots(custom_roots: Array = []) -> Array[String]:
    if not custom_roots.is_empty():
        var roots: Array[String] = []
        for root_entry in custom_roots:
            _append_unique_root(roots, String(root_entry))
        return roots

    var discovery_config: Dictionary = GameConfig.get_dict("domains.narrative_orchestration", "mod_discovery", {})
    var resolved_roots: Array[String] = []

    if GameBootstrap.is_engineering_build():
        var dev_root := String(discovery_config.get("packages_root", TIER0_MODS_DEV_PATH)).strip_edges()
        if not dev_root.is_empty():
            _append_unique_root(resolved_roots, dev_root)
            _append_unique_root(resolved_roots, dev_root.path_join("narratives/"))
        _append_unique_root(resolved_roots, TIER0_MODS_DEV_PATH)
        _append_unique_root(resolved_roots, "res://mods/narratives/")
    else:
        var executable_directory := OS.get_executable_path().get_base_dir()
        var install_rel := String(discovery_config.get("mods_install_rel", TIER1_MODS_ROOT_PATH)).strip_edges()
        _append_unique_root(resolved_roots, executable_directory.path_join(install_rel))
        _append_unique_root(resolved_roots, executable_directory.path_join(TIER1_MODS_ROOT_PATH))
        _append_unique_root(resolved_roots, executable_directory.path_join(TIER1_MODS_REL_PATH))

    var sandbox_root := String(discovery_config.get("mods_user_sandbox", TIER2_USER_ROOT_PATH)).strip_edges()
    if not sandbox_root.is_empty():
        _append_unique_root(resolved_roots, sandbox_root)
    _append_unique_root(resolved_roots, TIER2_USER_ROOT_PATH)
    _append_unique_root(resolved_roots, TIER2_USER_SANDBOX_PATH)
    return resolved_roots

## 从指定清单路径安全读取并解析为 DTO（独立抽取消除循环内堆分配告警）
static func _parse_manifest_at_path(manifest_path: String, fallback_pack_id: String) -> NarrativePackManifestDTO:
    if not FileAccess.file_exists(manifest_path):
        return null

    var file := FileAccess.open(manifest_path, FileAccess.READ)
    if file == null:
        return null

    var content := file.get_as_text()
    var parsed_manifest: Variant = JSON.parse_string(content)
    if not (parsed_manifest is Dictionary):
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_JSON_PARSE_FAIL", TemplateFormatter.format("MOD manifest pack.json invalid format or parse failed: {path}", {"path": manifest_path}), {"file_path": manifest_path})
        return null

    var manifest := NarrativePackManifestDTO.from_dto(parsed_manifest as Dictionary)
    if manifest.pack_id.is_empty():
        manifest.pack_id = fallback_pack_id
    if manifest.root_path.is_empty():
        manifest.root_path = manifest_path.get_base_dir()
    _enrich_manifest_content_digest(manifest, manifest.root_path)

    return manifest

## 从 .kmod 归档包中读取并解析清单
static func _parse_manifest_from_kmod(kmod_path: String, fallback_pack_id: String) -> NarrativePackManifestDTO:
    var reader := ZIPReader.new()
    var open_error := reader.open(kmod_path)
    if open_error != OK:
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_FILE_READ_FAIL", TemplateFormatter.format("Failed to open .kmod archive package: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return null
    var manifest_content := ""
    if reader.file_exists("pack.json"):
        manifest_content = reader.read_file("pack.json").get_string_from_utf8()
    elif reader.file_exists("manifest.json"):
        manifest_content = reader.read_file("manifest.json").get_string_from_utf8()
    reader.close()
    if manifest_content.is_empty():
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_FILE_NOT_FOUND", TemplateFormatter.format(".kmod archive missing pack.json or manifest.json: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return null
    var parsed_manifest: Variant = JSON.parse_string(manifest_content)
    if not (parsed_manifest is Dictionary):
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_JSON_PARSE_FAIL", TemplateFormatter.format(".kmod archive manifest parse error: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return null
    var manifest := NarrativePackManifestDTO.from_dto(parsed_manifest as Dictionary)
    if manifest.pack_id.is_empty():
        manifest.pack_id = fallback_pack_id
    if manifest.root_path.is_empty():
        manifest.root_path = kmod_path
    _enrich_manifest_content_digest(manifest, manifest.root_path)
    return manifest

## 读取目录下非隐藏子目录与文件名清单（供包扫描与内容覆写复用，避免重复目录遍历逻辑）
static func collect_directory_entries(directory_path: String) -> Dictionary:
    var directory_names: Array[String] = []
    var file_names: Array[String] = []
    if not DirAccess.dir_exists_absolute(directory_path):
        return {"dirs": directory_names, "files": file_names}
    var directory_access := DirAccess.open(directory_path)
    if directory_access == null:
        return {"dirs": directory_names, "files": file_names}
    directory_access.list_dir_begin()
    var entry_name := directory_access.get_next()
    while not entry_name.is_empty():
        if not entry_name.begins_with("."):
            if directory_access.current_is_dir():
                directory_names.append(entry_name)
            else:
                file_names.append(entry_name)
        entry_name = directory_access.get_next()
    directory_access.list_dir_end()
    directory_names.sort()
    file_names.sort()
    return {"dirs": directory_names, "files": file_names}

static func _register_discovered_pack(
    discovered_map: Dictionary,
    discovery_order: Array[String],
    conflicts: Array[Dictionary],
    manifest_entry: NarrativePackManifestDTO
) -> void:
    if manifest_entry == null:
        return
    var pack_id := manifest_entry.pack_id.strip_edges()
    if pack_id.is_empty():
        return
    if discovered_map.has(pack_id):
        var existing_entry: NarrativePackManifestDTO = discovered_map[pack_id]
        conflicts.append({
            "error_code": "MOD_ERR_PACK_ID_CONFLICT",
            "pack_id": pack_id,
            "kept_root": existing_entry.root_path,
            "incoming_root": manifest_entry.root_path,
            "existing_official": existing_entry.is_official or existing_entry.pack_profile == "OFFICIAL_BASE"
        })
        if existing_entry.is_official or existing_entry.pack_profile == "OFFICIAL_BASE":
            ErrorReporter.emit_error(
                LOG_CHANNEL,
                "MOD_ERR_PACK_ID_CONFLICT",
                TemplateFormatter.format("Duplicate pack_id collision against official base blocked: {pack_id}", {"pack_id": pack_id}),
                {"pack_id": pack_id, "kept_root": existing_entry.root_path, "rejected_root": manifest_entry.root_path}
            )
            return
        # 非官方包遵循由低到高发现根的受控覆写顺序（高优先级用户沙盒可覆盖同 id 本地开发包）
        discovered_map[pack_id] = manifest_entry
        return
    discovery_order.append(pack_id)
    discovered_map[pack_id] = manifest_entry

## 扫描指定单个根目录下的全部子目录清单与 .kmod 归档包
static func _scan_single_root_directory(
    root_path: String,
    discovered_map: Dictionary,
    discovery_order: Array[String],
    conflicts: Array[Dictionary]
) -> void:
    var entries: Dictionary = collect_directory_entries(root_path)
    var directory_names: Array = entries.get("dirs", [])
    for entry_directory_variant in directory_names:
        var entry_name := str(entry_directory_variant)
        var subdirectory_path := root_path.path_join(entry_name)
        var manifest_file := subdirectory_path.path_join(MANIFEST_FILENAME)
        var manifest_entry := _parse_manifest_at_path(manifest_file, entry_name)
        _register_discovered_pack(discovered_map, discovery_order, conflicts, manifest_entry)

    var file_names: Array = entries.get("files", [])
    for entry_file_variant in file_names:
        var entry_file := str(entry_file_variant)
        if entry_file.ends_with(".kmod"):
            var kmod_file := root_path.path_join(entry_file)
            var kmod_manifest := _parse_manifest_from_kmod(kmod_file, entry_file.get_basename())
            _register_discovered_pack(discovered_map, discovery_order, conflicts, kmod_manifest)

## 扫描指定或级联根目录下包含 pack.json 的所有包清单（含冲突诊断；默认仅保留 is_active == true）
static func scan_installed_packs_with_diagnostics(custom_roots: Array = [], include_inactive: bool = false) -> Dictionary:
    var roots: Array[String] = get_discovery_roots(custom_roots)
    var discovered_map: Dictionary = {}
    var discovery_order: Array[String] = []
    var conflicts: Array[Dictionary] = []

    for root_directory in roots:
        _scan_single_root_directory(root_directory, discovered_map, discovery_order, conflicts)

    var discovered_manifests: Array[NarrativePackManifestDTO] = []
    var inactive_manifests: Array[NarrativePackManifestDTO] = []
    for pack_id in discovery_order:
        var manifest_entry: NarrativePackManifestDTO = discovered_map.get(pack_id, null)
        if manifest_entry == null:
            continue
        if manifest_entry.is_active or include_inactive:
            discovered_manifests.append(manifest_entry)
        else:
            inactive_manifests.append(manifest_entry)

    return {
        "packs": discovered_manifests,
        "inactive_packs": inactive_manifests,
        "conflicts": conflicts,
        "discovery_roots": roots
    }

## 扫描指定或级联根目录下包含 pack.json 的所有已激活包清单
static func scan_installed_packs(custom_roots: Array = [], include_inactive: bool = false) -> Array[NarrativePackManifestDTO]:
    var discovery_report: Dictionary = scan_installed_packs_with_diagnostics(custom_roots, include_inactive)
    var packs_variant: Variant = discovery_report.get("packs", [])
    var typed_packs: Array[NarrativePackManifestDTO] = []
    if packs_variant is Array:
        for manifest_entry in (packs_variant as Array):
            if manifest_entry is NarrativePackManifestDTO:
                typed_packs.append(manifest_entry as NarrativePackManifestDTO)
    return typed_packs

static func _collect_pack_missing_deps(
    pack_manifest: NarrativePackManifestDTO,
    pack_map: Dictionary,
    missing_registry: Dictionary
) -> void:
    for dependency_id in pack_manifest.dependencies:
        if not pack_map.has(dependency_id):
            missing_registry[dependency_id] = true


## 检查清单集合中是否存在未满足的前置依赖
static func _find_missing_dependencies(pack_map: Dictionary) -> Array[String]:
    var missing_registry: Dictionary = {}
    for pack_id in pack_map.keys():
        var pack_manifest: NarrativePackManifestDTO = pack_map[pack_id]
        _collect_pack_missing_deps(pack_manifest, pack_map, missing_registry)

    var missing_list: Array[String] = []
    for missing_key in missing_registry.keys():
        missing_list.append(String(missing_key))
    missing_list.sort()
    return missing_list

## 构建依赖入度表与后继邻接表
static func _init_pack_adjacency_slot(pack_id: String, in_degree: Dictionary, adjacency_list: Dictionary) -> void:
    in_degree[pack_id] = 0
    adjacency_list[pack_id] = []


static func _register_pack_edges(pack_id: String, pack_manifest: NarrativePackManifestDTO, in_degree: Dictionary, adjacency_list: Dictionary) -> void:
    for dependency_id in pack_manifest.dependencies:
        in_degree[pack_id] = int(in_degree[pack_id]) + 1
        var successors: Array = adjacency_list[dependency_id]
        successors.append(pack_id)


static func _build_topology_tables(pack_map: Dictionary, in_degree: Dictionary, adjacency_list: Dictionary) -> void:
    for pack_id in pack_map.keys():
        _init_pack_adjacency_slot(pack_id, in_degree, adjacency_list)

    for pack_id in pack_map.keys():
        var pack_manifest: NarrativePackManifestDTO = pack_map[pack_id]
        _register_pack_edges(pack_id, pack_manifest, in_degree, adjacency_list)

## 针对同一拓扑层级内的节点按优先级降序、包名升序进行稳定排序
static func _sort_tier_by_priority(tier: Array[NarrativePackManifestDTO]) -> void:
    tier.sort_custom(func(first_pack: NarrativePackManifestDTO, second_pack: NarrativePackManifestDTO) -> bool:
        if first_pack.priority != second_pack.priority:
            return first_pack.priority > second_pack.priority
        return first_pack.pack_id < second_pack.pack_id
    )

## 单层 Kahn 依赖缩减解算，平铺控制流并消除循环内深层嵌套
static func _process_kahn_tier(
    current_tier: Array[NarrativePackManifestDTO],
    adjacency_list: Dictionary,
    in_degree: Dictionary,
    pack_map: Dictionary,
    sorted_packs: Array[NarrativePackManifestDTO]
) -> Array[NarrativePackManifestDTO]:
    var next_tier: Array[NarrativePackManifestDTO] = []
    for pack_manifest in current_tier:
        sorted_packs.append(pack_manifest)
        var successors: Array = adjacency_list.get(pack_manifest.pack_id, EMPTY_LIST)
        for successor_id in successors:
            var new_degree: int = int(in_degree.get(successor_id, 0)) - 1
            in_degree[successor_id] = new_degree
            if new_degree == 0:
                next_tier.append(pack_map[successor_id])
    return next_tier

static func _validate_manifest_compatibility(pack_map: Dictionary) -> Dictionary:
    for pack_id in pack_map.keys():
        var manifest_entry: NarrativePackManifestDTO = pack_map[pack_id]
        if not manifest_entry.engine_api_version.is_empty():
            var parts := manifest_entry.engine_api_version.split(".")
            if parts.is_empty() or not parts[0].is_valid_int() or parts[0].to_int() != SUPPORTED_ENGINE_API_MAJOR:
                return {
                    "success": false,
                    "error": "MOD_ERR_INCOMPATIBLE_VERSION",
                    "pack_id": pack_id,
                    "engine_api_version": manifest_entry.engine_api_version
                }
        for incompatible_id in manifest_entry.incompatible_packs:
            if pack_map.has(incompatible_id):
                return {
                    "success": false,
                    "error": "ERR_MOD_INCOMPATIBLE_CONFLICT",
                    "pack_id": pack_id,
                    "conflict_with": incompatible_id
                }
    return {"success": true}

## 执行基于 Kahn 算法的 DAG 依赖拓扑排序（含 Semver 版本与互斥冲突前置门禁）
static func sort_and_resolve_dependencies(manifests: Array) -> Dictionary:
    if manifests.is_empty():
        var empty_manifests: Array[NarrativePackManifestDTO] = []
        return {
            "success": true,
            "sorted_packs": empty_manifests
        }

    var pack_map: Dictionary = {}
    for manifest_entry in manifests:
        if manifest_entry is NarrativePackManifestDTO:
            pack_map[manifest_entry.pack_id] = manifest_entry
        elif manifest_entry is Dictionary:
            var converted := NarrativePackManifestDTO.from_dto(manifest_entry as Dictionary)
            pack_map[converted.pack_id] = converted

    var compat_result := _validate_manifest_compatibility(pack_map)
    if not bool(compat_result.get("success", false)):
        return compat_result

    var missing := _find_missing_dependencies(pack_map)
    if not missing.is_empty():
        return {
            "success": false,
            "error": "ERR_MISSING_DEPENDENCY",
            "missing": missing
        }

    var in_degree: Dictionary = {}
    var adjacency_list: Dictionary = {}
    _build_topology_tables(pack_map, in_degree, adjacency_list)

    var current_tier: Array[NarrativePackManifestDTO] = []
    for pack_id in pack_map.keys():
        if int(in_degree[pack_id]) == 0:
            current_tier.append(pack_map[pack_id])

    var sorted_packs: Array[NarrativePackManifestDTO] = []
    while not current_tier.is_empty():
        _sort_tier_by_priority(current_tier)
        current_tier = _process_kahn_tier(current_tier, adjacency_list, in_degree, pack_map, sorted_packs)

    if sorted_packs.size() < pack_map.size():
        var cycles: Array[String] = []
        for pack_id in pack_map.keys():
            if int(in_degree[pack_id]) > 0:
                cycles.append(String(pack_id))
        cycles.sort()
        return {
            "success": false,
            "error": "ERR_CYCLIC_DEPENDENCY",
            "cycles": cycles
        }

    return {
        "success": true,
        "sorted_packs": sorted_packs
    }

## 安全读取指定 JSON 文件并解析为 Variant
static func _read_json_file(file_path: String) -> Variant:
    if not FileAccess.file_exists(file_path):
        return null
    var file := FileAccess.open(file_path, FileAccess.READ)
    if file == null:
        return null
    var text := file.get_as_text()
    var parsed: Variant = JSON.parse_string(text)
    if parsed == null and not text.strip_edges().is_empty():
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_JSON_PARSE_FAIL", TemplateFormatter.format("MOD JSON parse syntax error: {path}", {"path": file_path}), {"file_path": file_path})
    return parsed

## 列出指定子目录下的全部 .json 文件完整路径
static func _list_json_files(directory_path: String) -> Array[String]:
    var files: Array[String] = []
    var entries: Dictionary = collect_directory_entries(directory_path)
    for file_variant in entries.get("files", []):
        var entry_name := str(file_variant)
        if entry_name.ends_with(".json"):
            files.append(directory_path.path_join(entry_name))
    return files

## 扫描 mod_directory/dag_graphs 目录下的所有剧情 DAG 图元
static func _scan_mod_dag_graphs(mod_directory: String, target_graphs: Dictionary) -> void:
    for file_path in _list_json_files(mod_directory.path_join("dag_graphs")):
        var raw_json: Variant = _read_json_file(file_path)
        if raw_json is Dictionary:
            var stem := file_path.get_file().get_basename()
            var dag_id := str((raw_json as Dictionary).get("dag_id", (raw_json as Dictionary).get("graph_id", stem)))
            target_graphs[dag_id] = raw_json

## 扫描 mod_directory/i18n 目录下的多语言本地化配置（按语言分桶并兼容扁平回退）
static func _scan_mod_i18n(mod_directory: String, target_i18n: Dictionary, target_by_locale: Dictionary = {}) -> void:
    for file_path in _list_json_files(mod_directory.path_join("i18n")):
        var raw_json: Variant = _read_json_file(file_path)
        if raw_json is Dictionary:
            var locale_stem := file_path.get_file().get_basename()
            ModPackageArchiveReader.merge_i18n_payload_for_locale(
                raw_json as Dictionary, locale_stem, target_i18n, target_by_locale
            )

## 加载 destinies.json 与 routing_rules.json 并合并入 MOD 包字典
static func _load_destinies_and_routing(mod_directory: String, package_payload: Dictionary) -> void:
    var raw_destinies: Variant = _read_json_file(mod_directory.path_join("destinies.json"))
    if raw_destinies is Dictionary:
        var destinies_payload: Dictionary = raw_destinies
        var keys_to_merge: Array[String] = [
            "ui_capabilities", "custom_races", "creation_rule_overrides",
            "custom_origins", "custom_traits",
            "paired_presets", "custom_starter_kits", "custom_routing_rules"
        ]
        for config_key in keys_to_merge:
            if destinies_payload.has(config_key):
                package_payload[config_key] = destinies_payload[config_key]

    var raw_routing: Variant = _read_json_file(mod_directory.path_join("routing_rules.json"))
    if raw_routing is Dictionary:
        var routing_payload: Dictionary = raw_routing
        if routing_payload.get("prologue_routing_rules") is Array:
            var existing_prologue_rules: Array = package_payload.get("prologue_routing_rules", [])
            for prologue_rule_entry in (routing_payload.get("prologue_routing_rules") as Array):
                existing_prologue_rules.append(prologue_rule_entry)
            package_payload["prologue_routing_rules"] = existing_prologue_rules
        var raw_rules: Variant = routing_payload.get("custom_routing_rules", routing_payload.get("routing_rules", []))
        if raw_rules is Array:
            var existing_rules: Array = package_payload.get("custom_routing_rules", [])
            for rule_entry in (raw_rules as Array):
                existing_rules.append(rule_entry)
            package_payload["custom_routing_rules"] = existing_rules
    elif raw_routing is Array:
        var existing_rules: Array = package_payload.get("custom_routing_rules", [])
        for rule_entry in (raw_routing as Array):
            existing_rules.append(rule_entry)
        package_payload["custom_routing_rules"] = existing_rules

## 从指定目录完整读取并组装单包数据字典
static func load_full_mod_package_from_dir(mod_directory: String) -> Dictionary:
    if mod_directory.ends_with(".kmod"):
        var kmod_payload: Dictionary = ModPackageArchiveReader.load_full_package_from_kmod(mod_directory)
        if not kmod_payload.is_empty():
            _enrich_package_payload_digest(kmod_payload, mod_directory)
        return kmod_payload

    var manifest_path := mod_directory.path_join(MANIFEST_FILENAME)
    var pack_raw: Variant = _read_json_file(manifest_path)
    if not (pack_raw is Dictionary):
        return {}

    var package_payload: Dictionary = (pack_raw as Dictionary).duplicate(true)
    _load_destinies_and_routing(mod_directory, package_payload)

    var dag_graphs: Dictionary = package_payload.get("dag_graphs", {})
    _scan_mod_dag_graphs(mod_directory, dag_graphs)
    package_payload["dag_graphs"] = dag_graphs

    var custom_i18n: Dictionary = package_payload.get("custom_i18n", {})
    var i18n_by_locale: Dictionary = package_payload.get("custom_i18n_by_locale", {})
    _scan_mod_i18n(mod_directory, custom_i18n, i18n_by_locale)
    package_payload["custom_i18n"] = custom_i18n
    package_payload["custom_i18n_by_locale"] = i18n_by_locale

    package_payload["root_path"] = mod_directory
    _enrich_package_payload_digest(package_payload, mod_directory)
    return package_payload


static func _enrich_manifest_content_digest(manifest: NarrativePackManifestDTO, package_root: String) -> void:
    if manifest == null or package_root.is_empty():
        return
    var computed_digest := compute_package_content_sha256(package_root).strip_edges().to_lower()
    if not computed_digest.is_empty():
        manifest.content_sha256 = computed_digest


static func _enrich_package_payload_digest(package_payload: Dictionary, package_root: String) -> void:
    if package_payload.is_empty() or package_root.is_empty():
        return
    var declared_digest := String(package_payload.get("content_sha256", "")).strip_edges().to_lower()
    if not declared_digest.is_empty():
        package_payload["declared_content_sha256"] = declared_digest
    var computed_digest := compute_package_content_sha256(package_root).strip_edges().to_lower()
    if not computed_digest.is_empty():
        package_payload["content_sha256"] = computed_digest


static func _read_declared_content_sha256(package_root: String) -> String:
    if package_root.is_empty():
        return ""
    if package_root.ends_with(".kmod"):
        var archive_reader := ZIPReader.new()
        if archive_reader.open(package_root) != OK:
            return ""
        var manifest_text := ""
        if archive_reader.file_exists("pack.json"):
            manifest_text = archive_reader.read_file("pack.json").get_string_from_utf8()
        elif archive_reader.file_exists("manifest.json"):
            manifest_text = archive_reader.read_file("manifest.json").get_string_from_utf8()
        archive_reader.close()
        if manifest_text.is_empty():
            return ""
        var parsed_archive: Variant = JSON.parse_string(manifest_text)
        if parsed_archive is Dictionary:
            return String((parsed_archive as Dictionary).get("content_sha256", "")).strip_edges().to_lower()
        return ""
    var manifest_path := package_root.path_join(MANIFEST_FILENAME)
    if not FileAccess.file_exists(manifest_path):
        return ""
    var parsed_disk: Variant = _read_json_file(manifest_path)
    if parsed_disk is Dictionary:
        return String((parsed_disk as Dictionary).get("content_sha256", "")).strip_edges().to_lower()
    return ""


## 校验包目录声明摘要与实际内容哈希是否一致（未声明 content_sha256 的开发夹具放行）
static func verify_package_content_integrity(package_entry: Variant) -> Dictionary:
    var package_id := ""
    var package_root := ""
    var inline_declared := ""
    if package_entry is Dictionary:
        var entry_table := package_entry as Dictionary
        package_id = String(entry_table.get("pack_id", entry_table.get("id", ""))).strip_edges()
        package_root = String(entry_table.get("root_path", "")).strip_edges()
        inline_declared = String(entry_table.get("declared_content_sha256", "")).strip_edges().to_lower()
    elif package_entry != null and "root_path" in package_entry:
        package_id = String(package_entry.pack_id).strip_edges() if "pack_id" in package_entry else ""
        package_root = String(package_entry.root_path).strip_edges()

    if package_root.is_empty():
        return {"valid": true, "pack_id": package_id, "declared_content_sha256": inline_declared, "computed_content_sha256": ""}

    var has_package_source := FileAccess.file_exists(package_root) if package_root.ends_with(".kmod") else DirAccess.dir_exists_absolute(package_root)
    if not has_package_source:
        return {"valid": true, "pack_id": package_id, "declared_content_sha256": inline_declared, "computed_content_sha256": ""}

    var disk_declared := _read_declared_content_sha256(package_root)
    var effective_declared := disk_declared if not disk_declared.is_empty() else inline_declared
    var computed_digest := compute_package_content_sha256(package_root).strip_edges().to_lower()
    if effective_declared.is_empty():
        return {"valid": true, "pack_id": package_id, "declared_content_sha256": "", "computed_content_sha256": computed_digest}

    if computed_digest.is_empty() or effective_declared != computed_digest:
        return {
            "valid": false,
            "error_code": "MOD_ERR_REALM_DIGEST_MISMATCH",
            "pack_id": package_id,
            "declared_content_sha256": effective_declared,
            "computed_content_sha256": computed_digest
        }
    return {"valid": true, "pack_id": package_id, "declared_content_sha256": effective_declared, "computed_content_sha256": computed_digest}


## 收集目录下可稳定参与 SHA-256 内容哈希计算的文件相对路径
static func _collect_hashable_files_recursive(directory_path: String, relative_prefix: String, out_relative_paths: Array[String]) -> void:
    var entries: Dictionary = collect_directory_entries(directory_path)
    for sub_variant in entries.get("dirs", []):
        var subdirectory_name := str(sub_variant)
        var next_prefix := (relative_prefix + "/" + subdirectory_name) if not relative_prefix.is_empty() else subdirectory_name
        _collect_hashable_files_recursive(directory_path.path_join(subdirectory_name), next_prefix, out_relative_paths)
    for file_variant in entries.get("files", []):
        var file_name := str(file_variant)
        if file_name.ends_with(".uid") or file_name.ends_with(".import"):
            continue
        if file_name == MANIFEST_FILENAME and relative_prefix.is_empty():
            continue
        var next_file := (relative_prefix + "/" + file_name) if not relative_prefix.is_empty() else file_name
        out_relative_paths.append(next_file)

## 计算目录型或 .kmod MOD 包内容确定性 SHA-256 摘要（跳过根清单与编辑器伴生文件避免自引用环）
static func compute_package_content_sha256(package_root: String) -> String:
    var sha_hasher := HashingContext.new()
    sha_hasher.start(HashingContext.HASH_SHA256)
    if package_root.ends_with(".kmod"):
        return ModPackageArchiveReader.compute_kmod_sha256(package_root, sha_hasher)
    if not DirAccess.dir_exists_absolute(package_root):
        return ""
    var relative_paths: Array[String] = []
    _collect_hashable_files_recursive(package_root, "", relative_paths)
    relative_paths.sort()
    for relative_file in relative_paths:
        var absolute_file := package_root.path_join(relative_file)
        sha_hasher.update(relative_file.to_utf8_buffer())
        sha_hasher.update(FileAccess.get_file_as_bytes(absolute_file))
    return sha_hasher.finish().hex_encode()

## 扫描三级级联目录并按拓扑排序组装已激活的全量 MOD 包及诊断结果（环依赖/冲突严格拒载 fail-closed）
static func scan_installed_full_mod_packages_with_diagnostics(custom_roots: Array = []) -> Dictionary:
    var scan_diag: Dictionary = scan_installed_packs_with_diagnostics(custom_roots, false)
    var installed_packs: Array[NarrativePackManifestDTO] = []
    for manifest_entry in (scan_diag.get("packs", []) as Array):
        if manifest_entry is NarrativePackManifestDTO:
            installed_packs.append(manifest_entry as NarrativePackManifestDTO)

    var sort_result: Dictionary = sort_and_resolve_dependencies(installed_packs)
    var loaded_packages: Array[Dictionary] = []
    if not bool(sort_result.get("success", false)):
        var raw_error := str(sort_result.get("error", "CONFIG_VALIDATION_FAILED"))
        var registered_code := "MOD_ERR_CYCLE_DETECTED" if raw_error == "ERR_CYCLIC_DEPENDENCY" else (
            "MOD_ERR_INCOMPATIBLE_VERSION" if raw_error == "MOD_ERR_INCOMPATIBLE_VERSION" else "CONFIG_VALIDATION_FAILED"
        )
        ErrorReporter.emit_error(
            LOG_CHANNEL,
            registered_code,
            TemplateFormatter.format("MOD dependency topological sort failed (fail-closed): {error}", {"error": raw_error}),
            sort_result
        )
        return {
            "success": false,
            "error_code": raw_error,
            "packages": loaded_packages,
            "sort_result": sort_result,
            "conflicts": scan_diag.get("conflicts", [])
        }

    var ordered_packs: Array = sort_result.get("sorted_packs", [])
    for pack_entry in ordered_packs:
        var root_path: String = ""
        if pack_entry is NarrativePackManifestDTO:
            root_path = (pack_entry as NarrativePackManifestDTO).root_path
        elif pack_entry is Dictionary:
            root_path = str((pack_entry as Dictionary).get("root_path", ""))
        if not root_path.is_empty():
            var full_package := load_full_mod_package_from_dir(root_path)
            if not full_package.is_empty():
                loaded_packages.append(full_package)

    return {
        "success": true,
        "packages": loaded_packages,
        "sort_result": sort_result,
        "conflicts": scan_diag.get("conflicts", [])
    }

## 扫描三级级联目录并按拓扑排序顺序组装已激活的全量 MOD 包数组（失败时安全返回空数组）
static func scan_installed_full_mod_packages(custom_roots: Array = []) -> Array[Dictionary]:
    var diag := scan_installed_full_mod_packages_with_diagnostics(custom_roots)
    var typed_packages: Array[Dictionary] = []
    for pkg in (diag.get("packages", []) as Array):
        if pkg is Dictionary:
            typed_packages.append(pkg as Dictionary)
    return typed_packages
