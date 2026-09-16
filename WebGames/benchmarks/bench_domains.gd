# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 领域求解器基准 (Domain Solver Benchmarks)
# 文件路径: res://benchmarks/bench_domains.gd
# 职责: 量化代表领域求解器的单次操作吞吐（货币经济 / 确定性防作弊），
#       定位高调用频次热路径的性能地基。新增领域基准按同样格式追加即可。
# ==============================================================================
class_name BenchDomains extends RefCounted

const BenchHarness := preload("res://benchmarks/bench_harness.gd")

static func run_benchmarks() -> Dictionary:
	var metrics: Array = []
	GameConfig.ensure_loaded()

	# --- 货币经济（Currency Economy） ---
	var wallet := CharacterWalletEntity.new()
	wallet.copper = 1234
	wallet.silver = 567
	wallet.gold = 89
	wallet.platinum = 4
	wallet.mana_monocrystals = 12
	metrics.append(BenchHarness.measure(
		"Currency.wallet.get_total_copper_value 换算", 200_000,
		func(): wallet.get_total_copper_value()
	))
	metrics.append(BenchHarness.measure(
		"Currency.wallet 物理质量计算", 100_000,
		func(): wallet.calculate_total_currency_mass_kg()
	))
	metrics.append(BenchHarness.measure(
		"Currency.mana 魔单晶换金", 100_000,
		func(): CurrencyAndManaStandardSolver.convert_mana_crystals_to_gold(10, 1.2)
	))
	metrics.append(BenchHarness.measure(
		"Currency.arbitrage 跨大陆套利", 50_000,
		func(): CurrencyAndManaStandardSolver.calculate_cross_continent_arbitrage(100.0, 0.8, 1.3)
	))
	metrics.append(BenchHarness.measure(
		"Currency.sink 刚性回收水池", 50_000,
		Callable(BenchDomains, "_sink_once").bind(wallet)
	))

	# --- 确定性沙箱（权威三态状态机） ---
	var authority := AuthorityTriStateMachine.new()
	metrics.append(BenchHarness.measure(
		"Authority.audit_input_continuity 时序审计", 100_000,
		func(): authority.audit_input_continuity(1000, 1000, -3, 20)
	))
	metrics.append(BenchHarness.measure(
		"Authority.transition_mode 模式流转", 100_000,
		func(): authority.transition_mode(1)
	))

	return { "category": "领域求解器 (Domain Solvers)", "metrics": metrics }

## 单次刚性水池消费：先回充值再消费，避免状态漂移影响测量口径
static func _sink_once(wallet: CharacterWalletEntity) -> void:
	wallet.copper = 5000
	CurrencySinksAndFaucetsFSM.apply_rigid_sink_transaction(wallet, 1200, "PORTAL_TELEPORT")
