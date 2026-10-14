# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/dto/narrative_pack_manifest_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: ModPackageDiscoverySolver, WorldModAffinityManager | 下游: GameConfig | 配置: config/domains/narrative_orchestration/core.json | 信号: EventBus 领域广播
# 职责说明: 封装剧情 MOD 扩展包清单元数据契约（标识、版本、依赖拓扑、优先级与语义标签）
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## NarrativePackManifestDTO：Value Object DTO / Data Transport Model
class_name NarrativePackManifestDTO
extends RefCounted

var pack_id: String = ""
var pack_name: String = ""
var version: String = ""
var author: String = ""
var engine_api_version: String = ""
var priority: int = 100
var dependencies: Array[String] = []
var incompatible_packs: Array[String] = []
var semantic_tags: Array[String] = []
var root_path: String = ""
var is_active: bool = true

## 重置实例状态为初始默认值
func reset_state() -> void:
    pack_id = ""
    pack_name = ""
    version = ""
    author = ""
    engine_api_version = ""
    priority = 100
    dependencies.clear()
    incompatible_packs.clear()
    semantic_tags.clear()
    root_path = ""
    is_active = true

## 序列化为传输字典
func to_dto() -> Dictionary:
    var deps_copy: Array[String] = []
    deps_copy.assign(dependencies.duplicate())

    var incomp_copy: Array[String] = []
    incomp_copy.assign(incompatible_packs.duplicate())

    var tags_copy: Array[String] = []
    tags_copy.assign(semantic_tags.duplicate())

    return {
        "pack_id": pack_id,
        "pack_name": pack_name,
        "version": version,
        "author": author,
        "engine_api_version": engine_api_version,
        "priority": priority,
        "dependencies": deps_copy,
        "incompatible_packs": incomp_copy,
        "semantic_tags": tags_copy,
        "root_path": root_path,
        "is_active": is_active
    }

## 从字典安全反序列化为 NarrativePackManifestDTO 实例
static func from_dto(d: Dictionary) -> NarrativePackManifestDTO:
    var dto := NarrativePackManifestDTO.new()
    if d == null or d.is_empty():
        return dto

    dto.pack_id = String(d.get("pack_id", ""))
    dto.pack_name = String(d.get("pack_name", ""))
    dto.version = String(d.get("version", ""))
    dto.author = String(d.get("author", ""))
    dto.engine_api_version = String(d.get("engine_api_version", ""))
    dto.priority = int(d.get("priority", 100))
    dto.root_path = String(d.get("root_path", ""))
    dto.is_active = bool(d.get("is_active", true))

    var raw_deps = d.get("dependencies", [])
    if raw_deps is Array:
        for dep in raw_deps:
            dto.dependencies.append(String(dep))

    var raw_incomp = d.get("incompatible_packs", [])
    if raw_incomp is Array:
        for incomp in raw_incomp:
            dto.incompatible_packs.append(String(incomp))

    var raw_tags = d.get("semantic_tags", [])
    if raw_tags is Array:
        for tag in raw_tags:
            dto.semantic_tags.append(String(tag))

    return dto
