# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/mod_precheck_and_adaptation_solver.gd
# 架构定位: Domain Logic Component / Precheck & List Adaptation Solver
# 依赖与触发: 上游: WorldGateway / Orchestrator / UI | 下游: DestinyModManifestDTO, GameConfig | 配置: config/domains/character_creation/core.json, config/domains/starter_loadout/core.json | 信号: 无
# 职责说明: 单机显性命途 MOD 合规预检与多包列表冲突适配引擎；执行单包数值预算与因果天平静态预检、多包互斥/同名ID/UI策略冲突裁决，以及基础池与多包清单式动态合并适配。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================
# 核心算法与架构不变量契约 (Architecture Invariants & Complexity Contracts):
# 1. Inv-DESTINY-PRECHECK-1 (单包数值与因果天平边界):
#    - 自定义身世单维属性修正必须处于 [-2, 3]，六维净代数和必须处于 [-2, 4]；
#    - 自定义身世与套件初始金币必须处于 [0, 1000]；
#    - 自定义正负因果天赋对必须满足 pos_cost > 0, neg_cost < 0 且 |pos_cost + neg_cost| <= 1；
#    - 自定义初始行囊单套物品总数必须 <= 10 且每项 canonical_id 非空。
# 2. Inv-DESTINY-CHECKLIST-2 (勾选启用隔离预检法则):
#    - 候选列表内所有 MOD 均生成静态预检条目 precheck_checklist；
#    - 仅当被玩家显式勾选启用 (或 "*" 全选) 的包存在违规时阻断返回 ERR_MOD_COMPLIANCE_FAILED，
#      未勾选的坏包仅标记不合规而不阻断其余合法勾选包运行。
# 3. Inv-DESTINY-CONFLICT-3 (多包零歧义冲突阻断):
#    - 启用包集合存在 incompatible_packs 双向互斥 -> 阻断返回 ERR_MOD_INCOMPATIBLE_CONFLICT；
#    - 启用包集合存在同名 origin_id / trait_id / kit_id -> 阻断返回 ERR_MOD_DUPLICATE_ID_CONFLICT；
#    - 启用包集合对同一 UI 控件同时声明 ALLOW_MANUAL 与 FORCE_RANDOM -> 阻断返回 ERR_MOD_UI_POLICY_CONFLICT。
# 4. Inv-DESTINY-ADAPT-4 (基础池与多包无损清单合并):
#    - 按列表顺序将 GameConfig 内置基础池与已启用合规包的自定义池无损拼接，
#      生成后端权威解算所需的 adapted_manifest 与前端视图消费的 creation_ui_snapshot。
# 5. 算法退化与空间复杂度边界:
#    - 单包与多包预检时间复杂度 O(P * (O + T + K))，采用预建哈希集合实现 O(1) 同名撞车判重，
#      循环体内严格遵守零瞬态堆分配契约 (ADV-PRF-002)。
# 6. 退出语义与返回信封契约 (Exit Semantics & Envelope Contract):
#    - precheck_single_mod 始终返回 {valid, is_compliant, pack_id, pack_name, error_code, errors, manifest}；
#    - precheck_and_adapt_mod_list 始终返回 {success, error_code, enabled_pack_ids, precheck_checklist,
#      conflicts, adapted_manifest, creation_ui_snapshot}，确保前端视图与网关状态机零空指针安全消费。
# ==============================================================================

## ModPrecheckAndAdaptationSolver：Domain Logic Component / Precheck & List Adaptation Solver
class_name ModPrecheckAndAdaptationSolver
extends RefCounted

const ModAdaptationManifestMerger = preload("res://backend/domains/character_creation/mod_adaptation_manifest_merger.gd")
const CreationUiSnapshotBuilder = preload("res://backend/domains/character_creation/creation_ui_snapshot_builder.gd")

# ==============================================================================
# 一、单包显性 MOD 合规性静态预检 (Single-Pack Compliance Precheck)
# - 输入: DestinyModManifestDTO 实例或原始 Dictionary (支持工程测试夹具零磁盘直传)
# - 输出: {valid, is_compliant, pack_id, pack_name, error_code, errors, manifest}
# - 前置不变式: 任何单项超限立即登记结构化错误码，绝不向后透传未验签数据
# ==============================================================================

## 校验单个命途 MOD 声明清单的预算边界、因果平衡与初始套件合法性（委托至 ModManifestValidator）
static func precheck_single_mod(manifest_input: Variant, base_manifest: Variant = null) -> Dictionary:
    return ModManifestValidator.precheck_single_mod(manifest_input, base_manifest)

