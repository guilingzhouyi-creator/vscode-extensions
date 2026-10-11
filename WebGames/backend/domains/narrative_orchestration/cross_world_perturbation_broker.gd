# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/cross_world_perturbation_broker.gd
# 架构定位: Domain Service / Cross-World Perturbation Broker
# 跨域依赖: 上游: WorldGateway, NarrativeCausalityOrchestrator | 下游: GameConfig | 配置: config/domains/narrative_orchestration/core.json | 信号: EventBus 领域广播
# 职责说明: 管理跨世界因果虚空共鸣扰动的发布、过滤轮询、访问登记、物理原子落盘与半衰期衰减修剪
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name CrossWorldPerturbationBroker
extends RefCounted

const DEFAULT_LEDGER_PATH: String = "user://worlds/cross_world_perturbations.json"
const DEFAULT_HALF_LIFE_SECONDS: int = 86400
const DEFAULT_MAX_ENTRIES: int = 1000
const DEFAULT_MIN_RESONANCE: float = 0.01

static var _instance: CrossWorldPerturbationBroker = null

var _ledger_path: String = DEFAULT_LEDGER_PATH
var _default_decay_half_life: int = DEFAULT_HALF_LIFE_SECONDS
var _max_retained_entries: int = DEFAULT_MAX_ENTRIES
var _min_resonance_threshold: float = DEFAULT_MIN_RESONANCE
var _perturbations: Array[CrossWorldPerturbationDTO] = []
var _perturbations_by_id: Dictionary = {}
var _is_loaded: bool = false

## 获取单例实例
static func get_instance() -> CrossWorldPerturbationBroker:
    if _instance == null:
        _instance = CrossWorldPerturbationBroker.new()
    return _instance

## 测试环境全局单例与状态复位
static func reset_for_tests() -> void:
    if _instance != null:
        _instance.reset_broker()
    _instance = null

## 实例构造与配置参数预热
func _init() -> void:
    _default_decay_half_life = GameConfig.get_int(
        "domains.narrative_orchestration",
        "perturbation_broker/default_decay_half_life_seconds",
        DEFAULT_HALF_LIFE_SECONDS
    )
    _max_retained_entries = GameConfig.get_int(
        "domains.narrative_orchestration",
        "perturbation_broker/max_retained_entries",
        DEFAULT_MAX_ENTRIES
    )
    _min_resonance_threshold = GameConfig.get_float(
        "domains.narrative_orchestration",
        "perturbation_broker/min_resonance_threshold",
        DEFAULT_MIN_RESONANCE
    )
    _ledger_path = GameConfig.get_string(
        "domains.narrative_orchestration",
        "perturbation_broker/cross_world_file",
        DEFAULT_LEDGER_PATH
    )
    _load_ledger_from_disk()

## 设置自定义物理账本路径（支持无头测试沙盒隔离）
func set_custom_ledger_path(path: String) -> void:
    _ledger_path = path
    _perturbations.clear()
    _perturbations_by_id.clear()
    _is_loaded = false
    _load_ledger_from_disk()

## 重置 Broker 内存状态为默认配置
func reset_broker() -> void:
    _perturbations.clear()
    _perturbations_by_id.clear()
    _is_loaded = false
    _ledger_path = DEFAULT_LEDGER_PATH

## 计算半衰期衰减后的有效共鸣强度
static func calculate_decayed_resonance(original_resonance: float, emitted_timestamp: int, half_life_seconds: int, current_timestamp: int) -> float:
    if original_resonance <= 0.0:
        return 0.0
    var elapsed: int = current_timestamp - emitted_timestamp
    if elapsed <= 0:
        return original_resonance
    if half_life_seconds <= 0:
        return 0.0
    var half_lives: float = float(elapsed) / float(half_life_seconds)
    return original_resonance * pow(0.5, half_lives)

## 安全将 DTO 转为字典（独立函数消除循环体内堆分配）
func _dto_to_dict(p: CrossWorldPerturbationDTO) -> Dictionary:
    if p == null:
        return {}
    return p.to_dto()

## 安全将字典转为 DTO（独立函数消除循环体内堆分配）
func _dict_to_dto(d: Dictionary) -> CrossWorldPerturbationDTO:
    if d == null or d.is_empty():
        return null
    return CrossWorldPerturbationDTO.from_dto(d)

## 从物理磁盘加载扰动账本
func _load_ledger_from_disk() -> void:
    if _is_loaded:
        return
    _is_loaded = true

    if not FileAccess.file_exists(_ledger_path):
        return

    var file := FileAccess.open(_ledger_path, FileAccess.READ)
    if file == null:
        return

    var content := file.get_as_text()
    var parsed_val: Variant = JSON.parse_string(content)
    if not (parsed_val is Array):
        return

    var raw_list := parsed_val as Array
    for item in raw_list:
        if item is Dictionary:
            var dto := _dict_to_dto(item as Dictionary)
            if dto != null and not dto.perturbation_id.is_empty():
                _perturbations.append(dto)
                _perturbations_by_id[dto.perturbation_id] = dto

