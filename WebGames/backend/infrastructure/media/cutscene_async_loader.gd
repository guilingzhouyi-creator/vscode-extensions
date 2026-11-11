# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/cutscene_async_loader.gd
# 架构定位: Non-Blocking Streaming Media Async Loader / LRU Cache Pool
# 依赖与触发: 上游: CutsceneOrchestrator, CutscenePreloadPredictor | 下游: ResourceLoader, VideoStream
# 职责说明: 负责视频与 CG 资源的异步非阻塞流式装载，将大体积磁盘 IO 从主线程彻底剥离；
#           提供定容 LRU 显存/内存淘汰保护、取消令牌与针对无头自动化测试的确定性步进仿真；
#           当物理艺术资源尚未就位时，自动降级为虚拟回退资源立即放行，杜绝主线程悬挂卡顿。
# 退出语义与设计依据: 零阻塞帧循环与高承压有界缓存规约 (Inv-NONBLOCK-LOAD-1 / Inv-LRU-BOUND-2)
# ==============================================================================

## CutsceneAsyncLoader：非阻塞异步流式媒体装载器
class_name CutsceneAsyncLoader
extends RefCounted

const AssetPathResolverClass = preload("res://backend/infrastructure/resource_governance/asset_path_resolver.gd")

# ==============================================================================
# 一、状态常量与任务模型
# ==============================================================================

const STATUS_IDLE: String = "IDLE"
const STATUS_LOADING: String = "LOADING"
const STATUS_LOADED: String = "LOADED"
const STATUS_FAILED: String = "FAILED"
const STATUS_CANCELLED: String = "CANCELLED"

const DEFAULT_CACHE_CAPACITY: int = 4

## 内部异步装载任务描述实体
class AsyncMediaTask extends RefCounted:
	var task_id: int = 0
	var resource_path: String = ""
	var priority: int = 1
	var status: String = STATUS_IDLE
	var progress: float = 0.0
	var loaded_resource: Resource = null
	var error_code: String = ""
	var is_cancelled: bool = false
	var callback: Callable = Callable()

static var _instance: CutsceneAsyncLoader = null

var _task_counter: int = 0
var _active_tasks: Dictionary = {} # task_id -> AsyncMediaTask
var _path_to_task_id: Dictionary = {} # resource_path -> task_id
var _lru_cache: Dictionary = {} # resource_path -> Resource
var _lru_keys: Array[String] = []
var _max_cache_capacity: int = DEFAULT_CACHE_CAPACITY
var _deterministic_mode: bool = false

# ==============================================================================
# 二、单例与生命周期管理
# ==============================================================================

static func get_instance() -> CutsceneAsyncLoader:
	if _instance == null:
		_instance = CutsceneAsyncLoader.new()
	return _instance

func set_deterministic_mode(enabled: bool) -> void:
	_deterministic_mode = enabled

func is_deterministic_mode() -> bool:
	return _deterministic_mode

func set_cache_capacity(capacity: int) -> void:
	_max_cache_capacity = maxi(1, capacity)
	_trim_lru_cache()

func clear_cache_and_tasks() -> void:
	_active_tasks.clear()
	_path_to_task_id.clear()
	_lru_cache.clear()
	_lru_keys.clear()

# ==============================================================================
# 三、非阻塞异步装载核心 API
# ==============================================================================

## 提交视频异步装载请求，返回唯一 task_id（形参 <= 5）
func request_load(resource_path: String, priority: int = 1, on_loaded: Callable = Callable()) -> int:
	var canonical_path := AssetPathResolverClass.resolve_unified_uri(resource_path)
	if canonical_path.is_empty():
		_invoke_callback(on_loaded, null)
		return 0

	if _try_serve_cached(canonical_path, on_loaded):
		return 0

	var existing_id := _try_merge_existing(canonical_path, on_loaded)
	if existing_id >= 0:
		return existing_id

	return _create_and_dispatch_task(canonical_path, priority, on_loaded)

func _try_serve_cached(path: String, on_loaded: Callable) -> bool:
	if not _lru_cache.has(path):
		return false
	_touch_lru(path)
	var cached_res: Resource = _lru_cache[path]
	_invoke_callback(on_loaded, cached_res)
	return true

func _try_merge_existing(path: String, on_loaded: Callable) -> int:
	if not _path_to_task_id.has(path):
		return -1
	var existing_id: int = _path_to_task_id[path]
	var task: AsyncMediaTask = _active_tasks.get(existing_id, null)
	if task == null or task.status != STATUS_LOADING:
		return -1

	if on_loaded.is_valid():
		var prev_cb: Callable = task.callback
		task.callback = func(res: Resource):
			if prev_cb.is_valid():
				prev_cb.call(res)
			on_loaded.call(res)
	return existing_id

