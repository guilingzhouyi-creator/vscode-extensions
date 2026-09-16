# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 事件总线吞吐量基线 (EventBus Throughput Benchmarks)
# 文件路径: res://benchmarks/bench_bus.gd
# 职责: 量化 EventBus 全域事件分发管道的吞吐地基——带接收方信号分发、无接收方
#       信号发射、泛化领域事件通道与日志/叙事双通道协同。作为后续总线改造
#       （P67 结构化日志旁路、联机权威同步、事件压缩批处理）的前后对比基线：
#       改造后同指标 ops/s 不得显著下滑。
# 测量基座: BenchHarness.measure（预热 + 计时 + ops/sec 统一口径）。
# 注意: 接收方计数影响分发成本——本套件分别测「无接收方」「1 接收方」两种形态，
#       与 bench_logging（纯广播基线）区分：总线吞吐含订阅回调链。
# ==============================================================================
class_name BenchBus extends RefCounted

const BenchHarness := preload("res://benchmarks/bench_harness.gd")

## 总线测量接收方计数（信号连接数）
static var _receiver_count: int = 0

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
static func _on_narrative(packet: EventPacket) -> void:
	_receiver_count += 1

## 领域事件接收方（计数回调，模拟结构化消费者订阅；EventPacket 解包）
static func _on_domain(packet: EventPacket) -> void:
	_receiver_count += 1
