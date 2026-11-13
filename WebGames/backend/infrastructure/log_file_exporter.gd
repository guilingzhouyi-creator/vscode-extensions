# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_file_exporter.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/log.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 作为 EventBus 旁路流式消费者，依据 log.json export 配置执行日志落盘、 级别/通道过滤、容量轮转归档与全局序号对账（Inv-LG-3, Inv-LG-4）。
# 退出语义与设计依据: 统一结构化日志规范 / 性能基准审计
# ==============================================================================

## LogFileExporter：Log Collector & Stream Processor
class_name LogFileExporter extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const CryptoIntegrityLib = preload("res://backend/infrastructure/pure/crypto_integrity_lib.gd")

# ==============================================================================
# 一、单例与状态
# ==============================================================================

const MAX_PENDING_RETRY_BATCH: int = 4096

static var _instance: LogFileExporter = null
static var _config: LogExportConfigDTO = null
static var _config_version: int = -1
# 直调回退序号：仅当记录未被 EventBus 签发（sequence == 0，如单测直调 consume）时使用；
# 正常广播链路序号由 EventBus._record_seq 唯一签发，此处仅在直调缺号场景补号（Inv-LG-3 单一签发源）
static var _fallback_seq: int = 0
static var _exported_count: int = 0      # 实际已落盘成功的记录数（Inv-LG-3 对账）
static var _cached_file_size: int = -1   # 内存缓存主日志当前字节大小（防每行冗余 open 探查）
static var _pending_batch: Array[String] = [] # 异步/批处理暂存缓冲
static var _pending_seqs: Array[int] = []
static var _batch_threshold: int = LogConstants.DEFAULT_BATCH_THRESHOLD # 攒批阈值（默认 1 即刻写）
static var _last_chain_hash: String = LogConstants.CHAIN_GENESIS_HASH
static var _encryption_key_override: PackedByteArray = PackedByteArray()
static var _io_mutex: Mutex = Mutex.new()
static var _emitting_enc_error: bool = false

## 单例获取与配置新鲜度守卫
static func get_instance() -> LogFileExporter:
	if _instance == null:
		_instance = LogFileExporter.new()
	_ensure_config_fresh()
	return _instance

## 测试用加密密钥注入覆盖（仅接受 32 字节密钥；清空则恢复从受控环境变量读取）
static func set_encryption_key_for_test(key_32: PackedByteArray) -> void:
	_encryption_key_override = key_32.duplicate()

## 配置新鲜度守卫：热重载版本变更时先刷旧批再重建导出器配置（防跨目录混写）
static func _ensure_config_fresh() -> void:
	if _config != null and _config_version == GameConfig.config_reload_version():
		return
	if _config != null and _config.enabled and not _pending_batch.is_empty():
		_flush_unlocked()
	_config = LogExportConfigDTO.from_config()
	_config_version = GameConfig.config_reload_version()
	_cached_file_size = -1
	_batch_threshold = _config.batch_size

# ==============================================================================
# 二、旁路消费入口与过滤
# ==============================================================================

## 旁路消费入口：由 EventBus 广播链路调用，执行过滤与线程安全落盘
static func consume(record: LogRecordDTO) -> bool:
	if record == null:
		return false
	_io_mutex.lock()
	_ensure_config_fresh()
	if not _config.enabled:
		_io_mutex.unlock()
		return false
	if not _level_allowed(record.level) or not _channel_allowed(record.channel):
		_io_mutex.unlock()
		return false
	# 单一签发源：广播链路已带序号则原样保留，仅直调未签发记录在此补号
	if record.sequence == 0:
		_fallback_seq += 1
		record.sequence = _fallback_seq
	var ok := _append_to_file(record)
	_io_mutex.unlock()
	if not ok and _config != null and _config.encryption_enabled and _resolve_encryption_key_32().size() != LogConstants.AES_KEY_SIZE:
		_emit_encryption_fail_closed_alert(LogConstants.EVENT_LOG_ENCRYPTION_FALLBACK, SystemBaseMessages.MSG_LOG_ENCRYPTION_UNAVAILABLE)
	return ok

## 级别权重判断：debug < info < warn < error；record 级别 >= min_level 才允许落盘
static func _level_allowed(level: String) -> bool:
	return LogConstants.level_weight(level) >= LogConstants.level_weight(_config.min_level)

## 解析 32 字节日志加密密钥（测试注入优先，否则按 config seal_key_env 从环境变量派生）
static func _resolve_encryption_key_32() -> PackedByteArray:
	if _encryption_key_override.size() == LogConstants.AES_KEY_SIZE:
		return _encryption_key_override
	if _config == null or not _config.encryption_enabled:
		return PackedByteArray()
	return CryptoIntegrityLib.resolve_derived_key_32(_config.encryption_seal_key_env, LogConstants.ENC_DOMAIN_CONTEXT)

## 通道白名单判断（空白名单代表全通道允许）
static func _channel_allowed(channel: String) -> bool:
	return _config.include_channels.is_empty() or channel in _config.include_channels

