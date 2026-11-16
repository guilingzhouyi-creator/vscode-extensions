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

signal load_failed(task_id: int, resource_path: String, error_code: String)

# ==============================================================================
# 一、状态常量与任务模型
# ==============================================================================

const STATUS_IDLE: String = "IDLE"
const STATUS_LOADING: String = "LOADING"
const STATUS_LOADED: String = "LOADED"
const STATUS_FAILED: String = "FAILED"
const STATUS_CANCELLED: String = "CANCELLED"

const ERR_MEDIA_MISSING: String = "ERR_MEDIA_MISSING"
const ERR_MEDIA_DECODE_FAILED: String = "ERR_MEDIA_DECODE_FAILED"
const ERR_UNSUPPORTED_MEDIA_FORMAT: String = "ERR_UNSUPPORTED_MEDIA_FORMAT"
const ERR_THREAD_LOAD_FAILED: String = "ERR_THREAD_LOAD_FAILED"

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
var _task_status_history: Dictionary = {} # task_id -> String
var _task_error_history: Dictionary = {} # task_id -> String
var _last_errors: Dictionary = {} # resource_path -> String
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
	_task_status_history.clear()
	_task_error_history.clear()
	_last_errors.clear()
	_lru_cache.clear()
	_lru_keys.clear()


## 查询异步装载任务最近一次记录的状态（IDLE/LOADING/LOADED/FAILED/CANCELLED）
func get_task_status(task_id: int) -> String:
	var task: AsyncMediaTask = _active_tasks.get(task_id, null)
	if task != null:
		return task.status
	return str(_task_status_history.get(task_id, STATUS_IDLE))


## 查询异步装载任务失败错误码（成功或未发生失败时返回空串）
func get_task_error_code(task_id: int) -> String:
	var task: AsyncMediaTask = _active_tasks.get(task_id, null)
	if task != null:
		return task.error_code
	return str(_task_error_history.get(task_id, ""))


## 按资源 URI 查询最近一次失败错误码
func get_last_error_code(resource_path: String) -> String:
	var canonical_path := AssetPathResolverClass.resolve_unified_uri(resource_path)
	return str(_last_errors.get(canonical_path, ""))

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
		_fail_media_load(new_task, path, ERR_MEDIA_MISSING, on_loaded)
		return task_id

	if _is_external_binary_image_path(path):
		_load_external_image_from_bytes(new_task, path, on_loaded)
		return task_id

	if _is_external_binary_audio_path(path):
		_load_external_audio_from_bytes(new_task, path, on_loaded)
		return task_id

	if _is_external_unsupported_mod_path(path):
		_fail_media_load(new_task, path, ERR_UNSUPPORTED_MEDIA_FORMAT, on_loaded)
		return task_id

	var request_error := ResourceLoader.load_threaded_request(path, "", false)
	if request_error != OK:
		_fail_media_load(new_task, path, ERR_THREAD_LOAD_FAILED, on_loaded)

	return task_id

func _is_external_binary_image_path(path: String) -> bool:
	var lower := path.to_lower()
	var is_image := lower.ends_with(".png") or lower.ends_with(".webp") or lower.ends_with(".jpg") or lower.ends_with(".jpeg") or lower.ends_with(".bmp") or lower.ends_with(".tga")
	if not is_image:
		return false
	return path.contains(".kmod!/") or path.begins_with("user://") or not ResourceLoader.exists(path)

func _is_external_binary_audio_path(path: String) -> bool:
	var lower := path.to_lower()
	var is_audio := lower.ends_with(".ogg") or lower.ends_with(".wav")
	if not is_audio:
		return false
	return path.contains(".kmod!/") or path.begins_with("user://") or not ResourceLoader.exists(path)

func _is_external_unsupported_mod_path(path: String) -> bool:
	if path.contains(".kmod!/"):
		return true
	if not path.begins_with("user://"):
		return false
	var file_extension := path.get_extension().to_lower()
	return not (file_extension in ["tres", "res", "tscn", "scn", "ogv"])

func _load_external_image_from_bytes(task: AsyncMediaTask, path: String, on_loaded: Callable) -> void:
	var raw_bytes := AssetPathResolverClass.read_mod_asset_bytes(path)
	if raw_bytes.is_empty():
		_fail_media_load(task, path, ERR_MEDIA_DECODE_FAILED, on_loaded)
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
		_fail_media_load(task, path, ERR_MEDIA_DECODE_FAILED, on_loaded)
		return
	var texture := ImageTexture.create_from_image(image)
	_mark_task_succeeded(task, path, texture, on_loaded)

func _load_external_audio_from_bytes(task: AsyncMediaTask, path: String, on_loaded: Callable) -> void:
	var raw_bytes := AssetPathResolverClass.read_mod_asset_bytes(path)
	if raw_bytes.is_empty():
		_fail_media_load(task, path, ERR_MEDIA_DECODE_FAILED, on_loaded)
		return
	var lower := path.to_lower()
	var audio_stream: AudioStream = null
	if lower.ends_with(".ogg"):
		audio_stream = AudioStreamOggVorbis.load_from_buffer(raw_bytes)
	elif lower.ends_with(".wav"):
		audio_stream = _decode_wav_audio_stream(raw_bytes)
	if audio_stream == null:
		_fail_media_load(task, path, ERR_MEDIA_DECODE_FAILED, on_loaded)
		return
	_mark_task_succeeded(task, path, audio_stream, on_loaded)

