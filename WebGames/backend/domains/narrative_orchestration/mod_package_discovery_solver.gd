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

const TIER0_BUILTIN_PATH: String = "res://config/narratives/packs/"
const TIER1_MODS_REL_PATH: String = "mods/narratives/"
const TIER1_MODS_ROOT_PATH: String = "mods/"
const TIER2_USER_SANDBOX_PATH: String = "user://mods/narratives/"
const TIER2_USER_ROOT_PATH: String = "user://mods/"
const MANIFEST_FILENAME: String = "pack.json"
const LOG_CHANNEL: String = "mod_narrative"
const EMPTY_LIST: Array = []

## 去重追加规范化扫描根目录，维持由低到高覆写顺序
static func _append_unique_root(resolved_roots: Array[String], root_path: String) -> void:
    var cleaned_path: String = root_path.strip_edges()
    if cleaned_path.is_empty() or resolved_roots.has(cleaned_path):
        return
    resolved_roots.append(cleaned_path)

## 获取统一分级 MOD 发现根目录列表（同时兼容顶层 mods/<pack_id> 与 mods/narratives/<pack_id>）
static func get_discovery_roots(custom_roots: Array = []) -> Array[String]:
    if not custom_roots.is_empty():
        var roots: Array[String] = []
        for root_entry in custom_roots:
            _append_unique_root(roots, String(root_entry))
        return roots

    var resolved_roots: Array[String] = []
    # Tier 0: 内置核心包路径
    _append_unique_root(resolved_roots, TIER0_BUILTIN_PATH)

    # Tier 1: 开发期或外部可执行程序同级安装目录
    if OS.has_feature("editor"):
        _append_unique_root(resolved_roots, "res://mods/")
        _append_unique_root(resolved_roots, "res://mods/narratives/")
    else:
        var executable_directory := OS.get_executable_path().get_base_dir()
        _append_unique_root(resolved_roots, executable_directory.path_join(TIER1_MODS_ROOT_PATH))
        _append_unique_root(resolved_roots, executable_directory.path_join(TIER1_MODS_REL_PATH))

    # Tier 2: 用户沙盒数据目录（顶层目录优先于子目录作为最终覆写层级）
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

## 扫描指定单个根目录下的全部子目录清单与 .kmod 归档包
static func _scan_single_root_directory(root_path: String, discovered_map: Dictionary, discovery_order: Array[String]) -> void:
    var entries: Dictionary = collect_directory_entries(root_path)
    var directory_names: Array = entries.get("dirs", [])
    for entry_directory_variant in directory_names:
        var entry_name := str(entry_directory_variant)
        var subdirectory_path := root_path.path_join(entry_name)
        var manifest_file := subdirectory_path.path_join(MANIFEST_FILENAME)
        var manifest_entry := _parse_manifest_at_path(manifest_file, entry_name)
        if manifest_entry != null:
            var pack_id := manifest_entry.pack_id
            if not discovered_map.has(pack_id):
                discovery_order.append(pack_id)
            discovered_map[pack_id] = manifest_entry

    var file_names: Array = entries.get("files", [])
    for entry_file_variant in file_names:
        var entry_file := str(entry_file_variant)
        if entry_file.ends_with(".kmod"):
            var kmod_file := root_path.path_join(entry_file)
            var kmod_manifest := _parse_manifest_from_kmod(kmod_file, entry_file.get_basename())
            if kmod_manifest != null:
                var kmod_pack_id := kmod_manifest.pack_id
                if not discovered_map.has(kmod_pack_id):
                    discovery_order.append(kmod_pack_id)
                discovered_map[kmod_pack_id] = kmod_manifest

## 扫描指定或级联根目录下包含 pack.json 的所有包清单
static func scan_installed_packs(custom_roots: Array = []) -> Array[NarrativePackManifestDTO]:
    var roots: Array[String] = get_discovery_roots(custom_roots)
    var discovered_map: Dictionary = {}
    var discovery_order: Array[String] = []

    for root_directory in roots:
        _scan_single_root_directory(root_directory, discovered_map, discovery_order)

    var discovered_manifests: Array[NarrativePackManifestDTO] = []
    for pack_id in discovery_order:
        var manifest_entry: NarrativePackManifestDTO = discovered_map.get(pack_id, null)
        if manifest_entry != null:
            discovered_manifests.append(manifest_entry)
    return discovered_manifests

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

## 执行基于 Kahn 算法的 DAG 依赖拓扑排序
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

## 递归展平 i18n 嵌套字典为点分键与斜杠键
static func _flatten_i18n_dict(source_dictionary: Dictionary, prefix: String, target: Dictionary) -> void:
    for entry_key in source_dictionary.keys():
        var full_key := (prefix + "." + str(entry_key)) if not prefix.is_empty() else str(entry_key)
        var raw_entry: Variant = source_dictionary[entry_key]
        if raw_entry is Dictionary:
            _flatten_i18n_dict(raw_entry as Dictionary, full_key, target)
        else:
            var flattened_text := str(raw_entry)
            target[full_key] = flattened_text
            target[full_key.replace(".", "/")] = flattened_text
            target[full_key.replace("/", ".")] = flattened_text

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

## 扫描 mod_directory/i18n 目录下的多语言本地化配置
static func _scan_mod_i18n(mod_directory: String, target_i18n: Dictionary) -> void:
    for file_path in _list_json_files(mod_directory.path_join("i18n")):
        var raw_json: Variant = _read_json_file(file_path)
        if raw_json is Dictionary:
            _flatten_i18n_dict(raw_json as Dictionary, "", target_i18n)

