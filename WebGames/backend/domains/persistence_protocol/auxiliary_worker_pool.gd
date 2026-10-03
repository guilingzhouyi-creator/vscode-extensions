# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd
# 架构定位: Auxiliary Domain Async Worker Pool
# 跨域依赖: 上游: StorageMediator, ViewRouter | 下游: WorkerThreadPool, FileAccess, JSON, GameConfig
# 职责说明: 辅助数据储存并发工作池：管理大体量地图、文案、音频与预制体等可重建数据的
#           异步流式读取。严格将磁盘 IO、数据解压与 JSON 反序列化剥离出主线程，
#           提供基于优先级的多级队列、背压流控、取消令牌与无头确定性测试驱动模式。
# 设计依据: 双域储存架构线程与任务边界治理规范
# ==============================================================================

class_name AuxiliaryWorkerPool extends RefCounted

const StorageContractInterfaces = preload("res://backend/domains/persistence_protocol/storage_contract_interfaces.gd")
const CancellationToken = preload("res://backend/domains/persistence_protocol/cancellation_token.gd")
const BatchLoadRequestDTO = preload("res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd")
const ResourceIndexEntryDTO = preload("res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd")

const STATUS_PENDING: String = "PENDING"
const STATUS_RUNNING: String = "RUNNING"
const STATUS_COMPLETED: String = "COMPLETED"
const STATUS_CANCELLED: String = "CANCELLED"
const STATUS_FAILED: String = "FAILED"

const USEC_TO_MS: float = 1000.0
const DEFAULT_PUMP_BATCH_SIZE: int = 16
const FEATURE_TEMPLATE: String = "template"
const LOG_LEVEL_WARN: String = "warn"
const TASK_THREAD_PREFIX: String = "AuxLoadTask_"
const EXT_JSON: String = ".json"
const LOG_QUEUE_FULL: String = "AuxiliaryWorkerPool: 队列已满，触发背压拦截: %s"
const BATCH_ID_PREFIX: String = "batch_"

## 内部任务状态描述
class AsyncLoadTask extends RefCounted:
	var task_id: int = 0
	var resource_path: String = ""
	var priority: int = StorageContractInterfaces.LoadPriority.NORMAL
	var token: CancellationToken = null
	var callback: Callable = Callable()
	var status: String = STATUS_PENDING
	var result_data: Variant = null
	var error_code: String = StorageContractInterfaces.ERR_NONE
	var start_time_usec: int = 0
	var duration_ms: float = 0.0
	var byte_count: int = 0
	var pool_task_id: int = -1

static var _instance = null

var _task_counter: int = 0
var _pending_queue: Array[AsyncLoadTask] = []
var _running_tasks: Dictionary = {}    # task_id -> AsyncLoadTask
var _completed_tasks: Array[AsyncLoadTask] = []
var _cached_results: Dictionary = {}   # resource_path -> Variant
var _active_batches: Dictionary = {}   # batch_id -> BatchLoadRequestDTO

var _deterministic_mode: bool = true

static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

func _init() -> void:
	_task_counter = 0
	_pending_queue = []
	_running_tasks = {}
	_completed_tasks = []
	_cached_results = {}
	_active_batches = {}
	var force_sync: bool = GameConfig.get_bool("infrastructure.storage", "deterministic/force_sync_in_tests", true)
	_deterministic_mode = force_sync or OS.has_feature(FEATURE_TEMPLATE) == false

## 设置测试用确定性同步执行模式
func set_deterministic_mode(enabled: bool) -> void:
	_deterministic_mode = enabled