# ==============================================================================
# 三、落盘与轮转归档
# ==============================================================================

## 恢复既有主日志文件尾部链尾哈希（保障跨进程重启追加不发生 CHAIN_BROKEN）
static func _recover_chain_hash_if_needed(main_path: String) -> void:
	if _last_chain_hash != LogConstants.CHAIN_GENESIS_HASH:
		return
	if not FileAccess.file_exists(main_path):
		return
	var fa := FileAccess.open(main_path, FileAccess.READ)
	if fa == null:
		return
	var last_line := ""
	var scanned := 0
	while not fa.eof_reached() and scanned < LogConstants.MAX_DISK_SCAN_LINES:
		scanned += 1
		var line := fa.get_line().strip_edges()
		if not line.is_empty():
			last_line = line
	fa.close()
	if last_line.is_empty():
		return
	var parsed: Variant = JSON.parse_string(last_line)
	if parsed is Dictionary and parsed.has(LogConstants.ENC_KEY_CHAIN_HASH):
		var tail_hash := str(parsed.get(LogConstants.ENC_KEY_CHAIN_HASH, ""))
		if not tail_hash.is_empty():
			_last_chain_hash = tail_hash

## 密钥缺失或加密失败闭环告警（带重入保护防递归风暴）
static func _emit_encryption_fail_closed_alert(code: String, detail: String) -> void:
	if _emitting_enc_error:
		return
	_emitting_enc_error = true
	ErrorReporter.emit_error(LogConstants.CHANNEL_SYSTEM, code, detail)
	_emitting_enc_error = false

## 高效流式追加写：Fail-Closed 加密前检与有界重试队列（密封延迟到轮转之后，杜绝跨轮转断链）
static func _append_to_file(record: LogRecordDTO) -> bool:
	var dir := _config.directory
	if dir.is_empty():
		return false
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)

	var plain_json := JSON.stringify(record.to_dto())
	if _config.encryption_enabled and _resolve_encryption_key_32().size() != LogConstants.AES_KEY_SIZE:
		return false

	if _pending_batch.size() >= MAX_PENDING_RETRY_BATCH:
		_pending_batch.remove_at(0)
		if not _pending_seqs.is_empty():
			_pending_seqs.remove_at(0)
	_pending_batch.append(plain_json)
	_pending_seqs.append(record.sequence)

	if LogConstants.is_critical_level(record.level) or _pending_batch.size() >= _batch_threshold:
		return _flush_unlocked() > 0
	return true

## 线程安全批量刷盘入口
static func flush() -> int:
	_io_mutex.lock()
	var count := _flush_unlocked()
	_io_mutex.unlock()
	return count

static func _prepare_write_line(plain_line: String, seq: int, main_path: String) -> Dictionary:
	if not _config.encryption_enabled:
		return {"ok": true, "line": plain_line, "chain_hash": _last_chain_hash}
	var key_32 := _resolve_encryption_key_32()
	if key_32.size() != LogConstants.AES_KEY_SIZE:
		return {"ok": false}
	if _config.hmac_chain_enabled:
		_recover_chain_hash_if_needed(main_path)
	var prev := _last_chain_hash if _config.hmac_chain_enabled else LogConstants.CHAIN_GENESIS_HASH
	var sealed := CryptoIntegrityLib.seal_log_record_envelope(plain_line, seq, key_32, prev)
	if sealed.is_empty():
		return {"ok": false}
	return {"ok": true, "line": JSON.stringify(sealed), "chain_hash": str(sealed.get(LogConstants.ENC_KEY_CHAIN_HASH, _last_chain_hash))}

## 内部批量刷盘（持有 _io_mutex 时调用）：先判轮转再密封落盘，保证新文件以 GENESIS 锚定
static func _flush_unlocked() -> int:
	if _pending_batch.is_empty() or _config == null or not _config.enabled or _config.directory.is_empty():
		return 0
	if not DirAccess.dir_exists_absolute(_config.directory):
		DirAccess.make_dir_recursive_absolute(_config.directory)

	var base := "%s/%s" % [_config.directory, _config.file_prefix]
	var main_path := base + LogConstants.LOG_FILE_EXTENSION
	var state: Dictionary = {"handle": null, "flushed": 0, "failed_idx": -1}

	for idx in range(_pending_batch.size()):
		if not _flush_single_pending_line(idx, base, main_path, state):
			state["failed_idx"] = idx
			break

	var handle: FileAccess = state.get("handle")
	if handle != null:
		handle.flush()
		handle.close()

	var failed_idx: int = int(state.get("failed_idx", -1))
	if failed_idx >= 0:
		_pending_batch = _pending_batch.slice(failed_idx)
		_pending_seqs = _pending_seqs.slice(failed_idx)
	else:
		_pending_batch.clear()
		_pending_seqs.clear()
	return int(state.get("flushed", 0))

