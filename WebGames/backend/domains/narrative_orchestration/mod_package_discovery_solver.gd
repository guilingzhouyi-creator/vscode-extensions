# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/mod_package_discovery_solver.gd
# 架构定位: Domain Service / Topological Discovery Solver
# 跨域依赖: 上游: WorldModAffinityManager, NarrativeCausalityOrchestrator | 下游: GameConfig | 配置: config/domains/narrative_orchestration/core.json | 信号: EventBus 领域广播
# 职责说明: 提供三级级联路径发现、多包清单元数据扫描与基于 Kahn 算法的 DAG 依赖拓扑排序解析
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name ModPackageDiscoverySolver
extends RefCounted

const TIER0_BUILTIN_PATH: String = "res://config/narratives/packs/"
const TIER1_MODS_REL_PATH: String = "mods/narratives/"
const TIER2_USER_SANDBOX_PATH: String = "user://mods/narratives/"
const MANIFEST_FILENAME: String = "pack.json"

## 获取三级级联剧情 MOD 发现根目录列表
static func get_discovery_roots(custom_roots: Array = []) -> Array[String]:
    if not custom_roots.is_empty():
        var roots: Array[String] = []
        for r in custom_roots:
            var r_str := String(r).strip_edges()
            if not r_str.is_empty():
                roots.append(r_str)
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
    var parsed_val: Variant = JSON.parse_string(content)
    if not (parsed_val is Dictionary):
        return null

    var dto := NarrativePackManifestDTO.from_dto(parsed_val as Dictionary)
    if dto.pack_id.is_empty():
        dto.pack_id = fallback_pack_id
    if dto.root_path.is_empty():
        dto.root_path = manifest_path.get_base_dir()

    return dto

## 扫描指定单个根目录下的全部子目录清单
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
                var pid := manifest_dto.pack_id
                if not discovered_map.has(pid):
                    discovery_order.append(pid)
                discovered_map[pid] = manifest_dto
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
    for pid in discovery_order:
        var pack_dto: NarrativePackManifestDTO = discovered_map.get(pid, null)
        if pack_dto != null:
            result.append(pack_dto)
    return result

## 检查清单集合中是否存在未满足的前置依赖
static func _find_missing_dependencies(pack_map: Dictionary) -> Array[String]:
    var missing_registry: Dictionary = {}
    for pid in pack_map.keys():
        var pack_obj: NarrativePackManifestDTO = pack_map[pid]
        for dep_id in pack_obj.dependencies:
            if not pack_map.has(dep_id):
                missing_registry[dep_id] = true

    var missing_list: Array[String] = []
    for m in missing_registry.keys():
        missing_list.append(String(m))
    missing_list.sort()
    return missing_list

## 构建依赖入度表与后继邻接表
static func _build_topology_tables(pack_map: Dictionary, in_degree: Dictionary, adj_list: Dictionary) -> void:
    for pid in pack_map.keys():
        in_degree[pid] = 0
        adj_list[pid] = []

    for pid in pack_map.keys():
        var pack_obj: NarrativePackManifestDTO = pack_map[pid]
        for dep_id in pack_obj.dependencies:
            in_degree[pid] = int(in_degree[pid]) + 1
            var successors: Array = adj_list[dep_id]
            successors.append(pid)

## 针对同一拓扑层级内的节点按优先级降序、包名升序进行稳定排序
static func _sort_tier_by_priority(tier: Array[NarrativePackManifestDTO]) -> void:
    tier.sort_custom(func(a: NarrativePackManifestDTO, b: NarrativePackManifestDTO) -> bool:
        if a.priority != b.priority:
            return a.priority > b.priority
        return a.pack_id < b.pack_id
    )

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
    var adj_list: Dictionary = {}
    _build_topology_tables(pack_map, in_degree, adj_list)

    var current_tier: Array[NarrativePackManifestDTO] = []
    for pid in pack_map.keys():
        if int(in_degree[pid]) == 0:
            current_tier.append(pack_map[pid])

    var sorted_packs: Array[NarrativePackManifestDTO] = []
    while not current_tier.is_empty():
        _sort_tier_by_priority(current_tier)
        var next_tier: Array[NarrativePackManifestDTO] = []
        for pack_obj in current_tier:
            sorted_packs.append(pack_obj)
            var successors: Array = adj_list[pack_obj.pack_id]
            for succ_id in successors:
                in_degree[succ_id] = int(in_degree[succ_id]) - 1
                if int(in_degree[succ_id]) == 0:
                    next_tier.append(pack_map[succ_id])
        current_tier = next_tier

    if sorted_packs.size() < pack_map.size():
        var cycles: Array[String] = []
        for pid in pack_map.keys():
            if int(in_degree[pid]) > 0:
                cycles.append(String(pid))
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