# ==============================================================================
# 二、多包列表冲突检测与清单式合并适配 (Multi-Pack Conflict & Adaptation)
# - 输入: candidate_packs (候选包数组), enabled_pack_ids (勾选启用包 ID 列表，["*"] 代表全选)
# - 输出: {success, error_code, enabled_pack_ids, precheck_checklist, conflicts, adapted_manifest, creation_ui_snapshot}
# - 裁决顺序: 单包合规核验 -> 勾选集合规阻断 -> 互斥冲突 -> 同名ID撞车 -> UI策略冲突 -> 清单合并
# ==============================================================================

## 对候选 MOD 列表执行全量预检、按勾选列表过滤、检测多包冲突并输出合并后的适配清单与 UI 快照
static func precheck_and_adapt_mod_list(
    candidate_packs: Array,
    enabled_pack_ids: Array = ["*"]
) -> Dictionary:
    var enable_all: bool = enabled_pack_ids.has("*")
    var enabled_set: Dictionary = _build_enabled_lookup(enabled_pack_ids)

    var precheck_checklist: Array[Dictionary] = []
    var enabled_manifests: Array[DestinyModManifestDTO] = []
    var enabled_ids_out: Array[String] = []
    var has_non_compliant_enabled: bool = false

    for raw_pack in candidate_packs:
        var single_result: Dictionary = precheck_single_mod(raw_pack)
        var manifest_dto: DestinyModManifestDTO = single_result.get("manifest")
        var pack_id: String = manifest_dto.pack_id
        var is_enabled: bool = enable_all or (not pack_id.is_empty() and enabled_set.has(pack_id))
        var is_compliant: bool = bool(single_result.get("valid", false))

        var check_item: Dictionary = _build_checklist_item(single_result, is_compliant, is_enabled)
        precheck_checklist.append(check_item)

        if is_enabled:
            if not is_compliant:
                has_non_compliant_enabled = true
            else:
                enabled_manifests.append(manifest_dto)
                enabled_ids_out.append(pack_id)

    if has_non_compliant_enabled:
        return _build_adaptation_failure(
            "ERR_MOD_COMPLIANCE_FAILED",
            enabled_ids_out,
            precheck_checklist,
            []
        )

    var incompatible_conflicts: Array[Dictionary] = _detect_incompatible_conflicts(enabled_manifests, enabled_ids_out)
    if not incompatible_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_INCOMPATIBLE_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            incompatible_conflicts
        )

    var duplicate_conflicts: Array[Dictionary] = _detect_duplicate_id_conflicts(enabled_manifests)
    if not duplicate_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_DUPLICATE_ID_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            duplicate_conflicts
        )

    var ui_conflicts: Array[Dictionary] = _detect_ui_policy_conflicts(enabled_manifests)
    if not ui_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_UI_POLICY_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            ui_conflicts
        )

    var topology_conflicts: Array[Dictionary] = []
    var sorted_manifests: Array[DestinyModManifestDTO] = _topological_sort_manifests(enabled_manifests, topology_conflicts)
    if not topology_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_INCOMPATIBLE_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            topology_conflicts
        )

    var adapted_manifest: Dictionary = ModAdaptationManifestMerger.build_adapted_manifest(sorted_manifests, enabled_ids_out)
    var creation_ui_snapshot: Dictionary = CreationUiSnapshotBuilder.build_creation_ui_snapshot(
        adapted_manifest,
        precheck_checklist,
        enabled_ids_out
    )

    return {
        "success": true,
        "error_code": "",
        "enabled_pack_ids": enabled_ids_out,
        "precheck_checklist": precheck_checklist,
        "conflicts": [],
        "adapted_manifest": adapted_manifest,
        "creation_ui_snapshot": creation_ui_snapshot
    }

# ==============================================================================
# 三、多包冲突检测辅助方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _build_enabled_lookup(enabled_pack_ids: Array) -> Dictionary:
    var enabled_lookup: Dictionary = {}
    for item in enabled_pack_ids:
        var clean_id: String = str(item).strip_edges()
        if not clean_id.is_empty():
            enabled_lookup[clean_id] = true
    return enabled_lookup

static func _build_checklist_item(
    single_result: Dictionary,
    is_compliant: bool,
    is_enabled: bool
) -> Dictionary:
    return {
        "pack_id": str(single_result.get("pack_id", "")),
        "pack_name": str(single_result.get("pack_name", "")),
        "is_compliant": is_compliant,
        "is_enabled": is_enabled,
        "error_code": str(single_result.get("error_code", "")),
        "errors": (single_result.get("errors", []) as Array).duplicate(true)
    }

