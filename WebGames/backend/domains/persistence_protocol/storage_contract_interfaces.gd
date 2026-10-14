# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/storage_contract_interfaces.gd
# 架构定位: Storage Contract Interfaces and Abstract Base Contracts
# 依赖与触发: 上游: 无 | 下游: PrimaryStorageEngine, AuxiliaryWorkerPool, DTOs
# 职责说明: 双域储存抽象接口定义：明确主数据与辅助资源的职责边界，
#           禁止业务代码直接依赖底层磁盘 IO 或具体文件格式。
# 退出语义与设计依据: 双域储存架构设计规范
# ==============================================================================

## StorageContractInterfaces：Storage Contract Interfaces and Abstract Base Contracts
class_name StorageContractInterfaces extends RefCounted

## 资源加载优先级枚举
enum LoadPriority {
	CRITICAL,    ## 核心阻断性资源（如首场景核心数据、主网格）
	HIGH,        ## 关键可视资源（如当前视锥内网格/贴图）
	NORMAL,      ## 常规业务数据（默认优先级）
	LOW,         ## 预取资源（相邻区域、次级文案）
	BACKGROUND   ## 低优先级后台缓存（远景、历史数据）
}

## 统一错误码定义
const ERR_NONE = "ERR_NONE"
const ERR_FILE_NOT_FOUND = "ERR_FILE_NOT_FOUND"
const ERR_NOT_FOUND = "ERR_NOT_FOUND"
const ERR_PARSE_FAILED = "ERR_PARSE_FAILED"
const ERR_CANCELLED = "ERR_CANCELLED"
const ERR_TASK_CANCELLED = "ERR_TASK_CANCELLED"
const ERR_TIMEOUT = "ERR_TIMEOUT"
const ERR_BACKPRESSURE = "ERR_BACKPRESSURE"
const ERR_BACKPRESSURE_EXCEEDED = "ERR_BACKPRESSURE_EXCEEDED"
const ERR_IO_FAILURE = "ERR_IO_FAILURE"
const ERR_IO_FAIL = "ERR_IO_FAIL"
const ERR_CORRUPT = "ERR_CORRUPT"

## 主要数据储存抽象契约
class PrimaryStorageContract extends RefCounted:
	## 快速恢复首屏渲染所需的最少核心状态
	func quick_restore_minimal_state(_slot_id: String) -> Dictionary:
		return {}

	## 将核心主数据同步持久化写入存储介质
	func save_primary_data(_slot_id: String, _payload: Dictionary) -> Dictionary:
		return {}

	## 从存储介质中同步加载核心主数据
	func load_primary_data(_slot_id: String) -> Dictionary:
		return {}

	## 从灾备副本当中恢复已损毁的存储槽位
	func restore_backup(_slot_id: String) -> Dictionary:
		return {}

	## 校验存储槽位数据文件的校验和与完整性
	func verify_integrity(_slot_id: String) -> bool:
		return false

## 辅助资源加载抽象契约
class AuxiliaryLoaderContract extends RefCounted:
	## 异步请求加载特定辅助存储资源条目
	func request_resource_async(_resource_path: String, _priority: int = LoadPriority.NORMAL, _token: Variant = null, _callback: Callable = Callable()) -> int:
		return -1

	## 取消当前正在排队或执行的存储后台任务
	func cancel_task(_task_id: int) -> bool:
		return false

	## 获取任务队列中处于排队与执行的总条目数
	func get_queue_size() -> int:
		return 0

	## 驱逐清理长时间未命中的闲置资源缓存
	func evict_idle_resources() -> int:
		return 0

	## 批量向存储调度队列追加持久化任务
	func enqueue_batch(_batch_request: Variant) -> String:
		return ""

## 统一资源索引提供者契约
class ResourceIndexProviderContract extends RefCounted:
	## 从资源元数据索引中解析并获取对应资源条目
	func resolve_entry(_resource_id: String) -> RefCounted:
		return null

	## 获取指定业务分类下的所有资源条目清单
	func get_entries_by_category(_category: String) -> Array:
		return []

	## 获取指定优先级队列下的所有资源条目清单
	func get_entries_by_priority(_priority: int) -> Array:
		return []

	## 查询底层存储介质是否存在指定路径的资源
	func has_resource(_resource_id: String) -> bool:
		return false

## 多态资源解码器契约
class ResourceDecoderContract extends RefCounted:
	## 判定输入资源条目是否支持当前格式解码
	func can_decode(_entry: RefCounted) -> bool:
		return false

	## 对二进制或文本输入载荷执行反序列化解码
	func decode_payload(_raw_bytes: PackedByteArray, _text: String, _entry: RefCounted) -> Dictionary:
		return {"data": null, "error": "NOT_IMPLEMENTED"}
