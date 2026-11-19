# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 日志与文案渲染基线)
# 文件路径: res://benchmarks/bench_logging.gd
# 架构定位: Log Pipeline Benchmark Suite
# 依赖与触发: 触发方: bench_runner.gd | 上游: EventBusCore, GameConfig | 下游: BenchHarness
# 职责说明: 量化日志广播、文案模板渲染、领域事件解析及序列化/SHA-256 去重原语吞吐量。
# 退出语义与设计依据: 返回 { category, metrics } 标准基准字典 | 依据: 无头纯广播与原语耗时基线契约
# ==============================================================================

## BenchLogging：日志采集、文案渲染与指纹原语吞吐基准套件
class_name BenchLogging extends RefCounted

## 执行日志链路基准测试并返回度量结果集合
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

	# --- 去重/压缩架构依赖的原子原语基线（落盘/去重指纹/压缩序列化的参照） ---
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
		func(): return "[INFO] " + raw_lines.strip_edges()
	))

	return { "category": "日志链路与去重压缩原语 (Log Pipeline & Primitives)", "metrics": metrics }