static func _build_adaptation_failure(
    error_code: String,
    enabled_ids: Array[String],
    checklist: Array[Dictionary],
    conflicts: Array[Dictionary]
) -> Dictionary:
    return {
        "success": false,
        "error_code": error_code,
        "enabled_pack_ids": enabled_ids,
        "precheck_checklist": checklist,
        "conflicts": conflicts,
        "adapted_manifest": {},
        "creation_ui_snapshot": {}
    }

static func _detect_incompatible_conflicts(
    enabled_manifests: Array[DestinyModManifestDTO],
    enabled_ids: Array[String]
) -> Array[Dictionary]:
    var conflicts: Array[Dictionary] = []
    var active_lookup: Dictionary = _build_enabled_lookup(enabled_ids)
    for manifest_dto in enabled_manifests:
        _check_pack_incompatibilities(manifest_dto, active_lookup, conflicts)
    return conflicts

static func _check_pack_incompatibilities(
    manifest_dto: DestinyModManifestDTO,
    active_lookup: Dictionary,
    conflicts: Array[Dictionary]
) -> void:
    for incompatible_id in manifest_dto.incompatible_packs:
        if active_lookup.has(incompatible_id):
            _append_conflict(
                conflicts,
                "ERR_MOD_INCOMPATIBLE_CONFLICT",
                manifest_dto.pack_id,
                incompatible_id,
                "启用包存在显式互斥声明: %s <-> %s" % [manifest_dto.pack_id, incompatible_id]
            )
    for dependency_id in manifest_dto.dependencies:
        if not active_lookup.has(dependency_id):
            _append_conflict(
                conflicts,
                "ERR_MOD_INCOMPATIBLE_CONFLICT",
                manifest_dto.pack_id,
                dependency_id,
                "启用包缺少前置依赖包: %s 需要 %s" % [manifest_dto.pack_id, dependency_id]
            )

static func _new_list() -> Array:
    return []

static func _record_dependencies(manifest_dto: DestinyModManifestDTO, manifest_by_pack_id: Dictionary, adjacency_map: Dictionary, in_degree: Dictionary) -> void:
    for dependency_id in manifest_dto.dependencies:
        if manifest_by_pack_id.has(dependency_id):
            adjacency_map[dependency_id].append(manifest_dto.pack_id)
            in_degree[manifest_dto.pack_id] = in_degree[manifest_dto.pack_id] + 1

static func _decrement_dependents(dependents: Array, in_degree: Dictionary, queue: Array[String]) -> void:
    for dependent_pack_id in dependents:
        in_degree[dependent_pack_id] = in_degree[dependent_pack_id] - 1
        if in_degree[dependent_pack_id] == 0:
            queue.append(dependent_pack_id)

static func _topological_sort_manifests(
    manifests: Array[DestinyModManifestDTO],
    conflicts: Array[Dictionary]
) -> Array[DestinyModManifestDTO]:
    if manifests.size() <= 1:
        return manifests

    var in_degree: Dictionary = {}
    var adjacency_map: Dictionary = {}
    var manifest_by_pack_id: Dictionary = {}

    for manifest_dto in manifests:
        manifest_by_pack_id[manifest_dto.pack_id] = manifest_dto
        in_degree[manifest_dto.pack_id] = 0
        adjacency_map[manifest_dto.pack_id] = _new_list()

    for manifest_dto in manifests:
        _record_dependencies(manifest_dto, manifest_by_pack_id, adjacency_map, in_degree)

    var queue: Array[String] = []
    for pack_id in in_degree.keys():
        if in_degree[pack_id] == 0:
            queue.append(pack_id)

    var sorted_out: Array[DestinyModManifestDTO] = []
    while not queue.is_empty():
        var source_pack_id: String = queue.pop_front()
        sorted_out.append(manifest_by_pack_id[source_pack_id])
        var dependents: Array = adjacency_map.get(source_pack_id, _new_list())
        _decrement_dependents(dependents, in_degree, queue)

    if sorted_out.size() < manifests.size():
        _append_conflict(
            conflicts,
            "ERR_MOD_INCOMPATIBLE_CONFLICT",
            manifests[0].pack_id,
            "",
            "已启用的 MOD 包集合中存在循环依赖死锁环"
        )
        return manifests

    return sorted_out

