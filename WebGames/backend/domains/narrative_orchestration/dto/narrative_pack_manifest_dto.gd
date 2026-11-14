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
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

var pack_id: String = ""
var pack_name: String = ""
var version: String = ""
var author: String = ""
var engine_api_version: String = ""
var tier: String = "TIER_1_LOGIC"
var pack_profile: String = "CONTENT_ADDON"
var is_official: bool = false
var trust_tier: String = "COMMUNITY"
var content_sha256: String = ""
var publisher_signature: String = ""
var provided_domains: Array[String] = []
var has_prologue_dag: bool = true
var priority: int = 100
var dependencies: Array[String] = []
var incompatible_packs: Array[String] = []
var semantic_tags: Array[String] = []
var root_path: String = ""
var is_active: bool = true

## 重置实例状态为初始默认值
func reset_state() -> void:
    super.reset_state()
    pack_id = ""
    pack_name = ""
    version = ""
    author = ""
    engine_api_version = ""
    tier = "TIER_1_LOGIC"
    pack_profile = "CONTENT_ADDON"
    is_official = false
    trust_tier = "COMMUNITY"
    content_sha256 = ""
    publisher_signature = ""
    provided_domains.clear()
    has_prologue_dag = true
    priority = 100
    dependencies.clear()
    incompatible_packs.clear()
    semantic_tags.clear()
    root_path = ""
    is_active = true

## 序列化为传输字典
func to_dto() -> Dictionary:
    var dependencies_copy: Array[String] = []
    dependencies_copy.assign(dependencies.duplicate())

    var incompatible_copy: Array[String] = []
    incompatible_copy.assign(incompatible_packs.duplicate())

    var tags_copy: Array[String] = []
    tags_copy.assign(semantic_tags.duplicate())

    var domains_copy: Array[String] = []
    domains_copy.assign(provided_domains.duplicate())

    return {
        "pack_id": pack_id,
        "pack_name": pack_name,
        "version": version,
        "author": author,
        "engine_api_version": engine_api_version,
        "tier": tier,
        "pack_profile": pack_profile,
        "is_official": is_official,
        "trust_tier": trust_tier,
        "content_sha256": content_sha256,
        "publisher_signature": publisher_signature,
        "provided_domains": domains_copy,
        "has_prologue_dag": has_prologue_dag,
        "priority": priority,
        "dependencies": dependencies_copy,
        "incompatible_packs": incompatible_copy,
        "semantic_tags": tags_copy,
        "root_path": root_path,
        "is_active": is_active
    }

## 从字典安全反序列化为 NarrativePackManifestDTO 实例
static func from_dto(serialized_payload: Dictionary) -> NarrativePackManifestDTO:
    var manifest := NarrativePackManifestDTO.new()
    if serialized_payload == null or serialized_payload.is_empty():
        return manifest

    manifest.pack_id = String(serialized_payload.get("pack_id", ""))
    manifest.pack_name = String(serialized_payload.get("pack_name", ""))
    manifest.version = String(serialized_payload.get("version", ""))
    manifest.author = String(serialized_payload.get("author", ""))
    manifest.engine_api_version = String(serialized_payload.get("engine_api_version", ""))
    manifest.tier = String(serialized_payload.get("tier", "TIER_1_LOGIC"))
    var raw_profile: String = String(serialized_payload.get("pack_profile", "")).strip_edges().to_upper()
    if raw_profile.is_empty() and String(serialized_payload.get("mod_tier", "")).strip_edges().to_upper() == "TOTAL_CONVERSION":
        raw_profile = "TOTAL_CONVERSION"
    manifest.pack_profile = raw_profile if not raw_profile.is_empty() else "CONTENT_ADDON"
    manifest.is_official = bool(serialized_payload.get("is_official", false))
    manifest.trust_tier = String(serialized_payload.get("trust_tier", "OFFICIAL" if manifest.is_official else "COMMUNITY"))
    manifest.content_sha256 = String(serialized_payload.get("content_sha256", "")).strip_edges().to_lower()
    manifest.publisher_signature = String(serialized_payload.get("publisher_signature", ""))
    manifest.has_prologue_dag = bool(serialized_payload.get("has_prologue_dag", true))
    manifest.priority = int(serialized_payload.get("priority", 100))
    manifest.root_path = String(serialized_payload.get("root_path", ""))
    manifest.is_active = bool(serialized_payload.get("is_active", true))

    var raw_domains: Variant = serialized_payload.get("provided_domains", [])
    if raw_domains is Array:
        for domain_id in raw_domains:
            manifest.provided_domains.append(String(domain_id))

    var raw_dependencies: Variant = serialized_payload.get("dependencies", [])
    if raw_dependencies is Array:
        for dependency_id in raw_dependencies:
            manifest.dependencies.append(String(dependency_id))

    var raw_incompatible: Variant = serialized_payload.get("incompatible_packs", [])
    if raw_incompatible is Array:
        for incompatible_id in raw_incompatible:
            manifest.incompatible_packs.append(String(incompatible_id))

    var raw_tags: Variant = serialized_payload.get("semantic_tags", [])
    if raw_tags is Array:
        for tag in raw_tags:
            manifest.semantic_tags.append(String(tag))

    return manifest
