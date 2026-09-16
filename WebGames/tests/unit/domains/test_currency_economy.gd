# ==============================================================================
# 单元测试：领域 10 货币体系与魔单晶本位 (Currency & Mana Economy Tests)
# 文件路径: res://tests/unit/domains/test_currency_economy.gd
# ==============================================================================
class_name TestCurrencyDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_currency_weight_and_value())
	results.append(test_mana_standard_and_arbitrage())
	results.append(test_currency_rigid_sinks())
	results.append(test_currency_debt_and_deficit())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 10: 货币体系与魔单晶本位", "all_passed": all_passed, "results": results }

static func test_currency_weight_and_value() -> Dictionary:
	var wallet := CharacterWalletEntity.new()
	wallet.copper = 100
	wallet.silver = 10
	wallet.gold = 5
	wallet.platinum = 1
	var total_copper = wallet.get_total_copper_value()
	var mass = wallet.calculate_total_currency_mass_kg()
	var passed = (total_copper == 100 + 1000 + 50000 + 1000000) and (mass > 0.0)
	return { "test": "TC-CUR-01: 货币层级换算与物理负重约束", "passed": passed, "total_copper": total_copper, "mass_kg": mass }

static func test_mana_standard_and_arbitrage() -> Dictionary:
	var gold_val = CurrencyAndManaStandardSolver.convert_mana_crystals_to_gold(10, 1.2) # 10 * 100 * 1.2 = 1200
	var arb = CurrencyAndManaStandardSolver.calculate_cross_continent_arbitrage(100.0, 0.8, 1.3)
	var passed = (gold_val == 1200) and (arb.gross_profit_gold > 0.0)
	return { "test": "TC-CUR-02: 魔单晶战略本位平价与跨大陆商贸套利", "passed": passed, "gold_val": gold_val, "arb": arb }

static func test_currency_rigid_sinks() -> Dictionary:
	var wallet := CharacterWalletEntity.new()
	wallet.copper = 500
	wallet.silver = 10 # 1000 copper
	var ok = CurrencySinksAndFaucetsFSM.apply_rigid_sink_transaction(wallet, 1200, "PORTAL_TELEPORT")
	var passed = ok and (wallet.get_total_copper_value() == 300)
	return { "test": "TC-CUR-03: 刚性回收水池消费与通胀平抑", "passed": passed, "rem": wallet.get_total_copper_value() }

static func test_currency_debt_and_deficit() -> Dictionary:
	var wallet := CharacterWalletEntity.new()
	wallet.copper = 100
	var initial_debt = wallet.is_in_debt()
	wallet.incur_debt(500) # 100 - 500 = -400
	var in_debt = wallet.is_in_debt()
	var net_debt = wallet.get_net_debt_copper()
	var passed = (not initial_debt) and in_debt and (net_debt == 400) and (wallet.get_total_copper_value() == -400)
	return { "test": "TC-CUR-04: 资产下界穿透与负债赤字语义验证", "passed": passed, "net_debt": net_debt }
