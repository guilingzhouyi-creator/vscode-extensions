# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 测试辅助：print/printerr 零残留静态扫描器
# 文件路径: res://tests/support/structured_log_print_scanner.gd
# 职责: 扫描 res://backend 与 res://frontend 目录下 .gd 文件是否存在裸 print(/printerr(
# ==============================================================================
class_name StructuredLogPrintScanner
extends RefCounted

static func scan_roots(roots: Array[String]) -> Array[String]:
	var print_hits: Array[String] = []
	for root_dir in roots:
		if DirAccess.open(root_dir) != null:
			_scan_gd_files_for_print(root_dir, print_hits)
	return print_hits

static func _is_printerr_sink_path(full_path: String) -> bool:
	return full_path == "res://backend/infrastructure/event_bus/event_bus_core.gd" \
		or full_path == "res://backend/infrastructure/logging/unified_logger_service.gd"

static func _is_ident_char(ch: String) -> bool:
	return (ch >= "a" and ch <= "z") or (ch >= "A" and ch <= "Z") \
		or (ch >= "0" and ch <= "9") or ch == "_" or ch == "."

static func _contains_bare_log_call(line: String, call_prefix: String) -> bool:
	var idx: int = line.find(call_prefix)
	while idx != -1:
		var comment_idx: int = line.find("#")
		if comment_idx != -1 and comment_idx < idx:
			return false
		if idx == 0 or not _is_ident_char(line.substr(idx - 1, 1)):
			return true
		idx = line.find(call_prefix, idx + call_prefix.length())
	return false

static func _check_gd_file_for_print(full_path: String, _item: String, out_hits: Array[String]) -> void:
	var fa := FileAccess.open(full_path, FileAccess.READ)
	if fa == null:
		return
	var allow_printerr: bool = _is_printerr_sink_path(full_path)
	var line_num := 0
	while not fa.eof_reached() and line_num < 100000:
		line_num += 1
		var line := fa.get_line().strip_edges()
		if line.begins_with("#") or line.is_empty():
			continue
		if _contains_bare_log_call(line, "print("):
			out_hits.append("%s:%d %s" % [full_path, line_num, line])
		elif not allow_printerr and _contains_bare_log_call(line, "printerr("):
			out_hits.append("%s:%d %s" % [full_path, line_num, line])
	fa.close()

static func _scan_gd_files_for_print(dir_path: String, out_hits: Array[String]) -> void:
	var da := DirAccess.open(dir_path)
	if da == null:
		return
	da.list_dir_begin()
	var item := da.get_next()
	while not item.is_empty():
		if item == "." or item == "..":
			item = da.get_next()
			continue
		var full := "%s/%s" % [dir_path, item]
		if da.current_is_dir():
			_scan_gd_files_for_print(full, out_hits)
		elif item.ends_with(".gd"):
			_check_gd_file_for_print(full, item, out_hits)
		item = da.get_next()
	da.list_dir_end()
