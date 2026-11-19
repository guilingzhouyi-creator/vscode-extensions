# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 基础设施基线)
# 文件路径: res://benchmarks/bench_infrastructure.gd
# 架构定位: Infrastructure Throughput Benchmark Suite
# 依赖与触发: 触发方: bench_runner.gd | 上游: GameConfig, EventBusCore, WorldClockMaster | 下游: BenchHarness
# 职责说明: 量化 GameConfig、EventBus 与 WorldClockMaster 的热路径读取、事件广播与时钟推进吞吐量。
# 退出语义与设计依据: 返回 { category, metrics } 标准基准字典 | 依据: 引擎基础设施吞吐回归门禁依据
# ==============================================================================

## BenchInfrastructure：核心基础设施组件吞吐基准套件
class_name BenchInfrastructure extends RefCounted

## 执行基础设施基准测试并返回度量结果集合
static func run_benchmarks() -> Dictionary:
	var metrics: Array = []
	GameConfig.ensure_loaded()

	# --- GameConfig 读取吞吐 ---
	metrics.append(BenchHarness.measure(
		"GameConfig.get_int 热路径读取", 200_000,
		func(): GameConfig.get_int("domains.currency", "rates/copper", 1)
	))
	metrics.append(BenchHarness.measure(
		"GameConfig.get_float 热路径读取", 200_000,
		func(): GameConfig.get_float("domains.currency", "coin_mass_kg/copper", 0.010)
	))
	metrics.append(BenchHarness.measure(
		"GameConfig.get_string 热路径读取", 100_000,
		func(): GameConfig.get_string("infrastructure.persistence", "engine", "")
	))
	metrics.append(BenchHarness.measure(
		"GameConfig.get_dict 整表读取", 50_000,
		func(): GameConfig.get_dict("infrastructure.event_categories", "", {})
	))
	metrics.append(BenchHarness.measure(
		"GameConfig 全量加载+热重载", 20,
		func(): GameConfig.reload_config()
	))
	GameConfig.ensure_loaded()

	# --- EventBusCore 叙事事件吞吐（挂 1 个订阅者模拟真实监听开销） ---
	# 注意：必须用 Callable(load(本脚本), 静态方法) 而非匿名 lambda 订阅单例总线——
	#       匿名闭包在进程 teardown 时会导致 Godot 4.7 headless 段错误（探针验证）。
	var bus := EventBusCore.get_instance()
	var script_ref := load("res://benchmarks/bench_infrastructure.gd")
	var bench_tok := bus.on_channel(EventChannelDefinition.NARRATIVE_EVENT_TEXT, Callable(script_ref, "_on_narrative_event"))
	metrics.append(BenchHarness.measure(
		"EventBus.emit_narrative_by_key 叙事广播", 50_000,
		func(): bus.emit_narrative_by_key("currency/sink_transaction", "economy", [1, "BENCH"])
	))
	metrics.append(BenchHarness.measure(
		"EventBus.render_narrative 模板渲染", 100_000,
		func(): EventBusCore.render_narrative("currency/sink_transaction", [1, "BENCH"])
	))
	metrics.append(BenchHarness.measure(
		"EventBus.emit_log 日志广播", 50_000,
		func(): bus.emit_log("info", "bench")
	))
	bench_tok.unbind()

	# --- 世界时钟吞吐 ---
	var clock := WorldClockMaster.new()
	metrics.append(BenchHarness.measure(
		"WorldClock.tick_combat 战斗滴答", 100_000,
		func(): clock.tick_combat(1)
	))
	metrics.append(BenchHarness.measure(
		"WorldClock.advance_travel_hours 行军推进", 20_000,
		func(): clock.advance_travel_hours(1)
	))

	return { "category": "基础设施 (Infrastructure)", "metrics": metrics }

## EventBusCore 叙事事件订阅者（命名静态方法，规避闭包 teardown 段错误；EventPacket 解包）
static func _on_narrative_event(_packet: EventPacket) -> void:
	pass
