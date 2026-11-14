# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_query_service.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/log.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 跨介质合并内存环形缓冲实时数据与磁盘 NDJSON 导出历史数据， 执行六维过滤、分页切片与截断保护（Inv-LS-5 检索只读不变量）。
# 退出语义与设计依据: 统一结构化日志规范 / 性能基准审计
# ==============================================================================

## LogQueryService：Log Collector & Stream Processor
class_name LogQueryService extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const CryptoIntegrityLib = preload("res://backend/infrastructure/pure/crypto_integrity_lib.gd")

# ==============================================================================
# 一、状态与磁盘缓存
# ==============================================================================

## 单次查询最大返回条数（超限标记 truncated，防止无限内存放大）
const MAX_RESULTS: int = LogConstants.MAX_QUERY_RESULTS

# 磁盘日志解析缓存（Inv-LS-5 只读 + 有界收敛）：按 文件名+字节大小+mtime 签名失效，
# 磁盘未变更时复用上次解析结果，避免每次查询全量遍历解析（O(文件×行) → O(1) 命中）
static var _disk_cache: Array[Dictionary] = []
static var _disk_cache_signature: String = LogConstants.DISK_CACHE_UNINIT_SIG
static var _decryption_key_override: PackedByteArray = PackedByteArray()
static var _last_disk_tamper_count: int = 0

## 获取最近一次磁盘读取检测到的篡改/损坏行数（零静默吞错可观测接口）
static func get_last_disk_tamper_count() -> int:
	return _last_disk_tamper_count

## 磁盘日志目录签名：目录/前缀匹配文件名 + 大小 + 修改时间，任一变化即触发重解析
static func _disk_signature(dir_path: String, prefix: String) -> String:
	var dir_access := DirAccess.open(dir_path)
	if dir_access == null:
		return ""
	var parts: Array[String] = []
	for file_name in dir_access.get_files():
		if file_name.begins_with(prefix) and file_name.ends_with(LogConstants.LOG_FILE_EXTENSION):
			var full_path := "%s/%s" % [dir_path, file_name]
			var file_size := 0
			var file_handle := FileAccess.open(full_path, FileAccess.READ)
			if file_handle != null:
				file_size = file_handle.get_length()
				file_handle.close()
			var mtime := FileAccess.get_modified_time(full_path)
			parts.append("%s:%d:%d" % [file_name, file_size, mtime])
	parts.sort()
	return "|".join(parts)

## 测试专用解密密钥注入覆盖（仅接受 32 字节密钥；清空则恢复环境变量派生）
static func set_decryption_key_for_test(key_32: PackedByteArray) -> void:
	_decryption_key_override = key_32.duplicate()

## 测试隔离：清空磁盘解析缓存与密钥覆盖
static func reset_for_test() -> void:
	_disk_cache = []
	_disk_cache_signature = LogConstants.DISK_CACHE_UNINIT_SIG
	_decryption_key_override = PackedByteArray()
	_last_disk_tamper_count = 0

# ==============================================================================
# 二、六维过滤检索
# ==============================================================================