## 原子刷盘物理账本
func _flush_ledger_to_disk() -> bool:
    var serialized_items: Array[Dictionary] = []
    for p in _perturbations:
        var d := _dto_to_dict(p)
        if not d.is_empty():
            serialized_items.append(d)

    var json_text := JSON.stringify(serialized_items, "  ")
    var dir_path := _ledger_path.get_base_dir()
    if not dir_path.is_empty() and not DirAccess.dir_exists_absolute(dir_path):
        DirAccess.make_dir_recursive_absolute(dir_path)

    var tmp_path := _ledger_path + ".tmp"
    var file := FileAccess.open(tmp_path, FileAccess.WRITE)
    if file == null:
        return false

    file.store_string(json_text)
    file.close()

    if FileAccess.file_exists(_ledger_path):
        DirAccess.remove_absolute(_ledger_path)
    var err := DirAccess.rename_absolute(tmp_path, _ledger_path)
    return err == OK

## 发射因果虚空共鸣扰动
func emit_perturbation(perturbation: CrossWorldPerturbationDTO) -> Dictionary:
    if perturbation == null:
        return {"success": false, "error": "ERR_NULL_PERTURBATION"}
    if perturbation.perturbation_id.is_empty():
        return {"success": false, "error": "ERR_EMPTY_PERTURBATION_ID"}
    if perturbation.origin_world_id.is_empty():
        return {"success": false, "error": "ERR_EMPTY_ORIGIN_WORLD_ID"}

    var now_ts: int = int(Time.get_unix_time_from_system())
    if perturbation.emitted_timestamp_utc <= 0:
        perturbation.emitted_timestamp_utc = now_ts
    if perturbation.decay_half_life_seconds <= 0:
        perturbation.decay_half_life_seconds = _default_decay_half_life
    if perturbation.perturbation_seed == 0:
        perturbation.perturbation_seed = perturbation.perturbation_id.hash()

    if not perturbation.visited_world_ids.has(perturbation.origin_world_id):
        perturbation.visited_world_ids.append(perturbation.origin_world_id)

    var pid := perturbation.perturbation_id
    if _perturbations_by_id.has(pid):
        _perturbations_by_id[pid] = perturbation
        for i in range(_perturbations.size()):
            if _perturbations[i].perturbation_id == pid:
                _perturbations[i] = perturbation
                break
    else:
        _perturbations_by_id[pid] = perturbation
        _perturbations.append(perturbation)

    var flushed := _flush_ledger_to_disk()
    return {
        "success": true,
        "perturbation_id": pid,
        "flushed": flushed
    }

## 针对指定目标世界拉取有效扰动列表（过滤同世界、已访问及已完全衰减项）
func poll_perturbations_for_world(target_world_id: String) -> Array[CrossWorldPerturbationDTO]:
    if target_world_id.is_empty():
        var empty_list: Array[CrossWorldPerturbationDTO] = []
        return empty_list

    var now_ts: int = int(Time.get_unix_time_from_system())
    var eligible: Array[CrossWorldPerturbationDTO] = []

    for p in _perturbations:
        if p.origin_world_id == target_world_id:
            continue
        if p.visited_world_ids.has(target_world_id):
            continue

        var eff_res := calculate_decayed_resonance(
            p.resonance_intensity,
            p.emitted_timestamp_utc,
            p.decay_half_life_seconds,
            now_ts
        )
        if eff_res >= _min_resonance_threshold:
            eligible.append(p)

    return eligible

## 标记扰动已被目标世界访问
func mark_world_visited(perturbation_id: String, target_world_id: String) -> bool:
    if perturbation_id.is_empty() or target_world_id.is_empty():
        return false

    if not _perturbations_by_id.has(perturbation_id):
        return false

    var p: CrossWorldPerturbationDTO = _perturbations_by_id[perturbation_id]
    if not p.visited_world_ids.has(target_world_id):
        p.visited_world_ids.append(target_world_id)
        _flush_ledger_to_disk()
    return true

## 清理修剪已衰减至阈值以下或超出最大容量的扰动
func prune_decayed_perturbations() -> int:
    var now_ts: int = int(Time.get_unix_time_from_system())
    var retained: Array[CrossWorldPerturbationDTO] = []
    var pruned_count: int = 0

    for p in _perturbations:
        var eff_res := calculate_decayed_resonance(
            p.resonance_intensity,
            p.emitted_timestamp_utc,
            p.decay_half_life_seconds,
            now_ts
        )
        if eff_res >= _min_resonance_threshold:
            retained.append(p)
        else:
            pruned_count += 1

    if retained.size() > _max_retained_entries:
        var overflow_count: int = retained.size() - _max_retained_entries
        pruned_count += overflow_count
        retained.resize(_max_retained_entries)

    if pruned_count > 0:
        _perturbations = retained
        _perturbations_by_id.clear()
        for p in _perturbations:
            _perturbations_by_id[p.perturbation_id] = p
        _flush_ledger_to_disk()

    return pruned_count
