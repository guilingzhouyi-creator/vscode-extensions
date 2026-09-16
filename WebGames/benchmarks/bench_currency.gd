# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 货币处理与流通吞吐基线 (Currency Flow Benchmarks)
# 文件路径: res://benchmarks/bench_currency.gd
# 职责: 量化货币数据流「处理与流通」热路径的单次操作吞吐——交易结算、消费扣减、
#       债务计息、钱包换算与跨大陆流通。作为后续货币改造（新增流通管线/审计留痕/
#       联机清算）的性能地基基线：改造前后跑本套件对比 ops/s 不得显著下滑。
# 测量基座: BenchHarness.measure（预热 + 计时 + ops/sec 统一口径）。
# 与 bench_domains 货币段的边界: bench_domains 已覆盖换算/质量/套利/刚性水池，
#   本套件聚焦「流通状态机路径」（apply_transaction/try_spend/债务），互补不重复。
# ==============================================================================
class_name BenchCurrency extends RefCounted

const BenchHarness := preload("res://benchmarks/bench_harness.gd")

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
