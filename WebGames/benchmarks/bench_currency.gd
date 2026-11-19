# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 货币流通吞吐基线)
# 文件路径: res://benchmarks/bench_currency.gd
# 架构定位: Currency Flow Benchmark Suite
# 依赖与触发: 触发方: bench_runner.gd | 上游: CharacterWalletEntity, CurrencySolver | 下游: BenchHarness
# 职责说明: 量化货币流通热路径（交易结算、消费扣减、债务计息与钱包换算）的单次操作吞吐。
# 退出语义与设计依据: 返回 { category, metrics } 标准基准字典 | 依据: BenchDomains 互补热路径基准
# ==============================================================================

## BenchCurrency：货币交易与钱包流通状态机吞吐基准套件
class_name BenchCurrency extends RefCounted

## 执行货币流通热路径基准测试并返回度量结果集合
static func run_benchmarks() -> Dictionary:
	var metrics: Array = []
	GameConfig.ensure_loaded()

	# --- 钱包实例（每次测量前重置，避免状态漂移影响口径） ---
	var wallet := CharacterWalletEntity.new()
	wallet.copper = 1200
	wallet.silver = 300
	wallet.gold = 50
	wallet.platinum = 2
	wallet.mana_monocrystals = 8

	# --- 流通路径 A：交易结算（apply_transaction 增/减双方向） ---
	metrics.append(BenchHarness.measure(
		"Currency.flow.apply_transaction 双向结算", 200_000,
		func():
			wallet.copper = 1200
			wallet.apply_transaction({"copper": 150, "silver": -2})
	))
	metrics.append(BenchHarness.measure(
		"Currency.flow.apply_transaction 签名结算", 200_000,
		func():
			wallet.copper = 1200
			wallet.apply_transaction({"copper": -120}, true)
	))

	# --- 流通路径 B：消费扣减（try_spend 阶梯扣款） ---
	metrics.append(BenchHarness.measure(
		"Currency.flow.try_spend 阶梯消费", 200_000,
		func():
			wallet.copper = 5000
			wallet.try_spend(1234)
	))
	metrics.append(BenchHarness.measure(
		"Currency.flow.try_spend 余额不足", 200_000,
		func():
			wallet.copper = 0
			wallet.silver = 0
			wallet.try_spend(99999)
	))

	# --- 流通路径 C：债务计息与净额（is_in_debt / get_net_debt_copper） ---
	metrics.append(BenchHarness.measure(
		"Currency.flow.incur_debt 债务记账", 200_000,
		func():
			wallet.copper = 500
			wallet.incur_debt(800)
	))
	metrics.append(BenchHarness.measure(
		"Currency.flow.debt 债务状态查询", 200_000,
		func():
			wallet.copper = 500
			wallet.is_in_debt()
			wallet.get_net_debt_copper()
	))

	# --- 流通路径 D：跨大陆套利（汇率换算流通） ---
	metrics.append(BenchHarness.measure(
		"Currency.flow.arbitrage 跨大陆套利", 100_000,
		func(): CurrencyAndManaStandardSolver.calculate_cross_continent_arbitrage(100.0, 0.85, 1.25)
	))
	metrics.append(BenchHarness.measure(
		"Currency.flow.mana_convert 魔单晶兑金", 200_000,
		func(): CurrencyAndManaStandardSolver.convert_mana_crystals_to_gold(10, 1.1)
	))

	return { "category": "货币处理与流通 (Currency Flow)", "metrics": metrics }
