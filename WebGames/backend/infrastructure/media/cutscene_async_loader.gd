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
var _is_deterministic_mode: bool = false

# ==============================================================================
# 二、单例与生命周期管理
# ==============================================================================

## 获取异步过场媒体加载器进程级单例
static func get_instance() -> CutsceneAsyncLoader:
	if _instance == null:
		_instance = CutsceneAsyncLoader.new()
	return _instance

## 设置无头确定性仿真加载模式（用于测试隔离与同步完成回调）
func set_deterministic_mode(is_enabled: bool) -> void:
	_is_deterministic_mode = is_enabled

## 查询当前是否处于确定性仿真加载模式
func is_deterministic_mode() -> bool:
	return _is_deterministic_mode

## 设置 LRU 资源缓存最大槽位数并立即裁剪超出条目
func set_cache_capacity(capacity: int) -> void:
	_max_cache_capacity = maxi(1, capacity)
	_trim_lru_cache()

## 清空活跃加载任务映射与全部 LRU 缓存（供测试隔离重置）
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
	var cached_resource: Resource = _lru_cache[path]
	_invoke_callback(on_loaded, cached_resource)
	return true

func _try_merge_existing(path: String, on_loaded: Callable) -> int:
	if not _path_to_task_id.has(path):
		return -1
	var existing_id: int = _path_to_task_id[path]
	var task: AsyncMediaTask = _active_tasks.get(existing_id, null)
	if task == null or task.status != STATUS_LOADING:
		return -1

	if on_loaded.is_valid():
		# 合并同路径重复请求时串联旧回调，确保所有等待者均可收到同一次加载完成通知
		var previous_callback: Callable = task.callback
		task.callback = func(loaded_resource: Resource):
			if previous_callback.is_valid():
				previous_callback.call(loaded_resource)
			on_loaded.call(loaded_resource)
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

	if _is_deterministic_mode:
		_complete_deterministic(new_task, path, on_loaded)
		return task_id

	if not AssetPathResolverClass.asset_exists(path):
		_fallback_placeholder(new_task, path, on_loaded)
		return task_id

	if _is_external_binary_image_path(path):
		_load_external_image_from_bytes(new_task, path, on_loaded)
		return task_id

	var request_error := ResourceLoader.load_threaded_request(path, "", false)
	if request_error != OK:
		_fallback_placeholder(new_task, path, on_loaded)

	return task_id

func _is_external_binary_image_path(path: String) -> bool:
	var lower := path.to_lower()
	var is_image := lower.ends_with(".png") or lower.ends_with(".webp") or lower.ends_with(".jpg") or lower.ends_with(".jpeg") or lower.ends_with(".bmp") or lower.ends_with(".tga")
	if not is_image:
		return false
	return path.contains(".kmod!/") or path.begins_with("user://") or not ResourceLoader.exists(path)

func _load_external_image_from_bytes(task: AsyncMediaTask, path: String, on_loaded: Callable) -> void:
	var raw_bytes := AssetPathResolverClass.read_mod_asset_bytes(path)
	if raw_bytes.is_empty():
		_active_tasks.erase(task.task_id)
		_fallback_placeholder(task, path, on_loaded)
		return
	var image := Image.new()
	var lower := path.to_lower()
	var load_status := ERR_FILE_UNRECOGNIZED
	if lower.ends_with(".png"):
		load_status = image.load_png_from_buffer(raw_bytes)
	elif lower.ends_with(".webp"):
		load_status = image.load_webp_from_buffer(raw_bytes)
	elif lower.ends_with(".jpg") or lower.ends_with(".jpeg"):
		load_status = image.load_jpg_from_buffer(raw_bytes)
	elif lower.ends_with(".bmp"):
		load_status = image.load_bmp_from_buffer(raw_bytes)
	elif lower.ends_with(".tga"):
		load_status = image.load_tga_from_buffer(raw_bytes)
	if load_status != OK or image.is_empty():
		_active_tasks.erase(task.task_id)
		_fallback_placeholder(task, path, on_loaded)
		return
	var texture := ImageTexture.create_from_image(image)
	task.status = STATUS_LOADED
	task.progress = 1.0
	task.loaded_resource = texture
	_active_tasks.erase(task.task_id)
	_path_to_task_id.erase(path)
	_cache_loaded_resource(path, texture)
	_invoke_callback(on_loaded, texture)

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

func _invoke_callback(callback: Callable, loaded_resource: Resource) -> void:
	if callback.is_valid():
		callback.call(loaded_resource)

## 轮询驱动检查异步加载进度（主线程定时调用或物理帧推进）
func poll_tasks() -> void:
	if _is_deterministic_mode or _active_tasks.is_empty():
		return

	var completed_ids: Array[int] = []
	var progress_values: Array = []
	for task_id in _active_tasks.keys():
		var task: AsyncMediaTask = _active_tasks[task_id]
		if task.is_cancelled:
			completed_ids.append(task_id)
			continue

		progress_values.clear()
		var status := ResourceLoader.load_threaded_get_status(task.resource_path, progress_values)
		if not progress_values.is_empty():
			task.progress = float(progress_values[0])

		if status == ResourceLoader.THREAD_LOAD_LOADED:
			var loaded_resource := ResourceLoader.load_threaded_get(task.resource_path)
			task.status = STATUS_LOADED
			task.loaded_resource = loaded_resource
			_cache_loaded_resource(task.resource_path, loaded_resource)
			_invoke_callback(task.callback, loaded_resource)
			completed_ids.append(task_id)
		elif status == ResourceLoader.THREAD_LOAD_FAILED or status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			task.status = STATUS_LOADED
			task.loaded_resource = null # 优雅降级为文字占位
			_invoke_callback(task.callback, null)
			completed_ids.append(task_id)

	for completed_id in completed_ids:
		var finished_task: AsyncMediaTask = _active_tasks.get(completed_id, null)
		if finished_task != null:
			_path_to_task_id.erase(finished_task.resource_path)
			_active_tasks.erase(completed_id)

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
	if _is_deterministic_mode:
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

func _cache_loaded_resource(path: String, loaded_resource: Resource) -> void:
	if loaded_resource == null:
		return
	_lru_cache[path] = loaded_resource
	_touch_lru(path)
	_trim_lru_cache()

func _touch_lru(path: String) -> void:
	_lru_keys.erase(path)
	_lru_keys.append(path)

func _trim_lru_cache() -> void:
	while _lru_keys.size() > _max_cache_capacity:
		var oldest_path: String = _lru_keys.pop_front()
		_lru_cache.erase(oldest_path)