## 异步排队加载资源（依据优先级保序插入）
func request_resource_async(
	resource_path: String,
	priority: int = StorageContractInterfaces.LoadPriority.NORMAL,
	token: CancellationToken = null,
	callback: Callable = Callable()
) -> int:
	if resource_path.is_empty():
		return -1

	# 1. 缓存命中短路
	if _cached_results.has(resource_path):
		var cached_val: Variant = _cached_results[resource_path]
		if callback.is_valid():
			callback.call(true, cached_val, StorageContractInterfaces.ERR_NONE)
		return 0

	# 2. 检查背压上限
	var max_capacity: int = GameConfig.get_int("infrastructure.storage", "auxiliary/thread_pool/queue_capacity", 128)
	if _pending_queue.size() >= max_capacity:
		EventBusCore.get_instance().emit_log(LOG_LEVEL_WARN, LOG_QUEUE_FULL % resource_path)
		if callback.is_valid():
			callback.call(false, null, StorageContractInterfaces.ERR_BACKPRESSURE_EXCEEDED)
		return -1

	_task_counter += 1
	var task := AsyncLoadTask.new()
	task.task_id = _task_counter
	task.resource_path = resource_path
	task.priority = priority
	task.token = token
	task.callback = callback
	task.status = STATUS_PENDING
	task.start_time_usec = Time.get_ticks_usec()

	# 3. 按优先级升序保序插入
	var idx := 0
	while idx < _pending_queue.size() and _pending_queue[idx].priority <= task.priority:
		idx += 1
	_pending_queue.insert(idx, task)

	# 4. 驱动调度
	_execute_task(task, _deterministic_mode)

	return task.task_id

## 批量排队装载资源（支持原子完成屏障与单项通知）
func enqueue_batch(batch_request: Variant) -> String:
	var batch := batch_request as BatchLoadRequestDTO
	if batch == null:
		return ""
	if batch.entries.is_empty():
		if batch.on_batch_completed.is_valid():
			batch.on_batch_completed.call(batch.batch_id, 0, 0)
		return ""

	_task_counter += 1
	if batch.batch_id.is_empty():
		batch.batch_id = BATCH_ID_PREFIX + str(_task_counter)

	var b_id := batch.batch_id
	_active_batches[b_id] = batch

	for entry in batch.entries:
		var token: Variant = batch.cancellation_token
		var prio: int = entry.priority
		var path: String = entry.physical_path if not entry.physical_path.is_empty() else entry.resource_id
		request_resource_async(path, prio, token, func(ok: bool, data: Variant, err: String):
			batch.loaded_count += int(ok)
			batch.failed_count += int(not ok)
			if batch.on_item_loaded.is_valid():
				batch.on_item_loaded.call(entry, ok, data, err)
			if batch.is_completed():
				_active_batches.erase(b_id)
				if batch.on_batch_completed.is_valid():
					batch.on_batch_completed.call(batch.batch_id, batch.total_count, batch.failed_count)
		)

	return batch.batch_id

## 取消加载任务（支持传入任务 ID 或 CancellationToken）
func cancel_task(target: Variant) -> bool:
	if target is CancellationToken:
		var cancelled_any := false
		var i := _pending_queue.size() - 1
		while i >= 0:
			if _pending_queue[i].token == target:
				var t := _pending_queue[i]
				t.status = STATUS_CANCELLED
				t.error_code = StorageContractInterfaces.ERR_TASK_CANCELLED
				_pending_queue.remove_at(i)
				if t.callback.is_valid():
					t.callback.call(false, null, StorageContractInterfaces.ERR_TASK_CANCELLED)
				cancelled_any = true
			i -= 1
		return cancelled_any

	var tid := int(target)
	for i in range(_pending_queue.size()):
		if _pending_queue[i].task_id == tid:
			var t := _pending_queue[i]
			t.status = STATUS_CANCELLED
			t.error_code = StorageContractInterfaces.ERR_TASK_CANCELLED
			_pending_queue.remove_at(i)
			if t.callback.is_valid():
				t.callback.call(false, null, StorageContractInterfaces.ERR_TASK_CANCELLED)
			return true
	if _running_tasks.has(tid):
		var rt: AsyncLoadTask = _running_tasks[tid]
		rt.status = STATUS_CANCELLED
		rt.error_code = StorageContractInterfaces.ERR_TASK_CANCELLED
		return true
	return false

