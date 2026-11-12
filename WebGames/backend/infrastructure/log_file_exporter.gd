# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_file_exporter.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
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

static var _instance: LogFileExporter = null
static var _config: LogExportConfigDTO = null
static var _config_version: int = -1
# 直调回退序号：仅当记录未被 EventBus 签发（sequence == 0，如单测直调 consume）时使用；
# 正常广播链路序号由 EventBus._record_seq 唯一签发，此处仅在直调缺号场景补号（Inv-LG-3 单一签发源）
static var _fallback_seq: int = 0
static var _exported_count: int = 0      # 实际已落盘成功的记录数（Inv-LG-3 对账）
static var _cached_file_size: int = -1   # 内存缓存主日志当前字节大小（防每行冗余 open 探查）
static var _pending_batch: Array[String] = [] # 异步/批处理暂存缓冲
static var _batch_threshold: int = LogConstants.DEFAULT_BATCH_THRESHOLD # 攒批阈值（默认 1 即刻写）
static var _last_chain_hash: String = LogConstants.CHAIN_GENESIS_HASH
static var _encryption_key_override: PackedByteArray = PackedByteArray()

## 单例获取与配置新鲜度守卫
static func get_instance() -> LogFileExporter:
	if _instance == null:
		_instance = LogFileExporter.new()
	_ensure_config_fresh()
	return _instance

## 测试用加密密钥注入覆盖（仅接受 32 字节密钥；清空则恢复从受控环境变量读取）
static func set_encryption_key_for_test(key_32: PackedByteArray) -> void:
	_encryption_key_override = key_32.duplicate()

## 配置新鲜度守卫：热重载版本变更时自动重建导出器配置
static func _ensure_config_fresh() -> void:
	if _config != null and _config_version == GameConfig.config_reload_version():
		return
	_config = LogExportConfigDTO.from_config()
	_config_version = GameConfig.config_reload_version()
	_cached_file_size = -1
	_batch_threshold = _config.batch_size

# ==============================================================================
# 二、旁路消费入口与过滤
# ==============================================================================

## 旁路消费入口：由 EventBus 广播链路调用，执行过滤与落盘
static func consume(record: LogRecordDTO) -> bool:
	if record == null:
		return false
	_ensure_config_fresh()
	if not _config.enabled:
		return false
	if not _level_allowed(record.level) or not _channel_allowed(record.channel):
		return false
	# 单一签发源：广播链路已带序号则原样保留，仅直调未签发记录在此补号
	if record.sequence == 0:
		_fallback_seq += 1
		record.sequence = _fallback_seq
	return _append_to_file(record)

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

## 高效流式追加写：防 O(N²) I/O 放大，单行追加 + 刷新，轮转时原子重命名（支持 AES-256-CBC Encrypt-then-MAC 加密）
static func _append_to_file(record: LogRecordDTO) -> bool:
	var dir := _config.directory
	if dir.is_empty():
		return false
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)

	var plain_json := JSON.stringify(record.to_dto())
	var line := plain_json
	if _config.encryption_enabled:
		var key_32 := _resolve_encryption_key_32()
		if key_32.size() == LogConstants.AES_KEY_SIZE:
			var prev := _last_chain_hash if _config.hmac_chain_enabled else LogConstants.CHAIN_GENESIS_HASH
			var sealed := CryptoIntegrityLib.seal_log_record_envelope(plain_json, record.sequence, key_32, prev)
			if not sealed.is_empty():
				_last_chain_hash = str(sealed.get(LogConstants.ENC_KEY_CHAIN_HASH, _last_chain_hash))
				line = JSON.stringify(sealed)

	_pending_batch.append(line)

	if LogConstants.is_critical_level(record.level) or _pending_batch.size() >= _batch_threshold:
		return flush() > 0
	return true

## 批量刷盘（Barrier Flush）：单句柄复用写入 pending 队列并刷新，跨轮转时安全先关后移
static func flush() -> int:
	if _pending_batch.is_empty() or _config == null or not _config.enabled:
		return 0
	var dir := _config.directory
	if dir.is_empty():
		_pending_batch.clear()
		return 0
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)

	var base := "%s/%s" % [dir, _config.file_prefix]
	var main_path := base + LogConstants.LOG_FILE_EXTENSION
	var flushed_count := 0
	var f: FileAccess = null

	for line in _pending_batch:
		if _needs_rotation(main_path):
			if f != null:
				f.flush()
				f.close()
				f = null
			_rotate_target_if_needed(base)

		if f == null:
			f = _open_append_handle(main_path)
			if f == null:
				continue

		f.store_line(line)
		_exported_count += 1
		flushed_count += 1
		if _cached_file_size >= 0:
			_cached_file_size += line.length() + 1

	if f != null:
		f.flush()
		f.close()

	_pending_batch.clear()
	return flushed_count

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
		_prune_rotated(base)

	return main_path

## 裁剪旧归档文件：保留最近 max_files 份轮转文件，超出上限时删除最旧文件
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

	rotated.sort()
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
	_batch_threshold = LogConstants.DEFAULT_BATCH_THRESHOLD
	_last_chain_hash = LogConstants.CHAIN_GENESIS_HASH
	_encryption_key_override = PackedByteArray()