## 六维过滤检索入口（纯只读，Inv-LS-5）
static func query(criteria: LogQueryDTO.Criteria) -> LogQueryDTO.Result:
	var result := LogQueryDTO.Result.new()
	if criteria == null:
		return result

	result.page = criteria.page

	# 收集两路数据
	var records_by_sequence: Dictionary = {}
	var unsequenced_counter := 0

	# 源 1：内存环形缓冲
	var ring_records := LogRingBuffer.query(criteria.from_utc, criteria.levels, criteria.channels)
	for record_item in ring_records:
		if record_item is StructuredLogRecord:
			var record_dict: Dictionary = record_item.to_dto()
			var sequence_number: int = int(record_dict.get(LogConstants.KEY_SEQUENCE, 0))
			var record_key: Variant = sequence_number
			if sequence_number <= 0:
				unsequenced_counter += 1
				record_key = LogConstants.UNSEQ_RING_KEY_FMT % [int(record_dict.get(LogConstants.KEY_TIMESTAMP_UTC, 0)), unsequenced_counter]
			records_by_sequence[record_key] = record_dict

	# 源 2：磁盘导出文件（若存在）
	var disk_records := _read_disk_logs()
	for record_dict in disk_records:
		var sequence_number: int = int(record_dict.get(LogConstants.KEY_SEQUENCE, 0))
		var record_key: Variant = sequence_number
		if sequence_number <= 0:
			unsequenced_counter += 1
			record_key = LogConstants.UNSEQ_DISK_KEY_FMT % [int(record_dict.get(LogConstants.KEY_TIMESTAMP_UTC, 0)), unsequenced_counter]
		if not records_by_sequence.has(record_key):
			records_by_sequence[record_key] = record_dict

	# 统一过滤
	var filtered: Array[Dictionary] = []
	for record_key in records_by_sequence.keys():
		var record_dict: Dictionary = records_by_sequence[record_key]
		if _matches_criteria(record_dict, criteria):
			filtered.append(record_dict)

	# 排序：优先按 sequence 单调升序，未签发记录按 timestamp_utc 排序
	filtered.sort_custom(func(left_record: Dictionary, right_record: Dictionary) -> bool:
		var left_sequence := int(left_record.get(LogConstants.KEY_SEQUENCE, 0))
		var right_sequence := int(right_record.get(LogConstants.KEY_SEQUENCE, 0))
		if left_sequence != right_sequence:
			return left_sequence < right_sequence
		return int(left_record.get(LogConstants.KEY_TIMESTAMP_UTC, 0)) < int(right_record.get(LogConstants.KEY_TIMESTAMP_UTC, 0))
	)

	result.total = filtered.size()
	result.truncated = filtered.size() > MAX_RESULTS

	var page_size := criteria.page_size
	var start_index := (criteria.page - 1) * page_size
	var max_capped := mini(filtered.size(), MAX_RESULTS)

	if start_index < max_capped:
		var end_index := mini(start_index + page_size, max_capped)
		for record_index in range(start_index, end_index):
			result.records.append(filtered[record_index])

	return result

# ==============================================================================
# 三、内部实现（过滤匹配 / 磁盘解析）
# ==============================================================================

## 时间窗过滤断言
static func _matches_time_window(record_dict: Dictionary, criteria: LogQueryDTO.Criteria) -> bool:
	var timestamp_utc := int(record_dict.get(LogConstants.KEY_TIMESTAMP_UTC, 0))
	if criteria.from_utc > 0 and timestamp_utc < criteria.from_utc:
		return false
	if criteria.to_utc > 0 and timestamp_utc > criteria.to_utc:
		return false
	return true

## 日志级别与频道过滤断言
static func _matches_level_and_channel(record_dict: Dictionary, criteria: LogQueryDTO.Criteria) -> bool:
	if not criteria.levels.is_empty():
		var record_level := str(record_dict.get(LogConstants.KEY_LEVEL, ""))
		var level_matched := false
		for criteria_level in criteria.levels:
			if record_level.nocasecmp_to(str(criteria_level)) == 0:
				level_matched = true
				break
		if not level_matched:
			return false

	if not criteria.channels.is_empty():
		var record_channel := str(record_dict.get(LogConstants.KEY_CHANNEL, ""))
		if not (record_channel in criteria.channels):
			return false

	return true

## trace_id、error_code 与关键字过滤断言
static func _matches_identifiers_and_keyword(record_dict: Dictionary, criteria: LogQueryDTO.Criteria) -> bool:
	if not criteria.trace_id.is_empty():
		var record_trace_id := str(record_dict.get(LogConstants.KEY_TRACE_ID, ""))
		if record_trace_id != criteria.trace_id:
			return false

	if not criteria.error_code.is_empty():
		var record_error_code := str(record_dict.get(LogConstants.KEY_ERROR_CODE, ""))
		if record_error_code != criteria.error_code:
			return false

	if not criteria.keyword.is_empty():
		var record_message := str(record_dict.get(LogConstants.KEY_MESSAGE, ""))
		if not record_message.contains(criteria.keyword):
			return false

	return true

