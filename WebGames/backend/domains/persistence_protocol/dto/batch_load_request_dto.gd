# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd
# 架构定位: Value Object DTO / Batch Resource Loading Request Model
# 跨域依赖: 上游: GameConfig, ViewRouter, SceneManager | 下游: AuxiliaryWorkerPool, FrameBudgetDispatcher
# 职责说明: 批量资源装载请求数据传输对象：组织多项关联资源的批量并行异步调度，
#           维护整批资源加载进度状态计数与原子完成屏障（Barrier），支持统一取消令牌。
# 设计依据: 双域储存架构并发流控与屏障设计规范
# ==============================================================================

class_name BatchLoadRequestDTO extends RefCounted

const ResourceIndexEntryDTO = preload("res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd")

## 批次请求唯一标识符
var batch_id: String = ""

## 待加载资源条目列表
var entries: Array[ResourceIndexEntryDTO] = []

## 单项资源完成回调：func(entry: ResourceIndexEntryDTO, success: bool, data: Variant, error_code: String)
var on_item_loaded: Callable = Callable()

## 整批全部就绪屏障回调：func(batch_id: String, total: int, failed: int)
var on_batch_completed: Callable = Callable()

## 关联取消令牌 (CancellationToken)
var cancellation_token: Variant = null

## 批次内总任务数
var total_count: int = 0

## 成功加载计数
var loaded_count: int = 0

## 失败/取消计数
var failed_count: int = 0

func _init(p_batch_id: String = "") -> void:
	batch_id = p_batch_id
	entries = []
	on_item_loaded = Callable()
	on_batch_completed = Callable()
	cancellation_token = null
	total_count = 0
	loaded_count = 0
	failed_count = 0

## 添加资源条目
func add_entry(entry: ResourceIndexEntryDTO) -> void:
	if entry != null:
		entries.append(entry)
		total_count = entries.size()

## 对象池复用重置
func reset_state() -> void:
	batch_id = ""
	entries.clear()
	on_item_loaded = Callable()
	on_batch_completed = Callable()
	cancellation_token = null
	total_count = 0
	loaded_count = 0
	failed_count = 0

## 判断当前批次是否已完全终结（成功 + 失败 == 总数）
func is_completed() -> bool:
	if total_count == 0:
		return true
	return (loaded_count + failed_count) >= total_count
