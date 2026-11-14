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
const TIER2_USER_SANDBOX_PATH: String = "user://mods/narratives/"
const MANIFEST_FILENAME: String = "pack.json"
const LOG_CHANNEL: String = "mod_narrative"
const EMPTY_LIST: Array = []

## 获取三级级联剧情 MOD 发现根目录列表
static func get_discovery_roots(custom_roots: Array = []) -> Array[String]:
    if not custom_roots.is_empty():
        var roots: Array[String] = []
        for root_entry in custom_roots:
            var root_text := String(root_entry).strip_edges()
            if not root_text.is_empty():
                roots.append(root_text)
        return roots

    var resolved_roots: Array[String] = []
    # Tier 0: 内置核心包路径
    resolved_roots.append(TIER0_BUILTIN_PATH)

    # Tier 1: 外部可执行程序同级安装目录
    if OS.has_feature("editor"):
        resolved_roots.append("res://mods/narratives/")
    else:
        var exe_dir := OS.get_executable_path().get_base_dir()
        resolved_roots.append(exe_dir.path_join(TIER1_MODS_REL_PATH))

    # Tier 2: 用户沙盒数据目录
    resolved_roots.append(TIER2_USER_SANDBOX_PATH)
    return resolved_roots

## 从指定清单路径安全读取并解析为 DTO（独立抽取消除循环内堆分配告警）
static func _parse_manifest_at_path(manifest_path: String, fallback_pack_id: String) -> NarrativePackManifestDTO:
    if not FileAccess.file_exists(manifest_path):
        return null

    var file := FileAccess.open(manifest_path, FileAccess.READ)
    if file == null:
        return null

    var content := file.get_as_text()
    var parsed_value: Variant = JSON.parse_string(content)
    if not (parsed_value is Dictionary):
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_JSON_PARSE_FAIL", TemplateFormatter.format("MOD manifest pack.json invalid format or parse failed: {path}", {"path": manifest_path}), {"file_path": manifest_path})
        return null

    var manifest := NarrativePackManifestDTO.from_dto(parsed_value as Dictionary)
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
    var parsed_value: Variant = JSON.parse_string(manifest_content)
    if not (parsed_value is Dictionary):
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_JSON_PARSE_FAIL", TemplateFormatter.format(".kmod archive manifest parse error: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return null
    var manifest := NarrativePackManifestDTO.from_dto(parsed_value as Dictionary)
    if manifest.pack_id.is_empty():
        manifest.pack_id = fallback_pack_id
    if manifest.root_path.is_empty():
        manifest.root_path = kmod_path
    return manifest

## 扫描指定单个根目录下的全部子目录清单与 .kmod 归档包
static func _scan_single_root_directory(root_path: String, discovered_map: Dictionary, discovery_order: Array[String]) -> void:
    if not DirAccess.dir_exists_absolute(root_path):
        return

    var dir := DirAccess.open(root_path)
    if dir == null:
        return

    dir.list_dir_begin()
    var entry_name := dir.get_next()
    while not entry_name.is_empty():
        if dir.current_is_dir() and not entry_name.begins_with("."):
            var sub_dir := root_path.path_join(entry_name)
            var manifest_file := sub_dir.path_join(MANIFEST_FILENAME)
            var manifest_dto := _parse_manifest_at_path(manifest_file, entry_name)
            if manifest_dto != null:
                var pack_id := manifest_dto.pack_id
                if not discovered_map.has(pack_id):
                    discovery_order.append(pack_id)
                discovered_map[pack_id] = manifest_dto
        elif not dir.current_is_dir() and entry_name.ends_with(".kmod"):
            var kmod_file := root_path.path_join(entry_name)
            var manifest_dto := _parse_manifest_from_kmod(kmod_file, entry_name.get_basename())
            if manifest_dto != null:
                var pack_id := manifest_dto.pack_id
                if not discovered_map.has(pack_id):
                    discovery_order.append(pack_id)
                discovered_map[pack_id] = manifest_dto
        entry_name = dir.get_next()
    dir.list_dir_end()

