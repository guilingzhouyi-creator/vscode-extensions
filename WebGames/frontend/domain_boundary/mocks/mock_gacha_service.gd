# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟抽卡祈愿服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_gacha_service.gd
# 职责: 承载抽卡概率、硬保底、掉落生成与扣费规则；视图只消费结果与只读规则
# ==============================================================================
class_name MockGachaService
extends IGachaService

const BASE_RATE_5STAR: float = 0.016
const BASE_RATE_4STAR: float = 0.130
const BASE_RATE_3STAR: float = 0.854
const PITY_5STAR_HARD: int = 90
const PITY_4STAR_HARD: int = 10
const COST_SINGLE: int = 160
const COST_TEN: int = 1600
const NEW_FLAG_RATE: float = 0.2

const POOL_5: Array[String] = [
	"ui.fe06.mock.item.flame_knight",
	"ui.fe06.mock.item.dragon_spine_greatsword",
	"ui.fe06.mock.item.mithril_guardian",
]
const POOL_4: Array[String] = [
	"ui.fe06.mock.item.wind_shortbow",
	"ui.fe06.mock.item.arcane_staff",
	"ui.fe06.mock.item.refined_leather_armor",
	"ui.fe06.mock.item.mithril_sword",
]
const POOL_3: Array[String] = [
	"ui.fe06.mock.item.healing_potion_l",
	"ui.fe06.mock.item.mana_shard",
	"ui.fe06.mock.item.iron_ore_5",
	"ui.fe06.mock.item.herb_3",
]

func get_rules() -> Dictionary:
	return {
		"base_rate_5star": BASE_RATE_5STAR,
		"base_rate_4star": BASE_RATE_4STAR,
		"base_rate_3star": BASE_RATE_3STAR,
		"pity_5star_hard": PITY_5STAR_HARD,
		"pity_4star_hard": PITY_4STAR_HARD,
		"cost_single": COST_SINGLE,
		"cost_ten": COST_TEN,
	}

func generate_drops(count: int, pity_5star: int, pity_4star: int) -> Array:
	var rng := DeterministicRNG.resolve(null)
	var drops: Array = []
	for i in range(maxi(0, count)):
		var roll: float = rng.randf()
		var rarity := "3"
		var name_str: String = POOL_3[i % POOL_3.size()]
		if roll < BASE_RATE_5STAR or (pity_5star + i) >= PITY_5STAR_HARD - 1:
			rarity = "5"
			name_str = POOL_5[i % POOL_5.size()]
		elif roll < BASE_RATE_5STAR + BASE_RATE_4STAR or (pity_4star + i) >= PITY_4STAR_HARD - 1:
			rarity = "4"
			name_str = POOL_4[i % POOL_4.size()]
		drops.append({
			"name": name_str,
			"rarity": rarity,
			"is_new": rng.randf() < NEW_FLAG_RATE,
		})
	return drops

func resolve_pull(state: Dictionary, pull_count: int, injected_drops: Array = []) -> Dictionary:
	var pity_5 := int(state.get("pity_5star", 0))
	var pity_4 := int(state.get("pity_4star", 0))
	var pity_counter := int(state.get("pity_counter", 0))
	var total_pulls := int(state.get("total_pull_count", 0))
	var rarity_counts: Dictionary = (state.get("rarity_counts", {}) as Dictionary).duplicate()

	var drops: Array = injected_drops.duplicate(true) if not injected_drops.is_empty() \
		else generate_drops(pull_count, pity_5, pity_4)

	for drop in drops:
		var rarity := str(drop.get("rarity", "3"))
		rarity_counts[rarity] = int(rarity_counts.get(rarity, 0)) + 1

	pity_counter += pull_count
	pity_5 += pull_count
	pity_4 += pull_count
	total_pulls += pull_count
	var has_5star := _has_rarity(drops, "5")
	if has_5star:
		pity_5 = 0
	if has_5star or _has_rarity(drops, "4"):
		pity_4 = 0

	return {
		"success": true,
		"results": drops,
		"pity_counter": pity_counter,
		"pity_5star": pity_5,
		"pity_4star": pity_4,
		"total_pull_count": total_pulls,
		"rarity_counts": rarity_counts,
	}

func purchase(currency: int, pull_count: int) -> Dictionary:
	var cost := _cost_of(pull_count)
	if currency < cost:
		return {"success": false, "error_code": "INSUFFICIENT_CURRENCY", "cost": cost, "balance": currency}
	return {"success": true, "cost": cost, "balance": currency - cost}

func _cost_of(pull_count: int) -> int:
	return COST_TEN if pull_count >= 10 else COST_SINGLE * maxi(1, pull_count)

func _has_rarity(drops: Array, rarity: String) -> bool:
	for drop in drops:
		if str(drop.get("rarity", "")) == rarity:
			return true
	return false