## 任务执行调度（支持确定性同步或 WorkerThreadPool 异步派发）
func _execute_task(task: AsyncLoadTask, sync_mode: bool) -> void:
	if task.token != null and task.token.is_cancelled():
		task.status = STATUS_CANCELLED
		task.error_code = StorageContractInterfaces.ERR_TASK_CANCELLED
		_notify_task_finished(task)
		return

	task.status = STATUS_RUNNING

	if sync_mode:
		var res := _load_resource_payload(task.resource_path)
		task.duration_ms = float(Time.get_ticks_usec() - task.start_time_usec) / USEC_TO_MS
		if res.has("error") and str(res["error"]) != StorageContractInterfaces.ERR_NONE:
			task.status = STATUS_FAILED
			task.error_code = String(res["error"])
		else:
			task.status = STATUS_COMPLETED
			task.result_data = res.get("data", null)
			task.byte_count = int(res.get("byte_count", 0))
			_cached_results[task.resource_path] = task.result_data
		_notify_task_finished(task)
	else:
		_running_tasks[task.task_id] = task
		var task_fn := func() -> void:
			var res := _load_resource_payload(task.resource_path)
			task.duration_ms = float(Time.get_ticks_usec() - task.start_time_usec) / USEC_TO_MS
			if res.has("error") and str(res["error"]) != StorageContractInterfaces.ERR_NONE:
				task.status = STATUS_FAILED
				task.error_code = String(res["error"])
			else:
				task.status = STATUS_COMPLETED
				task.result_data = res.get("data", null)
				task.byte_count = int(res.get("byte_count", 0))
		var is_high_prio := (task.priority <= StorageContractInterfaces.LoadPriority.HIGH)
		task.pool_task_id = WorkerThreadPool.add_task(task_fn, is_high_prio, TASK_THREAD_PREFIX + str(task.task_id))

## 底层纯 IO 与反序列化算子（可在非主线程安全执行）
static func _load_resource_payload(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"error": StorageContractInterfaces.ERR_NOT_FOUND}

	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"error": StorageContractInterfaces.ERR_IO_FAIL}

	var content_text := file.get_as_text()
	var byte_len := content_text.length()
	file.close()

	if path.ends_with(EXT_JSON):
		var json := JSON.new()
		if json.parse(content_text) != OK:
			return {"error": StorageContractInterfaces.ERR_CORRUPT}
		return {"data": json.get_data(), "byte_count": byte_len}

	return {"data": content_text, "byte_count": byte_len}

## 完成后通知
func _notify_task_finished(task: AsyncLoadTask) -> void:
	if _running_tasks.has(task.task_id):
		_running_tasks.erase(task.task_id)
	_completed_tasks.append(task)
	if task.callback.is_valid():
		var ok := (task.status == STATUS_COMPLETED)
		task.callback.call(ok, task.result_data, task.error_code)

## 轮询消费完成缓冲区
func pump_completed_tasks(max_count: int = DEFAULT_PUMP_BATCH_SIZE) -> int:
	var processed := 0
	while not _completed_tasks.is_empty() and processed < max_count:
		_completed_tasks.pop_front()
		processed += 1
	return processed

## 获取已缓存资源
func get_cached_resource(resource_path: String) -> Variant:
	return _cached_results.get(resource_path, null)

## 清理闲置资源
func evict_idle_resources() -> int:
	var count := _cached_results.size()
	_cached_results.clear()
	return count

## 获取待处理及正在执行队列总大小
func get_queue_size() -> int:
	return _pending_queue.size() + _running_tasks.size()

## 测试重置
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._pending_queue.clear()
		_instance._running_tasks.clear()
		_instance._completed_tasks.clear()
		_instance._cached_results.clear()
		_instance._active_batches.clear()
	_instance = null
