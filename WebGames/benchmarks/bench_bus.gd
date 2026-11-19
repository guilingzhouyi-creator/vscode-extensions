# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 事件总线吞吐基线)
# 文件路径: res://benchmarks/bench_bus.gd
# 架构定位: EventBus Throughput Benchmark Suite
# 依赖与触发: 触发方: bench_runner.gd | 上游: EventBusCore, GameConfig | 下游: BenchHarness
# 职责说明: 量化 EventBus 全域事件分发管道吞吐地基（无接收方广播 / 1 接收方分发 / 双通道协同）。
# 退出语义与设计依据: 返回 { category, metrics } 标准基准字典 | 依据: 无侵入吞吐基线契约
# ==============================================================================

## BenchBus：事件总线分发与叙事通道吞吐量基准套件
class_name BenchBus extends RefCounted

## 总线测量接收方计数（信号连接数）
static var _receiver_count: int = 0

## 执行事件总线吞吐基准测试并返回度量结果集合
static func run_benchmarks() -> Dictionary:
	var metrics: Array = []
	GameConfig.ensure_loaded()
	var bus := EventBusCore.get_instance()

	# --- 总线形态 A：无接收方信号发射（纯广播开销） ---
	metrics.append(BenchHarness.measure(
		"Bus.emit_narrative 无接收方广播", 200_000,
		func(): bus.emit_narrative("基准叙事文本", "combat", {})
	))
	metrics.append(BenchHarness.measure(
		"Bus.emit_domain_event 无接收方", 200_000,
		func(): bus.emit_domain_event("currency.deposit_resolved", {"args": [50]})
	))

	# --- 总线形态 B：1 个接收方信道分发（订阅回调链） ---
	_receiver_count = 0
	var narr_tok := bus.on_channel(EventChannelDefinition.NARRATIVE_EVENT_TEXT, _on_narrative)
	metrics.append(BenchHarness.measure(
		"Bus.narrative 1接收方分发", 100_000,
		func(): bus.emit_narrative("基准叙事文本", "combat", {})
	))
	narr_tok.unbind()
	_receiver_count = 0
	var dom_tok := bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, _on_domain)
	metrics.append(BenchHarness.measure(
		"Bus.domain_event 1接收方分发", 100_000,
		func(): bus.emit_domain_event("combat.round_started", {"category_key": "combat"})
	))
	dom_tok.unbind()

	# --- 总线形态 C：日志 + 叙事双通道协同（emit_log 直发 + 叙事渲染广播） ---
	metrics.append(BenchHarness.measure(
		"Bus.log_narrative 双通道协同", 100_000,
		func():
			bus.emit_log("info", "基准：双通道协同采样")
			EventBusCore.render_narrative("combat/strike_hit", ["勇士", "斩击", 24.0, "荒原兽", 87.5])
	))

	# --- 总线形态 D：泛化领域事件高频通道（combat 回合级事件，负载最大） ---
	metrics.append(BenchHarness.measure(
		"Bus.combat 回合级领域事件", 100_000,
		func(): bus.emit_domain_event("combat.round_advanced", {"args": [1], "category_key": "combat"})
	))
	metrics.append(BenchHarness.measure(
		"Bus.currency 交易级领域事件", 100_000,
		func(): bus.emit_domain_event("currency.transaction_settled", {"args": [150, "SILVER"]})
	))

	return { "category": "事件总线吞吐 (EventBus Throughput)", "metrics": metrics }

## 叙事接收方（计数回调，模拟前端战报面板订阅；EventPacket 解包）
static func _on_narrative(_packet: EventPacket) -> void:
	_receiver_count += 1

## 领域事件接收方（计数回调，模拟结构化消费者订阅；EventPacket 解包）
static func _on_domain(_packet: EventPacket) -> void:
	_receiver_count += 1
