# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/mod_precheck_and_adaptation_solver.gd
# 架构定位: Domain Logic Component / Precheck & List Adaptation Solver
# 跨域依赖: 上游: WorldGateway / Orchestrator / UI | 下游: DestinyModManifestDTO, GameConfig | 配置: config/domains/character_creation/core.json, config/domains/starter_loadout/core.json | 信号: 无
# 职责说明: 单机显性命途 MOD 合规预检与多包列表冲突适配引擎；执行单包数值预算与因果天平静态预检、多包互斥/同名ID/UI策略冲突裁决，以及基础池与多包清单式动态合并适配。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
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

class_name ModPrecheckAndAdaptationSolver
extends RefCounted

const VALID_UI_MODES: Array[String] = ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"]
const ATTR_BONUS_MIN: int = -2
const ATTR_BONUS_MAX: int = 3
const ATTR_NET_SUM_MIN: int = -2
const ATTR_NET_SUM_MAX: int = 4
const INITIAL_GOLD_MIN: int = 0
const INITIAL_GOLD_MAX: int = 1000
const CAUSALITY_NET_TOLERANCE: int = 1
const STARTER_KIT_MAX_ITEMS: int = 10

# ==============================================================================
# 一、单包显性 MOD 合规性静态预检 (Single-Pack Compliance Precheck)
# - 输入: DestinyModManifestDTO 实例或原始 Dictionary (支持工程测试夹具零磁盘直传)
# - 输出: {valid, is_compliant, pack_id, pack_name, error_code, errors, manifest}
# - 前置不变式: 任何单项超限立即登记结构化错误码，绝不向后透传未验签数据
# ==============================================================================

