# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_query_service.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
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
static var _disk_cache_signature: String = ""
static var _decryption_key_override: PackedByteArray = PackedByteArray()

## 磁盘日志目录签名：目录/前缀匹配文件名 + 大小 + 修改时间，任一变化即触发重解析
static func _disk_signature(dir_path: String, prefix: String) -> String:
	var da := DirAccess.open(dir_path)
	if da == null:
		return ""
	var parts: Array[String] = []
	for f in da.get_files():
		if f.begins_with(prefix) and f.ends_with(LogConstants.LOG_FILE_EXTENSION):
			var full_path := "%s/%s" % [dir_path, f]
			var size := 0
			var fa := FileAccess.open(full_path, FileAccess.READ)
			if fa != null:
				size = fa.get_length()
				fa.close()
			var mtime := FileAccess.get_modified_time(full_path)
			parts.append("%s:%d:%d" % [f, size, mtime])
	parts.sort()
	return "|".join(parts)

## 测试专用解密密钥注入覆盖（仅接受 32 字节密钥；清空则恢复环境变量派生）
static func set_decryption_key_for_test(key_32: PackedByteArray) -> void:
	_decryption_key_override = key_32.duplicate()

## 测试隔离：清空磁盘解析缓存与密钥覆盖
static func reset_for_test() -> void:
	_disk_cache = []
	_disk_cache_signature = ""
	_decryption_key_override = PackedByteArray()

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
	var records_by_seq: Dictionary = {}
	var unseq_counter := 0

	# 源 1：内存环形缓冲
	var ring_records := LogRingBuffer.query(criteria.from_utc, criteria.levels, criteria.channels)
	for rec in ring_records:
		if rec is StructuredLogRecord:
			var dto: Dictionary = rec.to_dto()
			var seq: int = int(dto.get(LogConstants.KEY_SEQUENCE, 0))
			var key: Variant = seq
			if seq <= 0:
				unseq_counter += 1
				key = "unseq_ring_%d_%d" % [int(dto.get(LogConstants.KEY_TIMESTAMP_UTC, 0)), unseq_counter]
			records_by_seq[key] = dto

	# 源 2：磁盘导出文件（若存在）
	var disk_records := _read_disk_logs()
	for dto in disk_records:
		var seq: int = int(dto.get(LogConstants.KEY_SEQUENCE, 0))
		var key: Variant = seq
		if seq <= 0:
			unseq_counter += 1
			key = "unseq_disk_%d_%d" % [int(dto.get(LogConstants.KEY_TIMESTAMP_UTC, 0)), unseq_counter]
		if not records_by_seq.has(key):
			records_by_seq[key] = dto

	# 统一过滤
	var filtered: Array[Dictionary] = []
	for k in records_by_seq.keys():
		var dto: Dictionary = records_by_seq[k]
		if _matches_criteria(dto, criteria):
			filtered.append(dto)

	# 排序：优先按 sequence 单调升序，未签发记录按 timestamp_utc 排序
	filtered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var sa := int(a.get(LogConstants.KEY_SEQUENCE, 0))
		var sb := int(b.get(LogConstants.KEY_SEQUENCE, 0))
		if sa != sb:
			return sa < sb
		return int(a.get(LogConstants.KEY_TIMESTAMP_UTC, 0)) < int(b.get(LogConstants.KEY_TIMESTAMP_UTC, 0))
	)

	result.total = filtered.size()
	result.truncated = filtered.size() > MAX_RESULTS

	var page_size := criteria.page_size
	var start_idx := (criteria.page - 1) * page_size
	var max_capped := mini(filtered.size(), MAX_RESULTS)

	if start_idx < max_capped:
		var end_idx := mini(start_idx + page_size, max_capped)
		for i in range(start_idx, end_idx):
			result.records.append(filtered[i])

	return result

# ==============================================================================
# 三、内部实现（过滤匹配 / 磁盘解析）
# ==============================================================================