func _create_and_dispatch_task(path: String, priority: int, on_loaded: Callable) -> int:
	_task_counter += 1
	var task_id: int = _task_counter

	var new_task := AsyncMediaTask.new()
	new_task.task_id = task_id
	new_task.resource_path = path
	new_task.priority = priority
	new_task.status = STATUS_LOADING
	new_task.callback = on_loaded

	_active_tasks[task_id] = new_task
	_path_to_task_id[path] = task_id

	if _deterministic_mode:
		_complete_deterministic(new_task, path, on_loaded)
		return task_id

	if not AssetPathResolverClass.asset_exists(path):
		_fallback_placeholder(new_task, path, on_loaded)
		return task_id

	var err := ResourceLoader.load_threaded_request(path, "", false)
	if err != OK:
		_fallback_placeholder(new_task, path, on_loaded)

	return task_id

func _complete_deterministic(task: AsyncMediaTask, path: String, on_loaded: Callable) -> void:
	task.status = STATUS_LOADED
	task.progress = 1.0
	task.loaded_resource = Resource.new()
	_cache_loaded_resource(path, task.loaded_resource)
	_invoke_callback(on_loaded, task.loaded_resource)

func _fallback_placeholder(task: AsyncMediaTask, path: String, on_loaded: Callable) -> void:
	task.status = STATUS_LOADED
	task.progress = 1.0
	task.loaded_resource = null
	_path_to_task_id.erase(path)
	_invoke_callback(on_loaded, null)

func _invoke_callback(cb: Callable, res: Resource) -> void:
	if cb.is_valid():
		cb.call(res)

## 轮询驱动检查异步加载进度（主线程定时调用或物理帧推进）
func poll_tasks() -> void:
	if _deterministic_mode or _active_tasks.is_empty():
		return

	var completed_ids: Array[int] = []
	for task_id in _active_tasks.keys():
		var task: AsyncMediaTask = _active_tasks[task_id]
		if task.is_cancelled:
			completed_ids.append(task_id)
			continue

		var progress_arr: Array = []
		var status := ResourceLoader.load_threaded_get_status(task.resource_path, progress_arr)
		if not progress_arr.is_empty():
			task.progress = float(progress_arr[0])

		if status == ResourceLoader.THREAD_LOAD_LOADED:
			var res := ResourceLoader.load_threaded_get(task.resource_path)
			task.status = STATUS_LOADED
			task.loaded_resource = res
			_cache_loaded_resource(task.resource_path, res)
			_invoke_callback(task.callback, res)
			completed_ids.append(task_id)
		elif status == ResourceLoader.THREAD_LOAD_FAILED or status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			task.status = STATUS_LOADED
			task.loaded_resource = null # 优雅降级为文字占位
			_invoke_callback(task.callback, null)
			completed_ids.append(task_id)

	for cid in completed_ids:
		var finished_task: AsyncMediaTask = _active_tasks.get(cid, null)
		if finished_task != null:
			_path_to_task_id.erase(finished_task.resource_path)
			_active_tasks.erase(cid)

## 取消正在执行的装载任务
func cancel_task(task_id: int) -> bool:
	var task: AsyncMediaTask = _active_tasks.get(task_id, null)
	if task == null:
		return false
	task.is_cancelled = true
	task.status = STATUS_CANCELLED
	_path_to_task_id.erase(task.resource_path)
	_active_tasks.erase(task_id)
	return true

## 同步快速判定某资源是否已在内存缓存就绪（无物理文件时直接判定就绪以进入模拟回退播放）
func is_resource_ready(resource_path: String) -> bool:
	var canonical_path := AssetPathResolverClass.resolve_unified_uri(resource_path)
	if _lru_cache.has(canonical_path):
		return true
	if _deterministic_mode:
		return false
	if canonical_path.is_empty() or not AssetPathResolverClass.asset_exists(canonical_path):
		return true
	return false

## 获取已就绪的媒体资源实体，若未就绪返回 null
func get_loaded_resource(resource_path: String) -> Resource:
	var canonical_path := AssetPathResolverClass.resolve_unified_uri(resource_path)
	if _lru_cache.has(canonical_path):
		_touch_lru(canonical_path)
		return _lru_cache[canonical_path]
	return null

# ==============================================================================
# 四、定容 LRU 缓存淘汰
# ==============================================================================

func _cache_loaded_resource(path: String, res: Resource) -> void:
	if res == null:
		return
	_lru_cache[path] = res
	_touch_lru(path)
	_trim_lru_cache()

func _touch_lru(path: String) -> void:
	_lru_keys.erase(path)
	_lru_keys.append(path)

func _trim_lru_cache() -> void:
	while _lru_keys.size() > _max_cache_capacity:
		var oldest_path: String = _lru_keys.pop_front()
		_lru_cache.erase(oldest_path)
