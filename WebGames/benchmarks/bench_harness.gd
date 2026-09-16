# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 基准测量基座 (Benchmark Harness)
# 文件路径: res://benchmarks/bench_harness.gd
# 职责: 统一的基准测量工具：预热 + 计时 + 吞吐量(ops/sec)计算。
#       所有 bench_*.gd 套件共用本基座，保证测量口径一致、结果可横向对比。
# 注意: 本文件定义了 class_name，但新文件引用时请一律 preload，
#       不要依赖 .godot/global_script_class_cache.cfg 的缓存（新文件尚未入库）。
# ==============================================================================
class_name BenchHarness extends RefCounted

const WARMUP_CAP: int = 2000

## 测量单个工作负载：先预热（上限 WARMUP_CAP 次），再计时 iterations 次。
## 返回 { name, iterations, elapsed_us, ops_per_sec }。
static func measure(label: String, iterations: int, workload: Callable) -> Dictionary:
	var warmup_iters: int = mini(iterations, WARMUP_CAP)
	for i in range(warmup_iters):
		workload.call()
	var t0: int = Time.get_ticks_usec()
	for i in range(iterations):
		workload.call()
	var elapsed_us: int = Time.get_ticks_usec() - t0
	var ops_per_sec := float(iterations) / (float(elapsed_us) / 1_000_000.0)
	return {
		"name": label,
		"iterations": iterations,
		"elapsed_us": elapsed_us,
		"ops_per_sec": ops_per_sec
	}

## 把 ops/sec 格式化为可读字符串（M/s、K/s、/s）
static func fmt_ops(ops_per_sec: float) -> String:
	if ops_per_sec >= 1_000_000.0:
		return "%.2f M/s" % (ops_per_sec / 1_000_000.0)
	if ops_per_sec >= 1_000.0:
		return "%.2f K/s" % (ops_per_sec / 1_000.0)
	return "%.2f /s" % ops_per_sec

## 确保目录存在（幂等，可重复调用）
static func ensure_dir(path: String) -> void:
	if DirAccess.open(path) == null:
		DirAccess.make_dir_recursive_absolute(path)
