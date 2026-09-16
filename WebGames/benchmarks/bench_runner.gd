# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 全域吞吐量/性能基准运行器
# 文件路径: res://benchmarks/bench_runner.gd
# 职责: 依次执行全部基准套件（基础设施 / 持久化 / 领域求解器），汇总输出
#       吞吐量报告。运行方式:
#         godot --headless -s res://benchmarks/bench_runner.gd -- <报告输出路径>
#       报告输出路径缺省为 res://benchmarks/reports/bench_latest.json。
# ==============================================================================
extends SceneTree

const BenchHarness := preload("res://benchmarks/bench_harness.gd")
const BenchInfrastructure := preload("res://benchmarks/bench_infrastructure.gd")
const BenchPersistence := preload("res://benchmarks/bench_persistence.gd")
const BenchDomains := preload("res://benchmarks/bench_domains.gd")
const BenchCurrency := preload("res://benchmarks/bench_currency.gd")
const BenchLogging := preload("res://benchmarks/bench_logging.gd")
const BenchBus := preload("res://benchmarks/bench_bus.gd")

func _init() -> void:
	var report_path := _resolve_report_path()
	print("\n" + "=".repeat(78))
	print("  ⚡ 卡拉尔世界引擎 (KALAR WORLD ENGINE) - 吞吐量/性能基准  ⚡")
	print("=".repeat(78) + "\n")

	var categories: Array = []
	categories.append(BenchInfrastructure.run_benchmarks())
	categories.append(BenchPersistence.run_benchmarks())
	categories.append(BenchDomains.run_benchmarks())
	categories.append(BenchCurrency.run_benchmarks())
	categories.append(BenchLogging.run_benchmarks())
	categories.append(BenchBus.run_benchmarks())

	var total_metrics: int = 0
	for cat in categories:
		total_metrics += (cat.get("metrics", []) as Array).size()

	print("\n" + "-".repeat(78))
	for cat in categories:
		print("[CATEGORY] %s" % cat.get("category", "?"))
		for m in cat.get("metrics", []):
			print("  %-46s %8d iters  %9.2f ops/s  (%7.1f ms)" % [
				m.get("name", "?"), m.get("iterations", 0),
				m.get("ops_per_sec", 0.0), float(m.get("elapsed_us", 0)) / 1000.0
			])
		print("")
	print("-".repeat(78))
	print("总指标数: %d" % total_metrics)

	var report := {
		"engine": "KalarWorldEngine",
		"tool": "bench_runner.gd",
		"godot_version": Engine.get_version_info().get("string", ""),
		"host": _host_name(),
		"timestamp": Time.get_datetime_string_from_system(),
		"categories": categories,
		"summary": { "total_metrics": total_metrics }
	}
	_write_report(report_path, report)
	print("报告已写入: %s" % report_path)
	quit(0)

## 报告路径解析：优先取命令行用户参数（-- 之后第一个），缺省写 res:// 下最新报告
func _resolve_report_path() -> String:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0 and not (args[0] as String).is_empty():
		return args[0]
	return "res://benchmarks/reports/bench_latest.json"

func _host_name() -> String:
	if OS.has_environment("COMPUTERNAME"):
		return OS.get_environment("COMPUTERNAME")
	if OS.has_environment("HOSTNAME"):
		return OS.get_environment("HOSTNAME")
	return "unknown"

## 写入 JSON 报告（目录自动创建，幂等）
func _write_report(path: String, report: Dictionary) -> void:
	var dir_path := path.get_base_dir()
	BenchHarness.ensure_dir(dir_path)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("BenchRunner: 无法写入报告 %s (err=%d)" % [path, FileAccess.get_open_error()])
		return
	file.store_string(JSON.stringify(report, "\t"))
	file.close()
