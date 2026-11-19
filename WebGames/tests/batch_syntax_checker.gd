# ==============================================================================
# 模块归属: 自动化测试层 (Tests · 全量语法校验器)
# 文件路径: res://tests/batch_syntax_checker.gd
# 架构定位: Single-Process GDScript Batch Syntax & Load Verifier
# 依赖与触发: 触发方: check-gdscript CLI | 上游: 全仓 .gd 文件 | 下游: 控制台校验报告
# 职责说明: 在单次 Godot 进程中批量校验全量 .gd 脚本的语法与装载正确性，支持 --scope 收敛。
# 退出语义与设计依据: SceneTree 入口，0=全通过, 1=存在语法/装载失败 | 设计依据: 单进程批处理优化
# ==============================================================================

## BatchSyntaxChecker：GDScript 全量语法与装载批处理校验器
class_name BatchSyntaxChecker
extends SceneTree

## 全域 .gd 扫描目录清单（唯一事实来源；check-gdscript 运行时按同口径扫描）。
const SCAN_DIRS: Array[String] = [
	"res://backend",
	"res://frontend",
	"res://dev_harness",
	"res://tests",
	"res://benchmarks"
]

func _initialize() -> void:
	var scan_dirs: Array[String] = SCAN_DIRS
	# 审查收敛：--scope 单域批处理模式——命令行用户参数（-- 后的 res:// 目录）优先，
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
		var script: Resource = load(res_path)
		if script == null:
			fails += 1
			print("✗ %s (load failed)" % res_path)
		elif script is GDScript:
			var gd_script := script as GDScript
			# GDS 审查收敛：load() 对存在语法错误的脚本返回非 null 的 GDScript 对象，
			# `can_instantiate()` 在编译失败时为 false，必须以它为准。
			# 避免对已实例化脚本重复调用 reload() 导致 ERR_ALREADY_IN_USE (22) 误报及重复告警。
			if not gd_script.can_instantiate():
				fails += 1
				print("✗ %s (script did not compile)" % res_path)

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
