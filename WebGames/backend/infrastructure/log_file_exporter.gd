# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_file_exporter.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 作为 EventBus 旁路流式消费者，依据 log.json export 配置执行日志落盘、 级别/通道过滤、容量轮转归档与全局序号对账（Inv-LG-3, Inv-LG-4）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogFileExporter extends RefCounted

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

## 单例获取与配置新鲜度守卫
static func get_instance() -> LogFileExporter:
	if _instance == null:
		_instance = LogFileExporter.new()
	_ensure_config_fresh()
	return _instance

## 配置新鲜度守卫：热重载版本变更时自动重建导出器配置
static func _ensure_config_fresh() -> void:
	if _config != null and _config_version == GameConfig.config_reload_version():
		return
	_config = LogExportConfigDTO.from_config()
	_config_version = GameConfig.config_reload_version()

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
	return _level_weight(level) >= _level_weight(_config.min_level)

static func _level_weight(level: String) -> int:
	match level.to_upper():
		"DEBUG": return 0
		"INFO": return 1
		"WARN": return 2
		"ERROR": return 3
		_: return 1

## 通道白名单判断（空白名单代表全通道允许）
static func _channel_allowed(channel: String) -> bool:
	return _config.include_channels.is_empty() or channel in _config.include_channels

# ==============================================================================
# 三、落盘与轮转归档
# ==============================================================================

## 高效流式追加写：防 O(N²) I/O 放大，单行追加 + 刷新，轮转时原子重命名
static func _append_to_file(record: LogRecordDTO) -> bool:
	var dir := _config.directory
	if dir.is_empty():
		return false
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)

	var base := "%s/%s" % [dir, _config.file_prefix]
	var target := _rotate_target_if_needed(base)

	var f: FileAccess = null
	if FileAccess.file_exists(target):
		f = FileAccess.open(target, FileAccess.READ_WRITE)
		if f != null:
			f.seek_end()
	else:
		f = FileAccess.open(target, FileAccess.WRITE)

	if f == null:
		return false

	var line := JSON.stringify(record.to_dto())
	f.store_line(line)
	f.flush()
	f.close()

	_exported_count += 1
	return true

## 轮转检查：若主日志文件超过 max_bytes，则原子重命名滚动为时间戳归档文件
static func _rotate_target_if_needed(base: String) -> String:
	var main_path := base + ".log"
	if _config.max_bytes > 0 and FileAccess.file_exists(main_path):
		var check_f := FileAccess.open(main_path, FileAccess.READ)
		var file_size: int = check_f.get_length() if check_f != null else 0
		if check_f != null:
			check_f.close()

		if file_size >= _config.max_bytes:
			var stamp := str(Time.get_unix_time_from_system())
			var archive_path := "%s.%s.log" % [base, stamp]
			# 若同一秒内发生多次轮转，增补随机序号防覆盖
			if FileAccess.file_exists(archive_path):
				archive_path = "%s.%s_%d.log" % [base, stamp, _exported_count]
			DirAccess.rename_absolute(main_path, archive_path)
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
		if not dir.current_is_dir():
			if file_name.begins_with(_config.file_prefix + ".") and file_name.ends_with(".log") and file_name != _config.file_prefix + ".log":
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
