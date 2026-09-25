# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_query_service.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 跨介质合并内存环形缓冲实时数据与磁盘 NDJSON 导出历史数据， 执行六维过滤、分页切片与截断保护（Inv-LS-5 检索只读不变量）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogQueryService extends RefCounted

# ==============================================================================
# 一、状态与磁盘缓存
# ==============================================================================

## 单次查询最大返回条数（超限标记 truncated，防止无限内存放大）
const MAX_RESULTS: int = 5000

# 磁盘日志解析缓存（Inv-LS-5 只读 + 有界收敛）：按 文件名+字节大小+mtime 签名失效，
# 磁盘未变更时复用上次解析结果，避免每次查询全量遍历解析（O(文件×行) → O(1) 命中）
static var _disk_cache: Array[Dictionary] = []
static var _disk_cache_signature: String = ""

## 磁盘日志目录签名：目录/前缀匹配文件名 + 大小 + 修改时间，任一变化即触发重解析
static func _disk_signature(dir_path: String, prefix: String) -> String:
	var da := DirAccess.open(dir_path)
	if da == null:
		return ""
	var parts: Array[String] = []
	for f in da.get_files():
		if f.begins_with(prefix) and f.ends_with(".log"):
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

## 测试隔离：清空磁盘解析缓存
static func reset_for_test() -> void:
	_disk_cache = []
	_disk_cache_signature = ""

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
	
	# 源 1：内存环形缓冲
	var ring_records := LogRingBuffer.query(criteria.from_utc, criteria.levels, criteria.channels)
	for rec in ring_records:
		if rec is StructuredLogRecord:
			var dto: Dictionary = rec.to_dto()
			var seq: int = int(dto.get("sequence", 0))
			records_by_seq[seq] = dto
			
	# 源 2：磁盘导出文件（若存在）
	var disk_records := _read_disk_logs()
	for dto in disk_records:
		var seq: int = int(dto.get("sequence", 0))
		if not records_by_seq.has(seq):
			records_by_seq[seq] = dto
			
	# 统一过滤
	var filtered: Array[Dictionary] = []
	for seq in records_by_seq.keys():
		var dto: Dictionary = records_by_seq[seq]
		if _matches_criteria(dto, criteria):
			filtered.append(dto)
			
	# 排序：按 sequence 单调升序
	filtered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a.get("sequence", 0)) < int(b.get("sequence", 0))
	)
	
	result.total = filtered.size()
	result.truncated = filtered.size() > MAX_RESULTS
	
	var page_size := criteria.page_size
	var start_idx := (criteria.page - 1) * page_size
	var max_capped := mini(filtered.size(), MAX_RESULTS)
	
	if start_idx < max_capped:
		var end_idx := mini(start_idx + page_size, max_capped)
		for i in range(start_idx, end_idx):
			result.records.append(filtered[i].duplicate(true))
			
	return result

# ==============================================================================
# 三、内部实现（过滤匹配 / 磁盘解析）
# ==============================================================================

## 时间窗过滤断言
static func _matches_time_window(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	var ts := int(dto.get("timestamp_utc", 0))
	if c.from_utc > 0 and ts < c.from_utc:
		return false
	if c.to_utc > 0 and ts > c.to_utc:
		return false
	return true

## 日志级别与频道过滤断言
static func _matches_level_and_channel(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	if not c.levels.is_empty():
		var lvl := str(dto.get("level", ""))
		var hit_lvl := false
		for cl in c.levels:
			if lvl.nocasecmp_to(str(cl)) == 0:
				hit_lvl = true
				break
		if not hit_lvl:
			return false

	if not c.channels.is_empty():
		var ch := str(dto.get("channel", ""))
		if not (ch in c.channels):
			return false

	return true

## trace_id、error_code 与关键字过滤断言
static func _matches_identifiers_and_keyword(dto: Dictionary, c: LogQueryDTO.Criteria) -> bool:
	if not c.trace_id.is_empty():
		var tr := str(dto.get("trace_id", ""))
		if tr != c.trace_id:
			return false

	if not c.error_code.is_empty():
		var ec := str(dto.get("error_code", ""))
		if ec != c.error_code:
			return false

	if not c.keyword.is_empty():
		var msg := str(dto.get("message", ""))
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

## 读取磁盘 NDJSON 导出日志（签名命中直接复用缓存，磁盘变更才重解析）
static func _read_disk_logs() -> Array[Dictionary]:
	var dir_path := GameConfig.get_string("infrastructure.log", "export/directory", "user://logs")
	var prefix := GameConfig.get_string("infrastructure.log", "export/file_prefix", "kalar")

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

	var files := da.get_files()
	for f in files:
		if f.begins_with(prefix) and f.ends_with(".log"):
			var full_path := "%s/%s" % [dir_path, f]
			var fa := FileAccess.open(full_path, FileAccess.READ)
			if fa == null:
				continue
			var read_count := 0
			while not fa.eof_reached() and read_count < 100000:
				read_count += 1
				var line := fa.get_line().strip_edges()
				if line.is_empty():
					continue
				var json_inst := JSON.new()
				if json_inst.parse(line) == OK:
					if json_inst.data is Dictionary:
						out.append(json_inst.data)
			fa.close()
	_disk_cache = out
	_disk_cache_signature = sig
	return out