static func _detect_duplicate_id_conflicts(
    enabled_manifests: Array[DestinyModManifestDTO]
) -> Array[Dictionary]:
    var conflicts: Array[Dictionary] = []
    var seen_origins: Dictionary = {}
    var seen_traits: Dictionary = {}
    var seen_kits: Dictionary = {}

    for manifest_dto in enabled_manifests:
        _check_pack_duplicate_ids(manifest_dto, seen_origins, seen_traits, seen_kits, conflicts)

    return conflicts

static func _check_pack_duplicate_ids(
    manifest_dto: DestinyModManifestDTO,
    seen_origins: Dictionary,
    seen_traits: Dictionary,
    seen_kits: Dictionary,
    conflicts: Array[Dictionary]
) -> void:
    for origin_entry in manifest_dto.custom_origins:
        var origin_id: String = str(origin_entry.get("origin_id", "")).strip_edges()
        if not origin_id.is_empty():
            _record_or_conflict_id(origin_id, manifest_dto.pack_id, seen_origins, "origin_id", conflicts)

    for trait_id in manifest_dto.custom_traits.keys():
        var trait_key: String = str(trait_id).strip_edges()
        if not trait_key.is_empty():
            _record_or_conflict_id(trait_key, manifest_dto.pack_id, seen_traits, "trait_id", conflicts)

    for kit_id in manifest_dto.custom_starter_kits.keys():
        var kit_key: String = str(kit_id).strip_edges()
        if not kit_key.is_empty():
            _record_or_conflict_id(kit_key, manifest_dto.pack_id, seen_kits, "kit_id", conflicts)

static func _record_or_conflict_id(
    entity_id: String,
    pack_id: String,
    seen_map: Dictionary,
    id_kind: String,
    conflicts: Array[Dictionary]
) -> void:
    if seen_map.has(entity_id):
        var previous_pack_id: String = str(seen_map[entity_id])
        if previous_pack_id != pack_id:
            _append_conflict(
                conflicts,
                "ERR_MOD_DUPLICATE_ID_CONFLICT",
                previous_pack_id,
                pack_id,
                "多包定义了重复的 %s [%s]: %s vs %s" % [id_kind, entity_id, previous_pack_id, pack_id]
            )
    else:
        seen_map[entity_id] = pack_id

static func _detect_ui_policy_conflicts(
    enabled_manifests: Array[DestinyModManifestDTO]
) -> Array[Dictionary]:
    var conflicts: Array[Dictionary] = []
    var origin_manual_pack: String = ""
    var origin_random_pack: String = ""
    var trait_manual_pack: String = ""
    var trait_random_pack: String = ""

    for manifest_dto in enabled_manifests:
        var origin_mode: String = str(manifest_dto.ui_capabilities.get("origin_selection_mode", "INHERIT")).strip_edges()
        if origin_mode == "ALLOW_MANUAL" and origin_manual_pack.is_empty():
            origin_manual_pack = manifest_dto.pack_id
        elif origin_mode == "FORCE_RANDOM" and origin_random_pack.is_empty():
            origin_random_pack = manifest_dto.pack_id

        var trait_mode: String = str(manifest_dto.ui_capabilities.get("trait_selection_mode", "INHERIT")).strip_edges()
        if trait_mode == "ALLOW_MANUAL" and trait_manual_pack.is_empty():
            trait_manual_pack = manifest_dto.pack_id
        elif trait_mode == "FORCE_RANDOM" and trait_random_pack.is_empty():
            trait_random_pack = manifest_dto.pack_id

    if not origin_manual_pack.is_empty() and not origin_random_pack.is_empty():
        _append_conflict(
            conflicts,
            "ERR_MOD_UI_POLICY_CONFLICT",
            origin_manual_pack,
            origin_random_pack,
            "身世选择策略冲突 (ALLOW_MANUAL vs FORCE_RANDOM)"
        )

    if not trait_manual_pack.is_empty() and not trait_random_pack.is_empty():
        _append_conflict(
            conflicts,
            "ERR_MOD_UI_POLICY_CONFLICT",
            trait_manual_pack,
            trait_random_pack,
            "天赋选择策略冲突 (ALLOW_MANUAL vs FORCE_RANDOM)"
        )

    return conflicts

static func _append_conflict(
    conflicts: Array[Dictionary],
    code: String,
    first_pack_id: String,
    second_pack_id: String,
    message: String
) -> void:
    conflicts.append({
        "error_code": code,
        "pack_a": first_pack_id,
        "pack_b": second_pack_id,
        "message": message
    })