## 六维过滤匹配：时间窗/级别/通道/trace_id/error_code/关键字，任一不满足即排除
static func _matches_criteria(record_dict: Dictionary, criteria: LogQueryDTO.Criteria) -> bool:
	if not _matches_time_window(record_dict, criteria):
		return false
	if not _matches_level_and_channel(record_dict, criteria):
		return false
	return _matches_identifiers_and_keyword(record_dict, criteria)

## 解析 32 字节日志解密密钥（测试注入优先，否则从配置指定环境变量派生）
static func _resolve_decryption_key_32() -> PackedByteArray:
	if _decryption_key_override.size() == LogConstants.AES_KEY_SIZE:
		return _decryption_key_override
	var encryption_config := GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_ENCRYPTION, {})
	var env_name := str(encryption_config.get(LogConstants.ENC_KEY_SEAL_ENV_CFG, LogConstants.ENC_DEFAULT_SEAL_ENV))
	return CryptoIntegrityLib.resolve_derived_key_32(env_name, LogConstants.ENC_DOMAIN_CONTEXT)

## 解析单条磁盘日志记录（加密启用时严禁明文混入；损坏/验签失败显式计入篡改计数）
static func _decode_disk_record(parsed_dict: Dictionary, key_32: PackedByteArray, require_encrypted: bool = false) -> Dictionary:
	if not CryptoIntegrityLib.is_encrypted_envelope(parsed_dict):
		if require_encrypted:
			_last_disk_tamper_count += 1
			return {}
		return parsed_dict
	if key_32.size() != LogConstants.AES_KEY_SIZE:
		_last_disk_tamper_count += 1
		return {}
	var opened := CryptoIntegrityLib.open_log_record_envelope(parsed_dict, key_32, true)
	if bool(opened.get("ok", false)) and opened.get("data") is Dictionary:
		return opened["data"]
	_last_disk_tamper_count += 1
	return {}

## 密码学审计：逐行校验加密日志文件的 HMAC 签名、序号合法性、超限截断与防篡改哈希链完整性
static func verify_encrypted_log_file(file_path: String, key_32: PackedByteArray, hmac_chain_enabled: bool = true) -> Dictionary:
	if not FileAccess.file_exists(file_path):
		return {"ok": false, "verified_count": 0, "tampered_at_seq": 0, "error": LogConstants.LOG_ERR_FILE_NOT_FOUND}
	var file_handle := FileAccess.open(file_path, FileAccess.READ)
	if file_handle == null:
		return {"ok": false, "verified_count": 0, "tampered_at_seq": 0, "error": LogConstants.LOG_ERR_FILE_OPEN_FAILED}

	var previous_chain := LogConstants.CHAIN_GENESIS_HASH
	var verified_count := 0
	var json_parser := JSON.new()
	while not file_handle.eof_reached() and verified_count < LogConstants.MAX_DISK_SCAN_LINES:
		var line := file_handle.get_line().strip_edges()
		if line.is_empty():
			continue
		if json_parser.parse(line) != OK or not (json_parser.data is Dictionary):
			file_handle.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": 0, "error": LogConstants.LOG_ERR_JSON_CORRUPT}
		var envelope: Dictionary = json_parser.data
		var sequence_number := int(envelope.get(LogConstants.ENC_KEY_SEQUENCE, 0))
		if sequence_number <= 0:
			file_handle.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": sequence_number, "error": LogConstants.LOG_ERR_SEQ_NON_MONOTONIC}
		var opened := CryptoIntegrityLib.open_log_record_envelope(envelope, key_32, true)
		if not bool(opened.get("ok", false)):
			file_handle.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": sequence_number, "error": str(opened.get("error", LogConstants.LOG_ERR_MAC_MISMATCH))}
		var ciphertext_base64 := str(envelope.get(LogConstants.ENC_KEY_CIPHERTEXT, ""))
		var chain_base := previous_chain if hmac_chain_enabled else LogConstants.CHAIN_GENESIS_HASH
		var expected_chain := CryptoIntegrityLib.compute_chain_digest(chain_base, sequence_number, ciphertext_base64)
		var recorded_chain := str(envelope.get(LogConstants.ENC_KEY_CHAIN_HASH, ""))
		if not CryptoIntegrityLib.constant_time_equals(expected_chain, recorded_chain):
			file_handle.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": sequence_number, "error": LogConstants.LOG_ERR_CHAIN_BROKEN}
		previous_chain = recorded_chain
		verified_count += 1

	var hit_scan_limit := _has_more_nonempty_lines(file_handle)
	file_handle.close()
	if verified_count == 0:
		return {"ok": false, "verified_count": 0, "tampered_at_seq": 0, "error": LogConstants.LOG_ERR_TRUNCATED_EMPTY}
	if hit_scan_limit:
		return {"ok": false, "verified_count": verified_count, "tampered_at_seq": 0, "error": LogConstants.LOG_ERR_SCAN_LIMIT}
	return {"ok": true, "verified_count": verified_count, "tampered_at_seq": 0, "error": ""}

