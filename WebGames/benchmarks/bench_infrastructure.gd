# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 基础设施基准 (Infrastructure Benchmarks)
# 文件路径: res://benchmarks/bench_infrastructure.gd
# 职责: 量化 GameConfig / EventBus / WorldClockMaster 三大基础设施的吞吐量，
#       作为引擎运行时性能地基的基线参考（热路径读取、事件广播、时钟推进）。
# ==============================================================================
class_name BenchInfrastructure extends RefCounted

const BenchHarness := preload("res://benchmarks/bench_harness.gd")

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
		"EventBusCore.render_narrative 模板渲染", 100_000,
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
static func _on_narrative_event(packet: EventPacket) -> void:
	pass