## 扫描指定或级联根目录下包含 pack.json 的所有包清单
static func scan_installed_packs(custom_roots: Array = []) -> Array[NarrativePackManifestDTO]:
    var roots: Array[String] = get_discovery_roots(custom_roots)
    var discovered_map: Dictionary = {}
    var discovery_order: Array[String] = []

    for root_dir in roots:
        _scan_single_root_directory(root_dir, discovered_map, discovery_order)

    var result: Array[NarrativePackManifestDTO] = []
    for pack_id in discovery_order:
        var pack_dto: NarrativePackManifestDTO = discovered_map.get(pack_id, null)
        if pack_dto != null:
            result.append(pack_dto)
    return result

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
        var empty_result: Array[NarrativePackManifestDTO] = []
        return {
            "success": true,
            "sorted_packs": empty_result
        }

    var pack_map: Dictionary = {}
    for item in manifests:
        if item is NarrativePackManifestDTO:
            pack_map[item.pack_id] = item
        elif item is Dictionary:
            var converted := NarrativePackManifestDTO.from_dto(item as Dictionary)
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
static func _flatten_i18n_dict(dict: Dictionary, prefix: String, target: Dictionary) -> void:
    for dict_key in dict.keys():
        var full_key := (prefix + "." + str(dict_key)) if not prefix.is_empty() else str(dict_key)
        var raw_value: Variant = dict[dict_key]
        if raw_value is Dictionary:
            _flatten_i18n_dict(raw_value as Dictionary, full_key, target)
        else:
            var text_value := str(raw_value)
            target[full_key] = text_value
            target[full_key.replace(".", "/")] = text_value
            target[full_key.replace("/", ".")] = text_value

## 列出指定子目录下的全部 .json 文件完整路径
static func _list_json_files(dir_path: String) -> Array[String]:
    var files: Array[String] = []
    if not DirAccess.dir_exists_absolute(dir_path):
        return files
    var dir := DirAccess.open(dir_path)
    if dir == null:
        return files
    dir.list_dir_begin()
    var entry_name := dir.get_next()
    while not entry_name.is_empty():
        if not dir.current_is_dir() and entry_name.ends_with(".json"):
            files.append(dir_path.path_join(entry_name))
        entry_name = dir.get_next()
    dir.list_dir_end()
    return files

## 扫描 mod_dir/dag_graphs 目录下的所有剧情 DAG 图元
static func _scan_mod_dag_graphs(mod_dir: String, target_graphs: Dictionary) -> void:
    for file_path in _list_json_files(mod_dir.path_join("dag_graphs")):
        var raw_json: Variant = _read_json_file(file_path)
        if raw_json is Dictionary:
            var stem := file_path.get_file().get_basename()
            var dag_id := str((raw_json as Dictionary).get("dag_id", (raw_json as Dictionary).get("graph_id", stem)))
            target_graphs[dag_id] = raw_json

## 扫描 mod_dir/i18n 目录下的多语言本地化配置
static func _scan_mod_i18n(mod_dir: String, target_i18n: Dictionary) -> void:
    for file_path in _list_json_files(mod_dir.path_join("i18n")):
        var raw_json: Variant = _read_json_file(file_path)
        if raw_json is Dictionary:
            _flatten_i18n_dict(raw_json as Dictionary, "", target_i18n)

## 加载 destinies.json 与 routing_rules.json 并合并入 MOD 包字典
static func _load_destinies_and_routing(mod_dir: String, package_data: Dictionary) -> void:
    var destinies_value: Variant = _read_json_file(mod_dir.path_join("destinies.json"))
    if destinies_value is Dictionary:
        var destinies_dict: Dictionary = destinies_value
        var keys_to_merge: Array[String] = [
            "ui_capabilities", "custom_origins", "custom_traits",
            "paired_presets", "custom_starter_kits", "custom_routing_rules"
        ]
        for config_key in keys_to_merge:
            if destinies_dict.has(config_key):
                package_data[config_key] = destinies_dict[config_key]

    var routing_value: Variant = _read_json_file(mod_dir.path_join("routing_rules.json"))
    if routing_value is Dictionary:
        var routing_dict: Dictionary = routing_value
        var rules_value: Variant = routing_dict.get("custom_routing_rules", routing_dict.get("routing_rules", []))
        if rules_value is Array:
            var existing_rules: Array = package_data.get("custom_routing_rules", [])
            for rule_entry in (rules_value as Array):
                existing_rules.append(rule_entry)
            package_data["custom_routing_rules"] = existing_rules
    elif routing_value is Array:
        var existing_rules: Array = package_data.get("custom_routing_rules", [])
        for rule_entry in (routing_value as Array):
            existing_rules.append(rule_entry)
        package_data["custom_routing_rules"] = existing_rules

