# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_retention_cleaner.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 依据 log.json retention 段配置安全扫描并清理超出 max_days 的历史轮转归档文件， 主日志文件永久受保护，带清理间隔节流与磁盘有界收敛保证（有界收敛惯例）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogRetentionCleaner extends RefCounted

# ==============================================================================
# 一、状态与清理执行
# ==============================================================================

static var _last_sweep: int = 0

## 测试复位：清零上次清理时刻（避免跨用例节流状态残留）
static func reset_state() -> void:
	_last_sweep = 0

## 执行归档日志清理：删除超过 max_days 的过期轮转归档文件（保留主文件）
static func sweep(now_utc: int = -1, force: bool = false) -> int:
	var now := now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
	var retention_cfg := GameConfig.get_dict("infrastructure.log", "retention", {})
	if not bool(retention_cfg.get("enabled", true)):
		return 0
		
	var max_days := int(retention_cfg.get("max_days", 7))
	if max_days <= 0:
		return 0
		
	var interval := int(retention_cfg.get("cleanup_interval_seconds", 3600))
	if not force and (_last_sweep > 0 and now - _last_sweep < interval):
		return 0
		
	_last_sweep = now
	
	var dir_path := GameConfig.get_string("infrastructure.log", "export/directory", "user://logs")
	var prefix := GameConfig.get_string("infrastructure.log", "export/file_prefix", "kalar")
	var main_file := "%s.log" % prefix
	
	var da := DirAccess.open(dir_path)
	if da == null:
		return 0
		
	var removed := 0
	var cutoff_seconds := max_days * 86400
	
	for f in da.get_files():
		# 严格忽略当前活跃写入的主文件
		if f == main_file:
			continue
			
		# 仅匹配格式为 prefix.*.log 的轮转归档
		if f.begins_with(prefix + ".") and f.ends_with(".log"):
			var ts := _extract_timestamp(f, prefix)
			if ts > 0 and (now - ts) > cutoff_seconds:
				var file_full := "%s/%s" % [dir_path, f]
				if DirAccess.remove_absolute(file_full) == OK:
					removed += 1
					
	return removed

# ==============================================================================
# 二、内部实现（时间戳解析）
# ==============================================================================

## 从轮转归档文件名提取时间戳（兼容同秒碰撞名 <prefix>.<ts>_<n>.log；解析失败返回 0）
static func _extract_timestamp(filename: String, prefix: String) -> int:
	# 文件名形态：<prefix>.<timestamp>.log，兼容导出器同秒碰撞名 <prefix>.<timestamp>_<n>.log
	var without_prefix := filename.substr(prefix.length() + 1)
	if without_prefix.ends_with(".log"):
		var raw_ts := without_prefix.left(without_prefix.length() - 4)
		if raw_ts.is_valid_int():
			return raw_ts.to_int()
		if "_" in raw_ts:
			var head := raw_ts.split("_")[0]
			if (head as String).is_valid_int():
				return (head as String).to_int()
	return 0
