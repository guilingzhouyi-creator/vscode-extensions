# ==============================================================================
# 卡拉尔世界引擎 - GDScript 全量语法与装载批处理校验器 (单进程极速版)
# 文件路径: res://tests/batch_syntax_checker.gd
# 职责: 在单次 Godot 进程中批量校验全部 .gd 文件的语法与装载正确性，消除 340+ 次冷启动
#       （全量 backend/frontend/tests/benchmarks 四目录，随新施工卷持续增长）
# ==============================================================================
extends SceneTree

## G3 审查收敛：.gd 扫描目录清单 —— 唯一事实源（主路径单进程批处理按此扫描）。
## scripts/sh/check-gdscript.sh 运行时从本清单提取同口径（禁止再手工维护第二份）。
const SCAN_DIRS: Array[String] = [
	"res://backend",
	"res://frontend",
	"res://tests",
	"res://benchmarks"
]

func _initialize() -> void:
	var scan_dirs: Array[String] = SCAN_DIRS
	# P2 审查收敛：--scope 单域批处理模式——命令行用户参数（-- 后的 res:// 目录）优先，
	# 使单域检查同样走单进程批处理（消除逐文件冷启动）；参数非 res:// 前缀时忽略回退全量。
	var user_args := OS.get_cmdline_user_args()
	if not user_args.is_empty():
		var custom: Array[String] = []
		for a in user_args:
			var s := String(a)
			if s.begins_with("res://"):
				custom.append(s)
		if not custom.is_empty():
			scan_dirs = custom

	var files: Array[String] = []
	for d in scan_dirs:
		_collect_files(d, files)

	files.sort()
	var checked := 0
	var fails := 0

	for res_path in files:
		if res_path.ends_with(".uid") or "/.godot/" in res_path or res_path.ends_with("batch_syntax_checker.gd"):
			continue
		checked += 1
		var script = load(res_path)
		if script == null:
			fails += 1
			print("✗ %s (load failed)" % res_path)
		elif script is GDScript:
			var err: int = script.reload()
			if err != OK:
				fails += 1
				print("✗ %s (reload error: %d)" % [res_path, err])

	print("【batch-syntax-check】批量检查 %d 个 .gd 文件，失败 %d 个（扫描目录: %s）" % [checked, fails, ", ".join(scan_dirs)])
	quit(0 if fails == 0 else 1)

func _collect_files(dir_path: String, out_files: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if not file_name.begins_with("."):
			var full_path := dir_path + "/" + file_name
			if dir.current_is_dir():
				_collect_files(full_path, out_files)
			elif file_name.ends_with(".gd"):
				out_files.append(full_path)
		file_name = dir.get_next()
	dir.list_dir_end()