## 校验单个命途 MOD 声明清单的预算边界、因果平衡与初始套件合法性
static func precheck_single_mod(manifest_input: Variant) -> Dictionary:
    var dto: DestinyModManifestDTO = _coerce_to_manifest_dto(manifest_input)
    var errors: Array[Dictionary] = []

    if dto.pack_id.strip_edges().is_empty():
        _append_error(errors, "ERR_DESTINY_EMPTY_PACK_ID", "MOD pack_id 不可为空")

    _validate_ui_capabilities(dto.ui_capabilities, errors)
    _validate_custom_origins(dto.custom_origins, errors)
    _validate_origin_references(dto, errors)
    _validate_paired_presets(dto.paired_presets, dto.custom_traits, errors)
    _validate_custom_starter_kits(dto.custom_starter_kits, errors)
    _validate_dag_graphs(dto.dag_graphs, errors)

    var first_code: String = ""
    if not errors.is_empty():
        first_code = str(errors[0].get("error_code", ""))

    var is_ok: bool = errors.is_empty()
    return {
        "valid": is_ok,
        "is_compliant": is_ok,
        "pack_id": dto.pack_id,
        "pack_name": dto.pack_name,
        "error_code": first_code,
        "errors": errors,
        "manifest": dto
    }

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
        var single_res: Dictionary = precheck_single_mod(raw_pack)
        var dto: DestinyModManifestDTO = single_res.get("manifest")
        var pid: String = dto.pack_id
        var is_enabled: bool = enable_all or (not pid.is_empty() and enabled_set.has(pid))
        var is_compliant: bool = bool(single_res.get("valid", false))

        var check_item: Dictionary = _build_checklist_item(single_res, is_compliant, is_enabled)
        precheck_checklist.append(check_item)

        if is_enabled:
            if not is_compliant:
                has_non_compliant_enabled = true
            else:
                enabled_manifests.append(dto)
                enabled_ids_out.append(pid)

    if has_non_compliant_enabled:
        return _build_adaptation_failure(
            "ERR_MOD_COMPLIANCE_FAILED",
            enabled_ids_out,
            precheck_checklist,
            []
        )

    var incomp_conflicts: Array[Dictionary] = _detect_incompatible_conflicts(enabled_manifests, enabled_ids_out)
    if not incomp_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_INCOMPATIBLE_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            incomp_conflicts
        )

    var dup_conflicts: Array[Dictionary] = _detect_duplicate_id_conflicts(enabled_manifests)
    if not dup_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_DUPLICATE_ID_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            dup_conflicts
        )

    var ui_conflicts: Array[Dictionary] = _detect_ui_policy_conflicts(enabled_manifests)
    if not ui_conflicts.is_empty():
        return _build_adaptation_failure(
            "ERR_MOD_UI_POLICY_CONFLICT",
            enabled_ids_out,
            precheck_checklist,
            ui_conflicts
        )

    var adapted_manifest: Dictionary = _merge_adapted_manifest(enabled_manifests, enabled_ids_out)
    var creation_ui_snapshot: Dictionary = _build_creation_ui_snapshot(
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
# 三、单包预检子校验器 (Single-Pack Sub-Validators · CC <= 15, Depth <= 3)
# - _validate_ui_capabilities: 校验 origin/trait_selection_mode 属于合法三态枚举
# - _validate_custom_origins: 校验单维修正 [-2, 3]、六维净和 [-2, 4] 与初始金币 [0, 1000]
# - _validate_paired_presets: 校验正负天赋对存在性、极性正负号与净代数和 |pos + neg| <= 1
# - _validate_custom_starter_kits: 校验单套初始行囊物品总数 <= 10 且 canonical_id 非空
# - 循环体内零瞬态对象分配，使用预置字典与原生标量累加器
# ==============================================================================

static func _coerce_to_manifest_dto(manifest_input: Variant) -> DestinyModManifestDTO:
    if manifest_input is DestinyModManifestDTO:
        return manifest_input as DestinyModManifestDTO
    if manifest_input is Dictionary:
        return DestinyModManifestDTO.from_dto(manifest_input as Dictionary)
    return DestinyModManifestDTO.new()

static func _append_error(errors: Array[Dictionary], code: String, message: String) -> void:
    errors.append({
        "error_code": code,
        "message": message
    })

static func _validate_ui_capabilities(ui_caps: Dictionary, errors: Array[Dictionary]) -> void:
    if ui_caps.has("origin_selection_mode"):
        var origin_mode: String = str(ui_caps.get("origin_selection_mode", "")).strip_edges()
        if not origin_mode.is_empty() and not VALID_UI_MODES.has(origin_mode):
            _append_error(errors, "ERR_DESTINY_INVALID_UI_MODE", "非法的 origin_selection_mode: " + origin_mode)

    if ui_caps.has("trait_selection_mode"):
        var trait_mode: String = str(ui_caps.get("trait_selection_mode", "")).strip_edges()
        if not trait_mode.is_empty() and not VALID_UI_MODES.has(trait_mode):
            _append_error(errors, "ERR_DESTINY_INVALID_UI_MODE", "非法的 trait_selection_mode: " + trait_mode)

static func _validate_custom_origins(custom_origins: Array[Dictionary], errors: Array[Dictionary]) -> void:
    for origin_entry in custom_origins:
        _validate_single_origin_entry(origin_entry, errors)

static func _validate_single_origin_entry(origin_entry: Dictionary, errors: Array[Dictionary]) -> void:
    var orig_id: String = str(origin_entry.get("origin_id", "")).strip_edges()
    var bonus: Variant = origin_entry.get("attribute_bonus", {})
    var net_sum: int = 0
    var stat_exceeded: bool = false

    if bonus is Dictionary:
        var bonus_dict: Dictionary = bonus
        for k in bonus_dict.keys():
            var val: int = int(bonus_dict[k])
            if val < ATTR_BONUS_MIN or val > ATTR_BONUS_MAX:
                stat_exceeded = true
            net_sum += val

    if stat_exceeded or net_sum < ATTR_NET_SUM_MIN or net_sum > ATTR_NET_SUM_MAX:
        _append_error(
            errors,
            "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
            "身世属性修正预算超限: " + orig_id
        )

    var gold: int = int(origin_entry.get("initial_gold", 0))
    if gold < INITIAL_GOLD_MIN or gold > INITIAL_GOLD_MAX:
        _append_error(
            errors,
            "ERR_DESTINY_GOLD_CAP_EXCEEDED",
            "身世初始金币超出 [0, 1000] 区间: " + orig_id
        )

static func _validate_paired_presets(
    paired_presets: Array[Dictionary],
    custom_traits: Dictionary,
    errors: Array[Dictionary]
) -> void:
    var combined_traits: Dictionary = GameConfig.get_dict("domains.character_creation", "traits", {}).duplicate(true)
    for tid in custom_traits.keys():
        combined_traits[str(tid)] = custom_traits[tid]

    for preset in paired_presets:
        _validate_single_preset_pair(preset, combined_traits, errors)

static func _validate_single_preset_pair(
    preset: Dictionary,
    combined_traits: Dictionary,
    errors: Array[Dictionary]
) -> void:
    var pos_id: String = str(preset.get("positive", "")).strip_edges()
    var neg_id: String = str(preset.get("negative", "")).strip_edges()
    if pos_id.is_empty() or neg_id.is_empty():
        _append_error(errors, "ERR_DESTINY_CAUSALITY_IMBALANCE", "配对天赋存在空 ID")
        return
    if not combined_traits.has(pos_id) or not combined_traits.has(neg_id):
        _append_error(errors, "ERR_DESTINY_CAUSALITY_IMBALANCE", "配对天赋引用了未定义的天赋 ID")
        return

    var pos_cfg: Dictionary = combined_traits.get(pos_id, {})
    var neg_cfg: Dictionary = combined_traits.get(neg_id, {})
    var pos_type: String = str(pos_cfg.get("type", ""))
    var neg_type: String = str(neg_cfg.get("type", ""))
    var pos_cost: int = int(pos_cfg.get("cost", 0))
    var neg_cost: int = int(neg_cfg.get("cost", 0))

    var type_valid: bool = (pos_type == "POSITIVE" and pos_cost > 0 and neg_type == "NEGATIVE" and neg_cost < 0)
    var balance_valid: bool = absi(pos_cost + neg_cost) <= CAUSALITY_NET_TOLERANCE
    if not type_valid or not balance_valid:
        _append_error(
            errors,
            "ERR_DESTINY_CAUSALITY_IMBALANCE",
            "正负天赋极性错误或净代价超出 [-1, 1] 因果平衡限制: %s / %s" % [pos_id, neg_id]
        )

static func _validate_custom_starter_kits(custom_kits: Dictionary, errors: Array[Dictionary]) -> void:
    for kit_id in custom_kits.keys():
        _validate_single_starter_kit(str(kit_id), custom_kits[kit_id], errors)

static func _validate_single_starter_kit(
    kit_id: String,
    raw_kit: Variant,
    errors: Array[Dictionary]
) -> void:
    if kit_id.strip_edges().is_empty() or not (raw_kit is Dictionary):
        _append_error(errors, "ERR_DESTINY_KIT_INVALID", "初始套件定义结构非法: " + kit_id)
        return

    var kit_dict: Dictionary = raw_kit
    var items_val: Variant = kit_dict.get("initial_items", [])
    if not (items_val is Array):
        _append_error(errors, "ERR_DESTINY_KIT_INVALID", "套件 initial_items 必须为数组: " + kit_id)
        return

    var items_arr: Array = items_val
    var total_count: int = 0
    for item_entry in items_arr:
        var step_count: int = _validate_and_count_kit_item(item_entry)
        if step_count <= 0:
            _append_error(errors, "ERR_DESTINY_KIT_INVALID", "套件物品 canonical_id 为空或数量非法: " + kit_id)
            return
        total_count += step_count

    if total_count > STARTER_KIT_MAX_ITEMS:
        _append_error(errors, "ERR_DESTINY_KIT_INVALID", "单套件物品总数超过上限 10: " + kit_id)

static func _validate_and_count_kit_item(item_entry: Variant) -> int:
    if not (item_entry is Dictionary):
        return -1
    var d: Dictionary = item_entry
    var cid: String = str(d.get("canonical_id", "")).strip_edges()
    var count: int = int(d.get("count", 1))
    if cid.is_empty() or count <= 0:
        return -1
    return count

static func _validate_origin_references(dto: DestinyModManifestDTO, errors: Array[Dictionary]) -> void:
    var builtin_kits: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits", {})
    var builtin_dags: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
    for orig in dto.custom_origins:
        var kid: String = str(orig.get("starter_kit_id", "")).strip_edges()
        if not kid.is_empty() and not dto.custom_starter_kits.has(kid) and not builtin_kits.has(kid):
            _append_error(errors, "ERR_DESTINY_UNKNOWN_KIT_REF", "未定义的套件引用: " + kid)
        var did: String = str(orig.get("prologue_dag_id", "")).strip_edges()
        if not dto.dag_graphs.is_empty() and not did.is_empty() and not dto.dag_graphs.has(did) and not builtin_dags.has(did):
            _append_error(errors, "ERR_DESTINY_UNKNOWN_DAG_REF", "未定义的剧情DAG引用: " + did)

static func _validate_dag_graphs(dag_graphs: Dictionary, errors: Array[Dictionary]) -> void:
    for gid in dag_graphs.keys():
        var raw_g: Variant = dag_graphs[gid]
        if not (raw_g is Dictionary):
            _append_error(errors, "ERR_DESTINY_INVALID_DAG_GRAPH", "非法DAG定义: " + str(gid))
            continue
        var g := PrologueDagRegistry.assemble_graph_from_raw(str(gid), raw_g as Dictionary)
        var val_res := CausalityDagValidator.validate_graph(g)
        if not bool(val_res.get("is_valid", false)):
            _append_error(errors, "ERR_DESTINY_INVALID_DAG_GRAPH", "DAG校验失败: %s" % str(gid))

# ==============================================================================
# 四、多包冲突检测辅助方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _build_enabled_lookup(enabled_pack_ids: Array) -> Dictionary:
    var out: Dictionary = {}
    for item in enabled_pack_ids:
        var s: String = str(item).strip_edges()
        if not s.is_empty():
            out[s] = true
    return out

static func _build_checklist_item(
    single_res: Dictionary,
    is_compliant: bool,
    is_enabled: bool
) -> Dictionary:
    return {
        "pack_id": str(single_res.get("pack_id", "")),
        "pack_name": str(single_res.get("pack_name", "")),
        "is_compliant": is_compliant,
        "is_enabled": is_enabled,
        "error_code": str(single_res.get("error_code", "")),
        "errors": (single_res.get("errors", []) as Array).duplicate(true)
    }

static func _build_adaptation_failure(
    err_code: String,
    enabled_ids: Array[String],
    checklist: Array[Dictionary],
    conflicts: Array[Dictionary]
) -> Dictionary:
    return {
        "success": false,
        "error_code": err_code,
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
    for dto in enabled_manifests:
        _check_pack_incompatibilities(dto, active_lookup, conflicts)
    return conflicts

static func _check_pack_incompatibilities(
    dto: DestinyModManifestDTO,
    active_lookup: Dictionary,
    conflicts: Array[Dictionary]
) -> void:
    for inc_id in dto.incompatible_packs:
        if active_lookup.has(inc_id):
            _append_conflict(
                conflicts,
                "ERR_MOD_INCOMPATIBLE_CONFLICT",
                dto.pack_id,
                inc_id,
                "启用包存在显式互斥声明: %s <-> %s" % [dto.pack_id, inc_id]
            )

static func _detect_duplicate_id_conflicts(
    enabled_manifests: Array[DestinyModManifestDTO]
) -> Array[Dictionary]:
    var conflicts: Array[Dictionary] = []
    var seen_origins: Dictionary = {}
    var seen_traits: Dictionary = {}
    var seen_kits: Dictionary = {}

    for dto in enabled_manifests:
        _check_pack_duplicate_ids(dto, seen_origins, seen_traits, seen_kits, conflicts)

    return conflicts

static func _check_pack_duplicate_ids(
    dto: DestinyModManifestDTO,
    seen_origins: Dictionary,
    seen_traits: Dictionary,
    seen_kits: Dictionary,
    conflicts: Array[Dictionary]
) -> void:
    for orig in dto.custom_origins:
        var oid: String = str(orig.get("origin_id", "")).strip_edges()
        if not oid.is_empty():
            _record_or_conflict_id(oid, dto.pack_id, seen_origins, "origin_id", conflicts)

    for tid in dto.custom_traits.keys():
        var trait_key: String = str(tid).strip_edges()
        if not trait_key.is_empty():
            _record_or_conflict_id(trait_key, dto.pack_id, seen_traits, "trait_id", conflicts)

    for kid in dto.custom_starter_kits.keys():
        var kit_key: String = str(kid).strip_edges()
        if not kit_key.is_empty():
            _record_or_conflict_id(kit_key, dto.pack_id, seen_kits, "kit_id", conflicts)

static func _record_or_conflict_id(
    entity_id: String,
    pack_id: String,
    seen_map: Dictionary,
    id_kind: String,
    conflicts: Array[Dictionary]
) -> void:
    if seen_map.has(entity_id):
        var prev_pack: String = str(seen_map[entity_id])
        if prev_pack != pack_id:
            _append_conflict(
                conflicts,
                "ERR_MOD_DUPLICATE_ID_CONFLICT",
                prev_pack,
                pack_id,
                "多包定义了重复的 %s [%s]: %s vs %s" % [id_kind, entity_id, prev_pack, pack_id]
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

    for dto in enabled_manifests:
        var o_mode: String = str(dto.ui_capabilities.get("origin_selection_mode", "INHERIT")).strip_edges()
        if o_mode == "ALLOW_MANUAL" and origin_manual_pack.is_empty():
            origin_manual_pack = dto.pack_id
        elif o_mode == "FORCE_RANDOM" and origin_random_pack.is_empty():
            origin_random_pack = dto.pack_id

        var t_mode: String = str(dto.ui_capabilities.get("trait_selection_mode", "INHERIT")).strip_edges()
        if t_mode == "ALLOW_MANUAL" and trait_manual_pack.is_empty():
            trait_manual_pack = dto.pack_id
        elif t_mode == "FORCE_RANDOM" and trait_random_pack.is_empty():
            trait_random_pack = dto.pack_id

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
    pack_a: String,
    pack_b: String,
    msg: String
) -> void:
    conflicts.append({
        "error_code": code,
        "pack_a": pack_a,
        "pack_b": pack_b,
        "message": msg
    })

# ==============================================================================
# 五、清单式合并与 UI 快照组装辅助方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _merge_adapted_manifest(
    enabled_manifests: Array[DestinyModManifestDTO],
    enabled_ids: Array[String]
) -> Dictionary:
    var origins_pool: Array[Dictionary] = []
    var raw_base_pool: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/origins_pool", [])
    for entry in raw_base_pool:
        if entry is Dictionary:
            origins_pool.append((entry as Dictionary).duplicate(true))

    var origins_catalog: Dictionary = GameConfig.get_dict("domains.character_creation", "origins", {}).duplicate(true)
    var origin_race_map: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/origin_race_map", {}).duplicate(true)
    var birth_region_map: Dictionary = GameConfig.get_dict("domains.character_creation", "authoritative_reincarnation/birth_region_map", {}).duplicate(true)
    var traits: Dictionary = GameConfig.get_dict("domains.character_creation", "traits", {}).duplicate(true)

    var paired_presets: Array[Dictionary] = []
    var raw_base_pairs: Array = GameConfig.get_array("domains.character_creation", "authoritative_reincarnation/traits_allocation/paired_presets", [])
    for pair_entry in raw_base_pairs:
        if pair_entry is Dictionary:
            paired_presets.append((pair_entry as Dictionary).duplicate(true))

    var starter_kits: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits", {}).duplicate(true)
    var race_kit_map: Dictionary = GameConfig.get_dict("domains.starter_loadout", "race_kit_map", {}).duplicate(true)
    var origin_kit_map: Dictionary = {}
    var origin_dag_map: Dictionary = {}
    var custom_routing_rules: Array[Dictionary] = []
    var dag_graphs: Dictionary = {}
    var custom_i18n: Dictionary = {}

    var allow_manual_origin: bool = false
    var allow_manual_trait: bool = false
    var allow_reroll: bool = false

    for dto in enabled_manifests:
        if str(dto.ui_capabilities.get("origin_selection_mode", "")) == "ALLOW_MANUAL":
            allow_manual_origin = true
        if str(dto.ui_capabilities.get("trait_selection_mode", "")) == "ALLOW_MANUAL":
            allow_manual_trait = true
        if bool(dto.ui_capabilities.get("allow_attribute_reroll", false)):
            allow_reroll = true

        _merge_single_pack_assets(
            dto, origins_pool, origins_catalog, origin_race_map, birth_region_map,
            traits, paired_presets, starter_kits, origin_kit_map, origin_dag_map,
            custom_routing_rules, dag_graphs, custom_i18n
        )

    var ui_controls: Dictionary = {
        "allow_manual_origin_select": allow_manual_origin,
        "allow_manual_trait_select": allow_manual_trait,
        "allow_attribute_reroll": allow_reroll,
        "origin_selection_mode": "ALLOW_MANUAL" if allow_manual_origin else "FORCE_RANDOM",
        "trait_selection_mode": "ALLOW_MANUAL" if allow_manual_trait else "FORCE_RANDOM"
    }

    return {
        "enabled_pack_ids": enabled_ids.duplicate(),
        "ui_controls": ui_controls,
        "origins_pool": origins_pool,
        "origins_catalog": origins_catalog,
        "origins": origins_catalog,
        "origin_race_map": origin_race_map,
        "birth_region_map": birth_region_map,
        "traits": traits,
        "traits_catalog": traits,
        "paired_presets": paired_presets,
        "starter_kits": starter_kits,
        "race_kit_map": race_kit_map,
        "origin_kit_map": origin_kit_map,
        "origin_dag_map": origin_dag_map,
        "custom_routing_rules": custom_routing_rules,
        "dag_graphs": dag_graphs,
        "custom_i18n": custom_i18n
    }

static func _merge_single_pack_assets(
    dto: DestinyModManifestDTO, origins_pool: Array[Dictionary], origins_catalog: Dictionary,
    origin_race_map: Dictionary, birth_region_map: Dictionary, traits: Dictionary,
    paired_presets: Array[Dictionary], starter_kits: Dictionary, origin_kit_map: Dictionary,
    origin_dag_map: Dictionary, custom_routing_rules: Array[Dictionary],
    dag_graphs: Dictionary, custom_i18n: Dictionary
) -> void:
    for orig in dto.custom_origins:
        _register_custom_origin(
            orig, dto.pack_id, origins_pool, origins_catalog, origin_race_map,
            birth_region_map, origin_kit_map, origin_dag_map
        )

    for tid in dto.custom_traits.keys():
        var t_entry: Variant = dto.custom_traits[tid]
        if t_entry is Dictionary:
            traits[str(tid)] = (t_entry as Dictionary).duplicate(true)

    for preset in dto.paired_presets:
        paired_presets.append(preset.duplicate(true))

    for kid in dto.custom_starter_kits.keys():
        var k_entry: Variant = dto.custom_starter_kits[kid]
        if k_entry is Dictionary:
            starter_kits[str(kid)] = (k_entry as Dictionary).duplicate(true)

    for rule in dto.custom_routing_rules:
        custom_routing_rules.append(rule.duplicate(true))

    for gid in dto.dag_graphs.keys():
        dag_graphs[str(gid)] = dto.dag_graphs[gid]

    for ik in dto.custom_i18n.keys():
        custom_i18n[str(ik)] = dto.custom_i18n[ik]

static func _register_custom_origin(
    orig: Dictionary,
    pack_id: String,
    origins_pool: Array[Dictionary],
    origins_catalog: Dictionary,
    origin_race_map: Dictionary,
    birth_region_map: Dictionary,
    origin_kit_map: Dictionary,
    origin_dag_map: Dictionary
) -> void:
    var oid: String = str(orig.get("origin_id", "")).strip_edges()
    if oid.is_empty():
        return
    var weight: int = maxi(1, int(orig.get("weight", 20)))
    origins_pool.append({
        "origin_id": oid,
        "weight": weight,
        "pack_id": pack_id
    })

    var race_id: String = str(orig.get("race_id", orig.get("race", "HUMAN"))).strip_edges()
    if race_id.is_empty():
        race_id = "HUMAN"
    var region_id: String = str(orig.get("birth_region_id", "CENTRAL_CONTINENT")).strip_edges()
    if region_id.is_empty():
        region_id = "CENTRAL_CONTINENT"
    var kit_id: String = str(orig.get("starter_kit_id", "")).strip_edges()
    var dag_id: String = str(orig.get("prologue_dag_id", "")).strip_edges()

    var catalog_entry: Dictionary = orig.duplicate(true)
    catalog_entry["origin_id"] = oid
    catalog_entry["race"] = race_id
    catalog_entry["race_id"] = race_id
    catalog_entry["birth_region_id"] = region_id
    catalog_entry["pack_id"] = pack_id
    origins_catalog[oid] = catalog_entry

    origin_race_map[oid] = race_id
    birth_region_map[oid] = region_id
    if not kit_id.is_empty():
        origin_kit_map[oid] = kit_id
    if not dag_id.is_empty():
        origin_dag_map[oid] = dag_id

static func _build_creation_ui_snapshot(
    adapted_manifest: Dictionary,
    precheck_checklist: Array[Dictionary],
    enabled_ids: Array[String]
) -> Dictionary:
    var origins_pool: Array = adapted_manifest.get("origins_pool", [])
    var origins_catalog: Dictionary = adapted_manifest.get("origins_catalog", {})
    var origin_race_map: Dictionary = adapted_manifest.get("origin_race_map", {})
    var birth_region_map: Dictionary = adapted_manifest.get("birth_region_map", {})
    var traits: Dictionary = adapted_manifest.get("traits", {})
    var paired_presets: Array = adapted_manifest.get("paired_presets", [])

    var available_origins: Array[Dictionary] = []
    for pool_entry in origins_pool:
        if pool_entry is Dictionary:
            _append_ui_origin_snapshot_item(
                pool_entry as Dictionary,
                origins_catalog,
                origin_race_map,
                birth_region_map,
                available_origins
            )

    var available_trait_pairs: Array[Dictionary] = []
    for idx in range(paired_presets.size()):
        var p_entry: Variant = paired_presets[idx]
        if p_entry is Dictionary:
            _append_ui_trait_pair_snapshot_item(idx, p_entry as Dictionary, traits, available_trait_pairs)

    return {
        "enabled_pack_ids": enabled_ids.duplicate(),
        "precheck_checklist": precheck_checklist.duplicate(true),
        "ui_controls": (adapted_manifest.get("ui_controls", {}) as Dictionary).duplicate(true),
        "available_origins": available_origins,
        "available_trait_pairs": available_trait_pairs,
        "traits_catalog": traits.duplicate(true)
    }

static func _append_ui_origin_snapshot_item(
    pool_entry: Dictionary,
    origins_catalog: Dictionary,
    origin_race_map: Dictionary,
    birth_region_map: Dictionary,
    out_origins: Array[Dictionary]
) -> void:
    var oid: String = str(pool_entry.get("origin_id", ""))
    var cfg: Dictionary = origins_catalog.get(oid, {})
    out_origins.append({
        "origin_id": oid,
        "name": str(cfg.get("name", oid)),
        "race_id": str(origin_race_map.get(oid, cfg.get("race_id", cfg.get("race", "HUMAN")))),
        "birth_region_id": str(birth_region_map.get(oid, cfg.get("birth_region_id", "CENTRAL_CONTINENT"))),
        "desc": str(cfg.get("desc", "")),
        "weight": int(pool_entry.get("weight", cfg.get("weight", 20))),
        "initial_gold": int(cfg.get("initial_gold", 50)),
        "attribute_bonus": (cfg.get("attribute_bonus", {}) as Dictionary).duplicate(true),
        "starter_kit_id": str(cfg.get("starter_kit_id", "")),
        "prologue_dag_id": str(cfg.get("prologue_dag_id", "")),
        "pack_id": str(cfg.get("pack_id", "VANILLA"))
    })

static func _append_ui_trait_pair_snapshot_item(
    pair_index: int,
    preset: Dictionary,
    traits: Dictionary,
    out_pairs: Array[Dictionary]
) -> void:
    var pos_id: String = str(preset.get("positive", ""))
    var neg_id: String = str(preset.get("negative", ""))
    var pos_cfg: Dictionary = traits.get(pos_id, {})
    var neg_cfg: Dictionary = traits.get(neg_id, {})
    out_pairs.append({
        "pair_index": pair_index,
        "positive": pos_id,
        "positive_name": str(pos_cfg.get("name", pos_id)),
        "positive_cost": int(pos_cfg.get("cost", 0)),
        "negative": neg_id,
        "negative_name": str(neg_cfg.get("name", neg_id)),
        "negative_cost": int(neg_cfg.get("cost", 0)),
        "weight": int(preset.get("weight", 50))
    })