static func _has_more_nonempty_lines(file_handle: FileAccess) -> bool:
	while not file_handle.eof_reached():
		if not file_handle.get_line().strip_edges().is_empty():
			return true
	return false

## 读取单个磁盘日志文件并解码至输出数组（嵌套浅层分离，异常行计数留痕）
static func _read_single_log_file(full_path: String, key_32: PackedByteArray, require_encrypted: bool, output_records: Array[Dictionary]) -> void:
	var file_handle := FileAccess.open(full_path, FileAccess.READ)
	if file_handle == null:
		return
	var json_parser := JSON.new()
	var read_count := 0
	while not file_handle.eof_reached() and read_count < LogConstants.MAX_DISK_SCAN_LINES:
		read_count += 1
		var line := file_handle.get_line().strip_edges()
		if line.is_empty():
			continue
		if json_parser.parse(line) == OK and json_parser.data is Dictionary:
			var decoded := _decode_disk_record(json_parser.data, key_32, require_encrypted)
			if not decoded.is_empty():
				output_records.append(decoded)
		else:
			_last_disk_tamper_count += 1
	file_handle.close()

## 读取磁盘 NDJSON 导出日志（签名命中直接复用缓存，磁盘变更才重解析；支持透明解密与篡改计数）
static func _read_disk_logs() -> Array[Dictionary]:
	var dir_path := GameConfig.get_string(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_DIR, LogConstants.DEFAULT_LOG_DIR)
	var prefix := GameConfig.get_string(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_PREFIX, LogConstants.DEFAULT_LOG_PREFIX)

	var disk_signature := _disk_signature(dir_path, prefix)
	if disk_signature == _disk_cache_signature:
		return _disk_cache

	_last_disk_tamper_count = 0
	var decoded_records: Array[Dictionary] = []
	var dir_access := DirAccess.open(dir_path)
	if dir_access == null:
		_disk_cache = decoded_records
		_disk_cache_signature = disk_signature
		return decoded_records

	var encryption_config := GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_ENCRYPTION, {})
	var require_encrypted := bool(encryption_config.get("enabled", false)) or _decryption_key_override.size() == LogConstants.AES_KEY_SIZE
	var key_32 := _resolve_decryption_key_32()
	var files: PackedStringArray = dir_access.get_files()
	var sorted_files: Array[String] = []
	for file_name in files:
		if file_name.begins_with(prefix) and file_name.ends_with(LogConstants.LOG_FILE_EXTENSION):
			sorted_files.append(file_name)
	sorted_files.sort()
	for sorted_file in sorted_files:
		_read_single_log_file("%s/%s" % [dir_path, sorted_file], key_32, require_encrypted, decoded_records)

	_disk_cache = decoded_records
	_disk_cache_signature = disk_signature
	return decoded_records
