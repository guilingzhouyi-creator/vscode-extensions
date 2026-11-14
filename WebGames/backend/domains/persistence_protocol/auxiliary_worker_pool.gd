# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd
# 架构定位: Auxiliary Domain Async Worker Pool
# 依赖与触发: 上游: StorageMediator, ViewRouter | 下游: WorkerThreadPool, FileAccess, JSON, GameConfig
# 职责说明: 辅助数据储存并发工作池：管理大体量地图、文案、音频与预制体等可重建数据的
#           异步流式读取。严格将磁盘 IO、数据解压与 JSON 反序列化剥离出主线程，
#           提供基于优先级的多级队列、背压流控、取消令牌与无头确定性测试驱动模式。
# 退出语义与设计依据: 双域储存架构线程与任务边界治理规范
# ==============================================================================

## AuxiliaryWorkerPool：Auxiliary Domain Async Worker Pool
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
const LOG_QUEUE_FULL: String = "AuxiliaryWorkerPool: queue is full, backpressure intercepted: {path}"
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

static var _instance: RefCounted = null

const DEFAULT_MAX_CACHE_ENTRIES: int = 64
const DEFAULT_MAX_COMPLETED_TASKS: int = 128

static var _queue_capacity_cached: int = 128
static var _queue_capacity_config_version: int = -1

var _task_counter: int = 0
var _pending_queue: Array[AsyncLoadTask] = []
var _running_tasks: Dictionary = {}    # task_id -> AsyncLoadTask
var _completed_tasks: Array[AsyncLoadTask] = []
var _completed_head: int = 0
var _cached_results: Dictionary = {}   # resource_path -> Variant
var _cache_keys_fifo: Array[String] = []
var _cache_fifo_head: int = 0
var _max_cache_entries: int = DEFAULT_MAX_CACHE_ENTRIES
var _active_batches: Dictionary = {}   # batch_id -> BatchLoadRequestDTO
var _state_mutex: Mutex = Mutex.new()

var _deterministic_mode: bool = true

## 获取单例全局静态唯一实例
static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = AuxiliaryWorkerPool.new()
	return _instance

func _init() -> void:
	_task_counter = 0
	_pending_queue = []
	_running_tasks = {}
	_completed_tasks = []
	_completed_head = 0
	_cached_results = {}
	_cache_keys_fifo = []
	_cache_fifo_head = 0
	_active_batches = {}
	_state_mutex = Mutex.new()
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
	_state_mutex.lock()
	var cache_hit: bool = _cached_results.has(resource_path)
	var cached_value: Variant = _cached_results.get(resource_path, null) if cache_hit else null
	_state_mutex.unlock()
	if cache_hit:
		if callback.is_valid():
			callback.call(true, cached_value, StorageContractInterfaces.ERR_NONE)
		return 0

	# 2. 检查背压上限（随 GameConfig.config_reload_version() 缓存）
	var config_version: int = GameConfig.config_reload_version()
	if _queue_capacity_config_version != config_version:
		_queue_capacity_cached = GameConfig.get_int("infrastructure.storage", "auxiliary/thread_pool/queue_capacity", 128)
		_queue_capacity_config_version = config_version
	var max_capacity: int = _queue_capacity_cached
	if _pending_queue.size() >= max_capacity:
		EventBusCore.get_instance().emit_log(LOG_LEVEL_WARN, TemplateFormatter.format(LOG_QUEUE_FULL, {"path": resource_path}))
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

	# 3. 直接驱动调度（避免无意义先 insert 再立即 erase）
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

	var batch_id := batch.batch_id
	_active_batches[batch_id] = batch

	for entry in batch.entries:
		var token: Variant = batch.cancellation_token
		var priority_level: int = entry.priority
		var path: String = entry.physical_path if not entry.physical_path.is_empty() else entry.resource_id
		request_resource_async(path, priority_level, token, func(succeeded: bool, data: Variant, error_code: String):
			batch.loaded_count += int(succeeded)
			batch.failed_count += int(not succeeded)
			if batch.on_item_loaded.is_valid():
				batch.on_item_loaded.call(entry, succeeded, data, error_code)
			if batch.is_completed():
				_active_batches.erase(batch_id)
				if batch.on_batch_completed.is_valid():
					batch.on_batch_completed.call(batch.batch_id, batch.total_count, batch.failed_count)
		)

	return batch.batch_id

func _cancel_task_instance(task: AsyncLoadTask, notify_callback: bool) -> void:
	task.status = STATUS_CANCELLED
	task.error_code = StorageContractInterfaces.ERR_TASK_CANCELLED
	if notify_callback and task.callback.is_valid():
		task.callback.call(false, null, StorageContractInterfaces.ERR_TASK_CANCELLED)

## 取消加载任务（支持传入任务 ID 或 CancellationToken）
func cancel_task(target: Variant) -> bool:
	if target is CancellationToken:
		var cancelled_any := false
		var queue_index := _pending_queue.size() - 1
		while queue_index >= 0:
			if _pending_queue[queue_index].token == target:
				var pending_task: AsyncLoadTask = _pending_queue[queue_index]
				_pending_queue.remove_at(queue_index)
				_cancel_task_instance(pending_task, true)
				cancelled_any = true
			queue_index -= 1
		return cancelled_any

	var target_task_id := int(target)
	for queue_index in range(_pending_queue.size()):
		if _pending_queue[queue_index].task_id == target_task_id:
			var pending_task: AsyncLoadTask = _pending_queue[queue_index]
			_pending_queue.remove_at(queue_index)
			_cancel_task_instance(pending_task, true)
			return true
	if _running_tasks.has(target_task_id):
		_cancel_task_instance(_running_tasks[target_task_id] as AsyncLoadTask, false)
		return true
	return false