func _decode_wav_audio_stream(raw_bytes: PackedByteArray) -> AudioStreamWAV:
	if raw_bytes.size() < 44:
		return null
	if raw_bytes.slice(0, 4).get_string_from_ascii() != "RIFF":
		return null
	if raw_bytes.slice(8, 12).get_string_from_ascii() != "WAVE":
		return null
	var parsed := _parse_wav_chunks(raw_bytes)
	if not bool(parsed.get("valid", false)):
		return null
	var bits_per_sample: int = int(parsed.get("bits_per_sample", 0))
	var pcm_data: PackedByteArray = parsed.get("data", PackedByteArray())
	var converted := _convert_wav_pcm_bytes(pcm_data, bits_per_sample)
	if converted.is_empty():
		return null
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_8_BITS if bits_per_sample == 8 else AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = int(parsed.get("sample_rate", 44100))
	stream.stereo = int(parsed.get("channels", 1)) == 2
	stream.data = converted
	return stream

func _parse_wav_chunks(raw_bytes: PackedByteArray) -> Dictionary:
	var offset: int = 12
	var total_size: int = raw_bytes.size()
	var channels: int = 0
	var sample_rate: int = 0
	var bits_per_sample: int = 0
	var audio_format: int = 0
	var pcm_data := PackedByteArray()
	var has_format_chunk: bool = false
	while offset + 8 <= total_size:
		var chunk_id := raw_bytes.slice(offset, offset + 4).get_string_from_ascii()
		var chunk_size: int = raw_bytes.decode_u32(offset + 4)
		var data_start: int = offset + 8
		if data_start + chunk_size > total_size:
			break
		if chunk_id == "fmt " and chunk_size >= 16:
			audio_format = raw_bytes.decode_u16(data_start)
			channels = raw_bytes.decode_u16(data_start + 2)
			sample_rate = raw_bytes.decode_u32(data_start + 4)
			bits_per_sample = raw_bytes.decode_u16(data_start + 14)
			has_format_chunk = true
		elif chunk_id == "data" and chunk_size > 0:
			pcm_data = raw_bytes.slice(data_start, data_start + chunk_size)
		offset = data_start + chunk_size + (chunk_size & 1)
	var is_format_valid: bool = has_format_chunk and audio_format == 1 and (channels == 1 or channels == 2) and sample_rate > 0 and (bits_per_sample == 8 or bits_per_sample == 16)
	return {
		"valid": is_format_valid and not pcm_data.is_empty(),
		"channels": channels,
		"sample_rate": sample_rate,
		"bits_per_sample": bits_per_sample,
		"data": pcm_data
	}

func _convert_wav_pcm_bytes(pcm_data: PackedByteArray, bits_per_sample: int) -> PackedByteArray:
	if pcm_data.is_empty():
		return PackedByteArray()
	if bits_per_sample == 16:
		return pcm_data
	if bits_per_sample != 8:
		return PackedByteArray()
	var signed_bytes := PackedByteArray()
	signed_bytes.resize(pcm_data.size())
	for sample_index in range(pcm_data.size()):
		signed_bytes[sample_index] = (pcm_data[sample_index] - 128) & 0xFF
	return signed_bytes

func _complete_deterministic(task: AsyncMediaTask, path: String, on_loaded: Callable) -> void:
	_mark_task_succeeded(task, path, Resource.new(), on_loaded)

func _mark_task_succeeded(
	task: AsyncMediaTask,
	path: String,
	loaded_resource: Resource,
	on_loaded: Callable,
	erase_active: bool = true
) -> void:
	task.status = STATUS_LOADED
	task.progress = 1.0
	task.loaded_resource = loaded_resource
	task.error_code = ""
	_task_status_history[task.task_id] = STATUS_LOADED
	_task_error_history[task.task_id] = ""
	_last_errors.erase(path)
	if erase_active:
		_active_tasks.erase(task.task_id)
		_path_to_task_id.erase(path)
	_cache_loaded_resource(path, loaded_resource)
	_invoke_callback(on_loaded, loaded_resource)

func _fail_media_load(
	task: AsyncMediaTask,
	path: String,
	failure_code: String,
	on_loaded: Callable,
	erase_active: bool = true
) -> void:
	task.status = STATUS_FAILED
	task.progress = 0.0
	task.loaded_resource = null
	task.error_code = failure_code
	_task_status_history[task.task_id] = STATUS_FAILED
	_task_error_history[task.task_id] = failure_code
	_last_errors[path] = failure_code
	if erase_active:
		_active_tasks.erase(task.task_id)
		_path_to_task_id.erase(path)
	load_failed.emit(task.task_id, path, failure_code)
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
			_mark_task_succeeded(task, task.resource_path, loaded_resource, task.callback, false)
			completed_ids.append(task_id)
		elif status == ResourceLoader.THREAD_LOAD_FAILED or status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			_fail_media_load(task, task.resource_path, ERR_THREAD_LOAD_FAILED, task.callback, false)
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
	_task_status_history[task_id] = STATUS_CANCELLED
	_path_to_task_id.erase(task.resource_path)
	_active_tasks.erase(task_id)
	return true

## 同步快速判定某资源是否已在内存缓存就绪（未缓存/缺失均返回 false）
func is_resource_ready(resource_path: String) -> bool:
	var canonical_path := AssetPathResolverClass.resolve_unified_uri(resource_path)
	if canonical_path.is_empty():
		return false
	return _lru_cache.has(canonical_path)

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
