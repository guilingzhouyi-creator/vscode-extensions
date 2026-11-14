# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd
# 架构定位: Value Object DTO / Resource Index Descriptor Model
# 依赖与触发: 上游: StorageResourceCatalog, AuxiliaryWorkerPool | 下游: GameConfig, ResourceDecoderRegistry
# 职责说明: 资源索引描述符数据传输对象：承载资源的逻辑标识、底层物理路径、资源分类、
#           加载优先级、依赖图列表与尺寸预估，彻底隔离业务代码对磁盘物理路径的直接依赖。
# 退出语义与设计依据: 双域储存架构资源索引与寻址规范
# ==============================================================================

## ResourceIndexEntryDTO：Value Object DTO / Resource Index Descriptor Model
class_name ResourceIndexEntryDTO extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

const DEFAULT_CATEGORY: String = "config"
const DEFAULT_PRIORITY: int = 2

## 逻辑资源全局唯一标识 (如 "config.domains.combat", "mesh.hero_sword")
var resource_id: String = ""

## 物理存储路径 (如 "res://config/domains/combat.json")
var physical_path: String = ""

## 资源分类标识 (config, text, mesh, texture, audio, scene, raw)
var category: String = DEFAULT_CATEGORY

## 加载调度优先级 (0:CRITICAL, 1:HIGH, 2:NORMAL, 3:LOW, 4:BACKGROUND)
var priority: int = DEFAULT_PRIORITY

## 预估内存/磁盘体量 (字节)，供背压与预算池决策
var estimated_bytes: int = 0

## 前置强依赖资源 ID 列表
var dependencies: Array[String] = []

## 扩展元数据 (如所属领域、版本标识等)
var metadata: Dictionary = {}

## 初始化资源索引条目传输对象。
func _init(
	initial_resource_id: String = "",
	initial_physical_path: String = "",
	initial_category: String = DEFAULT_CATEGORY,
	initial_priority: int = DEFAULT_PRIORITY
) -> void:
	resource_id = initial_resource_id
	physical_path = initial_physical_path
	category = initial_category
	priority = initial_priority
	estimated_bytes = 0
	dependencies = []
	metadata = {}

## 对象池复用重置
func reset_state() -> void:
	super.reset_state()
	resource_id = ""
	physical_path = ""
	category = DEFAULT_CATEGORY
	priority = DEFAULT_PRIORITY
	estimated_bytes = 0
	dependencies.clear()
	metadata.clear()

## 序列化为字典
func to_dict() -> Dictionary:
	return {
		"resource_id": resource_id,
		"physical_path": physical_path,
		"category": category,
		"priority": priority,
		"estimated_bytes": estimated_bytes,
		"dependencies": dependencies.duplicate(),
		"metadata": metadata.duplicate(true)
	}

## 反序列化为 DTO 实例
static func from_dict(serialized_payload: Dictionary) -> RefCounted:
	var entry_instance: RefCounted = new()
	var typed_entry := entry_instance as ResourceIndexEntryDTO
	if typed_entry != null:
		typed_entry.resource_id = String(serialized_payload.get("resource_id", ""))
		typed_entry.physical_path = String(serialized_payload.get("physical_path", ""))
		typed_entry.category = String(serialized_payload.get("category", DEFAULT_CATEGORY))
		typed_entry.priority = int(serialized_payload.get("priority", DEFAULT_PRIORITY))
		typed_entry.estimated_bytes = int(serialized_payload.get("estimated_bytes", 0))
		var raw_dependencies: Array = serialized_payload.get("dependencies", [])
		typed_entry.dependencies.clear()
		for dependency_id in raw_dependencies:
			typed_entry.dependencies.append(String(dependency_id))
		typed_entry.metadata = Dictionary(serialized_payload.get("metadata", {})).duplicate(true)
	return entry_instance
