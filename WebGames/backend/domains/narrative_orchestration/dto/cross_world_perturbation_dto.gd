# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/dto/cross_world_perturbation_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: CrossWorldPerturbationBroker, WorldGateway | 下游: GameConfig | 配置: config/domains/narrative_orchestration/core.json | 信号: EventBus 领域广播
# 职责说明: 封装跨世界因果虚空共鸣扰动载荷（源世界、半衰期、共鸣强度、语义标签及已访问世界索引）
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CrossWorldPerturbationDTO：Value Object DTO / Data Transport Model
class_name CrossWorldPerturbationDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

var perturbation_id: String = ""
var origin_world_id: String = ""
var emitted_timestamp_utc: int = 0
var resonance_intensity: float = 1.0
var decay_half_life_seconds: int = 86400
var semantic_tags: Array[String] = []
var flavor_i18n_key: String = ""
var perturbation_seed: int = 0
var visited_world_ids: Array[String] = []

## 重置实例状态为初始默认值
func reset_state() -> void:
    super.reset_state()
    perturbation_id = ""
    origin_world_id = ""
    emitted_timestamp_utc = 0
    resonance_intensity = 1.0
    decay_half_life_seconds = 86400
    semantic_tags.clear()
    flavor_i18n_key = ""
    perturbation_seed = 0
    visited_world_ids.clear()

## 序列化为传输字典
func to_dto() -> Dictionary:
    var tags_copy: Array[String] = []
    tags_copy.assign(semantic_tags.duplicate())

    var visited_copy: Array[String] = []
    visited_copy.assign(visited_world_ids.duplicate())

    return {
        "perturbation_id": perturbation_id,
        "origin_world_id": origin_world_id,
        "emitted_timestamp_utc": emitted_timestamp_utc,
        "resonance_intensity": resonance_intensity,
        "decay_half_life_seconds": decay_half_life_seconds,
        "semantic_tags": tags_copy,
        "flavor_i18n_key": flavor_i18n_key,
        "perturbation_seed": perturbation_seed,
        "visited_world_ids": visited_copy
    }

## 从字典安全反序列化为 CrossWorldPerturbationDTO 实例
static func from_dto(serialized_payload: Dictionary) -> CrossWorldPerturbationDTO:
    var perturbation := CrossWorldPerturbationDTO.new()
    if serialized_payload == null or serialized_payload.is_empty():
        return perturbation

    perturbation.perturbation_id = String(serialized_payload.get("perturbation_id", ""))
    perturbation.origin_world_id = String(serialized_payload.get("origin_world_id", ""))
    perturbation.emitted_timestamp_utc = int(serialized_payload.get("emitted_timestamp_utc", 0))
    perturbation.resonance_intensity = float(serialized_payload.get("resonance_intensity", 1.0))
    perturbation.decay_half_life_seconds = int(serialized_payload.get("decay_half_life_seconds", 86400))
    perturbation.flavor_i18n_key = String(serialized_payload.get("flavor_i18n_key", ""))
    perturbation.perturbation_seed = int(serialized_payload.get("perturbation_seed", 0))

    var raw_tags: Variant = serialized_payload.get("semantic_tags", [])
    if raw_tags is Array:
        for tag in raw_tags:
            perturbation.semantic_tags.append(String(tag))

    var raw_visited: Variant = serialized_payload.get("visited_world_ids", [])
    if raw_visited is Array:
        for visited_world_id in raw_visited:
            perturbation.visited_world_ids.append(String(visited_world_id))

    return perturbation