## 加载 destinies.json 与 routing_rules.json 并合并入 MOD 包字典
static func _load_destinies_and_routing(mod_directory: String, package_payload: Dictionary) -> void:
    var raw_destinies: Variant = _read_json_file(mod_directory.path_join("destinies.json"))
    if raw_destinies is Dictionary:
        var destinies_payload: Dictionary = raw_destinies
        var keys_to_merge: Array[String] = [
            "ui_capabilities", "custom_origins", "custom_traits",
            "paired_presets", "custom_starter_kits", "custom_routing_rules"
        ]
        for config_key in keys_to_merge:
            if destinies_payload.has(config_key):
                package_payload[config_key] = destinies_payload[config_key]

    var raw_routing: Variant = _read_json_file(mod_directory.path_join("routing_rules.json"))
    if raw_routing is Dictionary:
        var routing_payload: Dictionary = raw_routing
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
        return _load_full_package_from_kmod(mod_directory)

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
    _scan_mod_i18n(mod_directory, custom_i18n)
    package_payload["custom_i18n"] = custom_i18n

    package_payload["root_path"] = mod_directory
    return package_payload

## 辅助函数：安全读取 .kmod 归档包内的 JSON 字典文件
static func _read_kmod_json_dict(reader: ZIPReader, entry_path: String) -> Dictionary:
    var raw: Variant = JSON.parse_string(reader.read_file(entry_path).get_string_from_utf8())
    return (raw as Dictionary) if (raw is Dictionary) else {}

## 辅助函数：将单个 .kmod 条目解析并装配至包聚合容器
static func _apply_kmod_entry(
    reader: ZIPReader,
    entry_path: String,
    package_payload: Dictionary,
    dag_graphs: Dictionary,
    custom_i18n: Dictionary
) -> void:
    if entry_path.begins_with("dag_graphs/") and entry_path.ends_with(".json"):
        var raw := _read_kmod_json_dict(reader, entry_path)
        if raw.is_empty():
            return
        var stem := entry_path.get_file().get_basename()
        var dag_id := str(raw.get("dag_id", raw.get("graph_id", stem)))
        dag_graphs[dag_id] = raw
    elif entry_path.begins_with("i18n/") and entry_path.ends_with(".json"):
        var raw := _read_kmod_json_dict(reader, entry_path)
        if not raw.is_empty():
            _flatten_i18n_dict(raw, "", custom_i18n)
    elif entry_path == "destinies.json":
        var raw := _read_kmod_json_dict(reader, entry_path)
        for config_key in ["ui_capabilities", "custom_origins", "custom_traits", "paired_presets", "custom_starter_kits", "custom_routing_rules"]:
            if raw.has(config_key):
                package_payload[config_key] = raw[config_key]
    elif entry_path == "routing_rules.json":
        var raw := _read_kmod_json_dict(reader, entry_path)
        var raw_rules: Variant = raw.get("custom_routing_rules", raw.get("routing_rules", []))
        if raw_rules is Array:
            var existing: Array = package_payload.get("custom_routing_rules", [])
            existing.append_array(raw_rules as Array)
            package_payload["custom_routing_rules"] = existing

## 从 .kmod 归档包完整读取并组装 MOD 数据字典
static func _load_full_package_from_kmod(kmod_path: String) -> Dictionary:
    var reader := ZIPReader.new()
    if reader.open(kmod_path) != OK:
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_FILE_READ_FAIL", TemplateFormatter.format("Failed to open .kmod archive package: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return {}
    var files := reader.get_files()
    var manifest_payload: Dictionary = {}
    if reader.file_exists("pack.json"):
        manifest_payload = _read_kmod_json_dict(reader, "pack.json")
    elif reader.file_exists("manifest.json"):
        manifest_payload = _read_kmod_json_dict(reader, "manifest.json")
    if manifest_payload.is_empty():
        reader.close()
        return {}
    var package_payload: Dictionary = manifest_payload.duplicate(true)
    var dag_graphs: Dictionary = package_payload.get("dag_graphs", {})
    var custom_i18n: Dictionary = package_payload.get("custom_i18n", {})
    for entry_path in files:
        _apply_kmod_entry(reader, entry_path, package_payload, dag_graphs, custom_i18n)
    reader.close()
    package_payload["dag_graphs"] = dag_graphs
    package_payload["custom_i18n"] = custom_i18n
    package_payload["root_path"] = kmod_path
    return package_payload

## 扫描三级级联目录并按拓扑排序顺序组装已安装的全量 MOD 包数组
static func scan_installed_full_mod_packages(custom_roots: Array = []) -> Array[Dictionary]:
    var installed_packs: Array[NarrativePackManifestDTO] = scan_installed_packs(custom_roots)
    var sort_result: Dictionary = sort_and_resolve_dependencies(installed_packs)

    var ordered_packs: Array = []
    if bool(sort_result.get("success", false)):
        ordered_packs = sort_result.get("sorted_packs", [])
    else:
        var error_code := str(sort_result.get("error", "CONFIG_VALIDATION_FAILED"))
        var error_message := TemplateFormatter.format("MOD dependency topological sort failed: {error}", {"error": error_code})
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_VALIDATION_FAILED", error_message, sort_result)
        ordered_packs = installed_packs

    var loaded_packages: Array[Dictionary] = []
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

    return loaded_packages