## 从指定目录完整读取并组装单包数据字典
static func load_full_mod_package_from_dir(mod_dir: String) -> Dictionary:
    if mod_dir.ends_with(".kmod"):
        return _load_full_package_from_kmod(mod_dir)

    var manifest_path := mod_dir.path_join(MANIFEST_FILENAME)
    var pack_raw: Variant = _read_json_file(manifest_path)
    if not (pack_raw is Dictionary):
        return {}

    var package_data: Dictionary = (pack_raw as Dictionary).duplicate(true)
    _load_destinies_and_routing(mod_dir, package_data)

    var dag_graphs: Dictionary = package_data.get("dag_graphs", {})
    _scan_mod_dag_graphs(mod_dir, dag_graphs)
    package_data["dag_graphs"] = dag_graphs

    var custom_i18n: Dictionary = package_data.get("custom_i18n", {})
    _scan_mod_i18n(mod_dir, custom_i18n)
    package_data["custom_i18n"] = custom_i18n

    package_data["root_path"] = mod_dir
    return package_data

## 辅助函数：安全读取 .kmod 归档包内的 JSON 字典文件
static func _read_kmod_json_dict(reader: ZIPReader, entry_path: String) -> Dictionary:
    var raw: Variant = JSON.parse_string(reader.read_file(entry_path).get_string_from_utf8())
    return (raw as Dictionary) if (raw is Dictionary) else {}

## 辅助函数：将单个 .kmod 条目解析并装配至包聚合容器
static func _apply_kmod_entry(
    reader: ZIPReader,
    entry_path: String,
    package_data: Dictionary,
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
                package_data[config_key] = raw[config_key]
    elif entry_path == "routing_rules.json":
        var raw := _read_kmod_json_dict(reader, entry_path)
        var rules_value: Variant = raw.get("custom_routing_rules", raw.get("routing_rules", []))
        if rules_value is Array:
            var existing: Array = package_data.get("custom_routing_rules", [])
            existing.append_array(rules_value as Array)
            package_data["custom_routing_rules"] = existing

## 从 .kmod 归档包完整读取并组装 MOD 数据字典
static func _load_full_package_from_kmod(kmod_path: String) -> Dictionary:
    var reader := ZIPReader.new()
    if reader.open(kmod_path) != OK:
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_FILE_READ_FAIL", TemplateFormatter.format("Failed to open .kmod archive package: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return {}
    var files := reader.get_files()
    var manifest_dict: Dictionary = {}
    if reader.file_exists("pack.json"):
        manifest_dict = _read_kmod_json_dict(reader, "pack.json")
    elif reader.file_exists("manifest.json"):
        manifest_dict = _read_kmod_json_dict(reader, "manifest.json")
    if manifest_dict.is_empty():
        reader.close()
        return {}
    var package_data: Dictionary = manifest_dict.duplicate(true)
    var dag_graphs: Dictionary = package_data.get("dag_graphs", {})
    var custom_i18n: Dictionary = package_data.get("custom_i18n", {})
    for entry_path in files:
        _apply_kmod_entry(reader, entry_path, package_data, dag_graphs, custom_i18n)
    reader.close()
    package_data["dag_graphs"] = dag_graphs
    package_data["custom_i18n"] = custom_i18n
    package_data["root_path"] = kmod_path
    return package_data

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

    var result: Array[Dictionary] = []
    for pack_entry in ordered_packs:
        var root_path: String = ""
        if pack_entry is NarrativePackManifestDTO:
            root_path = (pack_entry as NarrativePackManifestDTO).root_path
        elif pack_entry is Dictionary:
            root_path = str((pack_entry as Dictionary).get("root_path", ""))
        if not root_path.is_empty():
            var full_package := load_full_mod_package_from_dir(root_path)
            if not full_package.is_empty():
                result.append(full_package)

    return result