static func _flush_single_pending_line(idx: int, base: String, main_path: String, state: Dictionary) -> bool:
	var plain_line: String = _pending_batch[idx]
	var seq: int = _pending_seqs[idx] if idx < _pending_seqs.size() else 0
	var handle: FileAccess = state.get("handle")
	if _needs_rotation(main_path):
		if handle != null:
			handle.flush()
			handle.close()
			handle = null
			state["handle"] = null
		_rotate_target_if_needed(base)

	var prepared := _prepare_write_line(plain_line, seq, main_path)
	if not bool(prepared.get("ok", false)):
		return false
	if handle == null:
		handle = _open_append_handle(main_path)
		if handle == null:
			return false
		state["handle"] = handle

	var line := str(prepared.get("line", ""))
	handle.store_line(line)
	if handle.get_error() != OK:
		return false
	if _config.encryption_enabled:
		_last_chain_hash = str(prepared.get("chain_hash", _last_chain_hash))
	_exported_count += 1
	state["flushed"] = int(state.get("flushed", 0)) + 1
	if _cached_file_size >= 0:
		_cached_file_size += line.to_utf8_buffer().size() + 1
	return true

static func _open_append_handle(target: String) -> FileAccess:
	if FileAccess.file_exists(target):
		var f := FileAccess.open(target, FileAccess.READ_WRITE)
		if f != null:
			f.seek_end()
		return f
	return FileAccess.open(target, FileAccess.WRITE)

static func _needs_rotation(main_path: String) -> bool:
	if _config.max_bytes <= 0:
		return false
	if _cached_file_size < 0:
		if FileAccess.file_exists(main_path):
			var check_f := FileAccess.open(main_path, FileAccess.READ)
			_cached_file_size = check_f.get_length() if check_f != null else 0
			if check_f != null:
				check_f.close()
		else:
			_cached_file_size = 0
	return _cached_file_size >= _config.max_bytes

## 轮转检查：若主日志文件超过 max_bytes，则原子重命名滚动为时间戳归档文件
static func _rotate_target_if_needed(base: String) -> String:
	var main_path := base + LogConstants.LOG_FILE_EXTENSION
	if _needs_rotation(main_path):
		var stamp := str(Time.get_unix_time_from_system())
		var archive_path := "%s.%s%s" % [base, stamp, LogConstants.LOG_FILE_EXTENSION]
		# 若同一秒内发生多次轮转，增补序号防覆盖
		if FileAccess.file_exists(archive_path):
			archive_path = "%s.%s_%d%s" % [base, stamp, _exported_count, LogConstants.LOG_FILE_EXTENSION]
		DirAccess.rename_absolute(main_path, archive_path)
		_cached_file_size = 0
		_last_chain_hash = LogConstants.CHAIN_GENESIS_HASH
		_prune_rotated(base)

	return main_path

static func _archive_sort_key(filename: String, prefix: String) -> Array[int]:
	var without_prefix := filename.substr(prefix.length() + 1)
	if without_prefix.ends_with(LogConstants.LOG_FILE_EXTENSION):
		var raw := without_prefix.left(without_prefix.length() - LogConstants.LOG_FILE_EXTENSION.length())
		var parts := raw.split("_")
		var ts := parts[0].to_int() if parts[0].is_valid_int() else 0
		var seq_num := parts[1].to_int() if (parts.size() > 1 and parts[1].is_valid_int()) else 0
		return [ts, seq_num]
	return [0, 0]

## 裁剪旧归档文件：按数值时间戳保留最近 max_files 份轮转文件，超出上限时删除最旧文件
static func _prune_rotated(base: String) -> void:
	if _config.max_files <= 0:
		return
	var dir := DirAccess.open(_config.directory)
	if dir == null:
		return
	var rotated: Array = []
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while not file_name.is_empty():
		if not dir.current_is_dir() and LogConstants.is_rotated_archive_filename(file_name, _config.file_prefix):
			rotated.append(file_name)
		file_name = dir.get_next()
	dir.list_dir_end()

	rotated.sort_custom(func(a: String, b: String) -> bool:
		var ka := _archive_sort_key(a, _config.file_prefix)
		var kb := _archive_sort_key(b, _config.file_prefix)
		if ka[0] != kb[0]:
			return ka[0] < kb[0]
		return ka[1] < kb[1]
	)
	while rotated.size() > _config.max_files:
		var oldest: String = rotated[0]
		DirAccess.remove_absolute("%s/%s" % [_config.directory, oldest])
		rotated.remove_at(0)

# ==============================================================================
# 四、测试复位
# ==============================================================================

## 测试复位与状态清空
static func reset_for_test() -> void:
	_instance = null
	_config = null
	_config_version = -1
	_fallback_seq = 0
	_exported_count = 0
	_cached_file_size = -1
	_pending_batch.clear()
	_pending_seqs.clear()
	_batch_threshold = LogConstants.DEFAULT_BATCH_THRESHOLD
	_last_chain_hash = LogConstants.CHAIN_GENESIS_HASH
	_encryption_key_override = PackedByteArray()
	_emitting_enc_error = false