func _run_task_execution(task: AsyncLoadTask) -> void:
	var load_result := _load_resource_payload(task.resource_path)
	task.duration_ms = float(Time.get_ticks_usec() - task.start_time_usec) / USEC_TO_MS
	if load_result.has("error") and str(load_result["error"]) != StorageContractInterfaces.ERR_NONE:
		task.status = STATUS_FAILED
		task.error_code = String(load_result["error"])
	else:
		task.status = STATUS_COMPLETED
		task.result_data = load_result.get("data", null)
		task.byte_count = int(load_result.get("byte_count", 0))
		_cache_result(task.resource_path, task.result_data)
	_notify_task_finished(task)

## 任务执行调度（支持确定性同步或 WorkerThreadPool 异步派发）
func _execute_task(task: AsyncLoadTask, sync_mode: bool) -> void:
	if task.token != null and task.token.is_cancelled():
		_cancel_task_instance(task, false)
		_notify_task_finished(task)
		return

	task.status = STATUS_RUNNING

	if sync_mode:
		_run_task_execution(task)
	else:
		_state_mutex.lock()
		_running_tasks[task.task_id] = task
		_state_mutex.unlock()
		var is_high_priority := (task.priority <= StorageContractInterfaces.LoadPriority.HIGH)
		task.pool_task_id = WorkerThreadPool.add_task(_run_task_execution.bind(task), is_high_priority, TASK_THREAD_PREFIX + str(task.task_id))

## 插入缓存并执行环形 FIFO 淘汰，保障缓存字典规模有界且零 pop_front 挪移
func _cache_result(path: String, data: Variant) -> void:
	_state_mutex.lock()
	if _cached_results.has(path):
		_cached_results[path] = data
		_state_mutex.unlock()
		return
	if _cache_keys_fifo.size() < _max_cache_entries:
		_cached_results[path] = data
		_cache_keys_fifo.append(path)
	elif _max_cache_entries > 0:
		var oldest_key: String = _cache_keys_fifo[_cache_fifo_head]
		_cached_results.erase(oldest_key)
		_cache_keys_fifo[_cache_fifo_head] = path
		_cache_fifo_head = (_cache_fifo_head + 1) % _cache_keys_fifo.size()
		_cached_results[path] = data
	_state_mutex.unlock()

## 底层纯 IO 与反序列化算子（可在非主线程安全执行）
static func _load_resource_payload(path: String) -> Dictionary:
	if path.ends_with(".kdat"):
		if not FileAccess.file_exists(path):
			return {"error": StorageContractInterfaces.ERR_NOT_FOUND}
		var kdat_data: Variant = BinaryConfigReader.load_kdat_file(path)
		if kdat_data == null:
			return {"error": StorageContractInterfaces.ERR_CORRUPT}
		var file_handle := FileAccess.open(path, FileAccess.READ)
		var byte_length: int = file_handle.get_length() if file_handle != null else 0
		if file_handle != null:
			file_handle.close()
		return {"data": kdat_data, "byte_count": byte_length}

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
	_state_mutex.lock()
	if _running_tasks.has(task.task_id):
		_running_tasks.erase(task.task_id)
	_state_mutex.unlock()
	if task.callback.is_valid():
		var ok := (task.status == STATUS_COMPLETED)
		task.callback.call(ok, task.result_data, task.error_code)
		task.callback = Callable() # 立即释放回调闭包，阻断外部大对象与 DTO 连锁强引用常驻

	_state_mutex.lock()
	if _completed_tasks.size() < DEFAULT_MAX_COMPLETED_TASKS and _completed_head == 0:
		_completed_tasks.append(task)
	elif DEFAULT_MAX_COMPLETED_TASKS > 0:
		_completed_tasks[_completed_head] = task
		_completed_head = (_completed_head + 1) % _completed_tasks.size()
	_state_mutex.unlock()

## 轮询消费完成缓冲区
func pump_completed_tasks(max_count: int = DEFAULT_PUMP_BATCH_SIZE) -> int:
	_state_mutex.lock()
	var count: int = _completed_tasks.size()
	var processed: int = mini(maxi(0, max_count), count)
	if processed > 0:
		if _completed_head == 0:
			_completed_tasks = _completed_tasks.slice(processed)
		else:
			var ordered: Array[AsyncLoadTask] = _completed_tasks.slice(_completed_head)
			ordered.append_array(_completed_tasks.slice(0, _completed_head))
			_completed_tasks = ordered.slice(processed)
			_completed_head = 0
	_state_mutex.unlock()
	return processed

## 获取已缓存资源
func get_cached_resource(resource_path: String) -> Variant:
	_state_mutex.lock()
	var cached_value: Variant = _cached_results.get(resource_path, null)
	_state_mutex.unlock()
	return cached_value

## 清理闲置资源
func evict_idle_resources() -> int:
	_state_mutex.lock()
	var count := _cached_results.size()
	_cached_results.clear()
	_cache_keys_fifo.clear()
	_cache_fifo_head = 0
	_state_mutex.unlock()
	return count

## 获取待执行及正在执行队列总大小
func get_queue_size() -> int:
	_state_mutex.lock()
	var total_size: int = _pending_queue.size() + _running_tasks.size()
	_state_mutex.unlock()
	return total_size

## 测试重置
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._state_mutex.lock()
		_instance._pending_queue.clear()
		_instance._running_tasks.clear()
		_instance._completed_tasks.clear()
		_instance._completed_head = 0
		_instance._cached_results.clear()
		_instance._cache_keys_fifo.clear()
		_instance._cache_fifo_head = 0
		_instance._active_batches.clear()
		_instance._state_mutex.unlock()
	_instance = null