## 时间窗过滤断言
static func _matches_time_window(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	var ts := int(dto.get(LogConstants.KEY_TIMESTAMP_UTC, 0))
	if c.from_utc > 0 and ts < c.from_utc:
		return false
	if c.to_utc > 0 and ts > c.to_utc:
		return false
	return true

## 日志级别与频道过滤断言
static func _matches_level_and_channel(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	if not c.levels.is_empty():
		var lvl := str(dto.get(LogConstants.KEY_LEVEL, ""))
		var hit_lvl := false
		for cl in c.levels:
			if lvl.nocasecmp_to(str(cl)) == 0:
				hit_lvl = true
				break
		if not hit_lvl:
			return false

	if not c.channels.is_empty():
		var ch := str(dto.get(LogConstants.KEY_CHANNEL, ""))
		if not (ch in c.channels):
			return false

	return true

## trace_id、error_code 与关键字过滤断言
static func _matches_identifiers_and_keyword(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	if not c.trace_id.is_empty():
		var tr := str(dto.get(LogConstants.KEY_TRACE_ID, ""))
		if tr != c.trace_id:
			return false

	if not c.error_code.is_empty():
		var ec := str(dto.get(LogConstants.KEY_ERROR_CODE, ""))
		if ec != c.error_code:
			return false

	if not c.keyword.is_empty():
		var msg := str(dto.get(LogConstants.KEY_MESSAGE, ""))
		if not msg.contains(c.keyword):
			return false

	return true

## 六维过滤匹配：时间窗/级别/通道/trace_id/error_code/关键字，任一不满足即排除
static func _matches_criteria(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	if not _matches_time_window(dto, c):
		return false
	if not _matches_level_and_channel(dto, c):
		return false
	return _matches_identifiers_and_keyword(dto, c)

## 解析 32 字节日志解密密钥（测试注入优先，否则从配置指定环境变量派生）
static func _resolve_decryption_key_32() -> PackedByteArray:
	if _decryption_key_override.size() == LogConstants.AES_KEY_SIZE:
		return _decryption_key_override
	var enc_cfg := GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_ENCRYPTION, {})
	var env_name := str(enc_cfg.get("seal_key_env", LogConstants.ENC_DEFAULT_SEAL_ENV))
	return CryptoIntegrityLib.resolve_derived_key_32(env_name, LogConstants.ENC_DOMAIN_CONTEXT)

## 解析单条磁盘日志记录（明文直接透传，加密信封透明验签并解密）
static func _decode_disk_record(parsed_dict: Dictionary, key_32: PackedByteArray) -> Dictionary:
	if not CryptoIntegrityLib.is_encrypted_envelope(parsed_dict):
		return parsed_dict
	if key_32.size() != LogConstants.AES_KEY_SIZE:
		return {}
	var opened := CryptoIntegrityLib.open_log_record_envelope(parsed_dict, key_32, true)
	if bool(opened.get("ok", false)) and opened.get("data") is Dictionary:
		return opened["data"]
	return {}

## 密码学审计：逐行校验加密日志文件的 HMAC 签名与防篡改哈希链完整性
static func verify_encrypted_log_file(file_path: String, key_32: PackedByteArray) -> Dictionary:
	if not FileAccess.file_exists(file_path):
		return {"ok": false, "verified_count": 0, "tampered_at_seq": 0, "error": "FILE_NOT_FOUND"}
	var fa := FileAccess.open(file_path, FileAccess.READ)
	if fa == null:
		return {"ok": false, "verified_count": 0, "tampered_at_seq": 0, "error": "FILE_OPEN_FAILED"}

	var prev_chain := LogConstants.CHAIN_GENESIS_HASH
	var verified_count := 0
	var json_inst := JSON.new()
	while not fa.eof_reached() and verified_count < LogConstants.MAX_DISK_SCAN_LINES:
		var line := fa.get_line().strip_edges()
		if line.is_empty():
			continue
		if json_inst.parse(line) != OK or not (json_inst.data is Dictionary):
			fa.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": 0, "error": "JSON_CORRUPT"}
		var env: Dictionary = json_inst.data
		var seq := int(env.get(LogConstants.ENC_KEY_SEQUENCE, 0))
		var opened := CryptoIntegrityLib.open_log_record_envelope(env, key_32, true)
		if not bool(opened.get("ok", false)):
			fa.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": seq, "error": str(opened.get("error", "OPEN_FAILED"))}
		var ct_b64 := str(env.get(LogConstants.ENC_KEY_CIPHERTEXT, ""))
		var expected_chain := CryptoIntegrityLib.compute_chain_digest(prev_chain, seq, ct_b64)
		var recorded_chain := str(env.get(LogConstants.ENC_KEY_CHAIN_HASH, ""))
		if not CryptoIntegrityLib.constant_time_equals(expected_chain, recorded_chain):
			fa.close()
			return {"ok": false, "verified_count": verified_count, "tampered_at_seq": seq, "error": "CHAIN_BROKEN"}
		prev_chain = recorded_chain
		verified_count += 1
	fa.close()
	return {"ok": true, "verified_count": verified_count, "tampered_at_seq": 0, "error": ""}

## 读取磁盘 NDJSON 导出日志（签名命中直接复用缓存，磁盘变更才重解析；支持透明解密）
static func _read_disk_logs() -> Array[Dictionary]:
	var dir_path := GameConfig.get_string(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_DIR, LogConstants.DEFAULT_LOG_DIR)
	var prefix := GameConfig.get_string(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT_PREFIX, LogConstants.DEFAULT_LOG_PREFIX)

	# 签名命中直接复用缓存（磁盘未变更时零解析，O(1)）
	var sig := _disk_signature(dir_path, prefix)
	if sig == _disk_cache_signature:
		return _disk_cache

	var out: Array[Dictionary] = []
	var da := DirAccess.open(dir_path)
	if da == null:
		_disk_cache = out
		_disk_cache_signature = sig
		return out

	var key_32 := _resolve_decryption_key_32()
	var json_inst := JSON.new()
	for f in da.get_files():
		if not (f.begins_with(prefix) and f.ends_with(LogConstants.LOG_FILE_EXTENSION)):
			continue
		var fa := FileAccess.open("%s/%s" % [dir_path, f], FileAccess.READ)
		if fa == null:
			continue
		var read_count := 0
		while not fa.eof_reached() and read_count < LogConstants.MAX_DISK_SCAN_LINES:
			read_count += 1
			var line := fa.get_line().strip_edges()
			if line.is_empty():
				continue
			if json_inst.parse(line) == OK and json_inst.data is Dictionary:
				var decoded := _decode_disk_record(json_inst.data, key_32)
				if not decoded.is_empty():
					out.append(decoded)
		fa.close()
	_disk_cache = out
	_disk_cache_signature = sig
	return out
