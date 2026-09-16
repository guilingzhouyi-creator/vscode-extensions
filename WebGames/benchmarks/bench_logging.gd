# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 日志采集/去重/提纯/压缩链路基线 (Log Pipeline Benchmarks)
# 文件路径: res://benchmarks/bench_logging.gd
# 职责: 量化日志数据流现状链路的吞吐地基——广播、文案渲染、领域事件解析，
#       以及去重/压缩改造将依赖的原子原语（序列化/指纹/字符串规整）基准。
#       用途: P66/P67 日志改造（结构化采集/去重提纯/压缩落盘）前后跑本套件对比
#       ops/s 与耗时分布，度量改造是否侵蚀日志链路吞吐（吞吐不得显著下滑）。
# 测量基座: BenchHarness.measure（预热 + 计时 + ops/sec 统一口径）。
# 注意: 本套件在 headless 下运行（无前端信号接收方），emit 开销即纯广播基线。
# ==============================================================================
class_name BenchLogging extends RefCounted

const BenchHarness := preload("res://benchmarks/bench_harness.gd")

static func run_benchmarks() -> Dictionary:
	var metrics: Array = []
	GameConfig.ensure_loaded()
	var bus := EventBusCore.get_instance()

	# --- 采集链路 A：日志广播（emit_log 信号分发） ---
	metrics.append(BenchHarness.measure(
		"Log.emit_log 日志广播", 200_000,
		func(): bus.emit_log("info", "基准采样：货币结算完成")
	))
	metrics.append(BenchHarness.measure(
		"Log.emit_log warn 告警广播", 200_000,
		func(): bus.emit_log("warn", "基准采样：配置回退")
	))

	# --- 采集链路 B：文案渲染（i18n 模板查表 + %s 占位代入） ---
	metrics.append(BenchHarness.measure(
		"Log.render_narrative 文案渲染", 200_000,
		func(): EventBusCore.render_narrative("combat/strike_hit", ["勇士", "斩击", 24.0, "荒原兽", 87.5])
	))
	metrics.append(BenchHarness.measure(
		"Log.render_narrative 无参直出", 200_000,
		func(): EventBusCore.render_narrative("combat/round_start")
	))

	# --- 采集链路 C：叙事广播（渲染 + 分类 + 信号双发） ---
	metrics.append(BenchHarness.measure(
		"Log.emit_narrative_by_key 叙事广播", 100_000,
		func(): bus.emit_narrative_by_key("combat/strike_hit", "combat", ["勇士", "斩击", 24.0, "荒原兽", 87.5])
	))

	# --- 采集链路 D：领域事件解析（channel 分域 + 文案查表 + 广播） ---
	metrics.append(BenchHarness.measure(
		"Log.emit_domain_event 领域事件广播", 100_000,
		func(): bus.emit_domain_event("currency.deposit_resolved", {"args": [100]})
	))
	metrics.append(BenchHarness.measure(
		"Log.emit_domain_event 纯结构化事件", 100_000,
		func(): bus.emit_domain_event("combat.round_started", {"category_key": "combat"})
	))

	# --- 去重/压缩改造依赖的原子原语基线（P67 落盘/去重指纹/压缩序列化的参照） ---
	var sample_payload := {
		"sequence": 123456, "channel": "combat_round_coordinator", "level": "info",
		"message": "回合结算完成", "trace_id": "TRACE_8F3A", "duration_ms": 42,
		"context": {"round": 3, "hp": 87.5, "ap": 2}
	}
	metrics.append(BenchHarness.measure(
		"Log.primitive.json_stringify 序列化原语", 200_000,
		func(): JSON.stringify(sample_payload)
	))
	metrics.append(BenchHarness.measure(
		"Log.primitive.sha256 去重指纹原语", 100_000,
		func(): JSON.stringify(sample_payload).sha256_text()
	))
	var raw_lines := "line:001 message=基准采样 round=3 hp=87.5\n"
	metrics.append(BenchHarness.measure(
		"Log.primitive.string_concat 字符串规整", 500_000,
		func(): "[INFO] " + raw_lines.strip_edges()
	))

	return { "category": "日志链路与去重压缩原语 (Log Pipeline & Primitives)", "metrics": metrics }
