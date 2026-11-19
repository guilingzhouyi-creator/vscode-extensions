# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 统一测量基座)
# 文件路径: res://benchmarks/bench_harness.gd
# 架构定位: Benchmark Harness & Metric Formatter
# 依赖与触发: 触发方: bench_*.gd 与 bench_runner.gd | 下游: JSON 报告
# 职责说明: 提供统一的预热、微秒计时、ops/sec 换算、格式化与输出目录幂等创建能力。
# 退出语义与设计依据: 纯静态基座类，无退出码 | 依据: Bench 套系统一吞吐统计口径契约
# ==============================================================================

## BenchHarness：基准测试通用预热与微秒计时基座
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
