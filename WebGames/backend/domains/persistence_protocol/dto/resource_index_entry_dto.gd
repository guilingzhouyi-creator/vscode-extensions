# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd
# 架构定位: Value Object DTO / Resource Index Descriptor Model
# 跨域依赖: 上游: StorageResourceCatalog, AuxiliaryWorkerPool | 下游: GameConfig, ResourceDecoderRegistry
# 职责说明: 资源索引描述符数据传输对象：承载资源的逻辑标识、底层物理路径、资源分类、
#           加载优先级、依赖图列表与尺寸预估，彻底隔离业务代码对磁盘物理路径的直接依赖。
# 设计依据: 双域储存架构资源索引与寻址规范
# ==============================================================================

class_name ResourceIndexEntryDTO extends RefCounted

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

func _init(
	p_id: String = "",
	p_path: String = "",
	p_category: String = DEFAULT_CATEGORY,
	p_priority: int = DEFAULT_PRIORITY
) -> void:
	resource_id = p_id
	physical_path = p_path
	category = p_category
	priority = p_priority
	estimated_bytes = 0
	dependencies = []
	metadata = {}

## 对象池复用重置
func reset_state() -> void:
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
static func from_dict(data: Dictionary) -> RefCounted:
	var dto: RefCounted = new()
	var instance := dto as ResourceIndexEntryDTO
	if instance != null:
		instance.resource_id = String(data.get("resource_id", ""))
		instance.physical_path = String(data.get("physical_path", ""))
		instance.category = String(data.get("category", DEFAULT_CATEGORY))
		instance.priority = int(data.get("priority", DEFAULT_PRIORITY))
		instance.estimated_bytes = int(data.get("estimated_bytes", 0))
		var deps: Array = data.get("dependencies", [])
		instance.dependencies.clear()
		for d in deps:
			instance.dependencies.append(String(d))
		instance.metadata = Dictionary(data.get("metadata", {})).duplicate(true)
	return dto
