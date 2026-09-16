# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/gacha_wish/gacha_probability_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy, inventory | 配置: config/domains/gacha.json | 信号: EventBus 领域广播
# 职责说明: 工业级 PRNG 动态概率算法：小保底 70 抽软保底递增、90 抽硬保底、50/50 歪率与大保底机制 概率常数与保底阈值由 config/domains/gacha.json 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GachaProbabilitySolver extends RefCounted

## 5 星基础概率（domains.gacha rates/base_5star 配置，默认 0.006）
static func _base_5star_rate() -> float:
	return GameConfig.get_float("domains.gacha", "rates/base_5star", 0.006)

## 4 星基础概率（rates/base_4star 配置，默认 0.051）
static func _base_4star_rate() -> float:
	return GameConfig.get_float("domains.gacha", "rates/base_4star", 0.051)

## 软保底起点（pity/soft_threshold 配置，默认 70）
static func _soft_pity_threshold() -> int:
	return GameConfig.get_int("domains.gacha", "pity/soft_threshold", 70)

## 硬保底阈值（pity/hard_threshold 配置，默认 90）
static func _hard_pity_threshold() -> int:
	return GameConfig.get_int("domains.gacha", "pity/hard_threshold", 90)

## 软保底每抽递增率（pity/soft_increment_per_pull 配置，默认 0.05）
static func _soft_increment() -> float:
	return GameConfig.get_float("domains.gacha", "pity/soft_increment_per_pull", 0.05)

## UP 角色歪率（50/50：rates/up_rate 配置，默认 0.5）
static func _up_rate() -> float:
	return GameConfig.get_float("domains.gacha", "rates/up_rate", 0.5)

## 动态计算当前单抽 5 星命中概率
static func calculate_current_5star_rate(pity_count: int) -> float:
	var hard := _hard_pity_threshold()
	if pity_count >= hard:
		return GameConfig.get_float("domains.gacha", "pity/hard_guaranteed_rate", 1.0)
	var soft := _soft_pity_threshold()
	if pity_count < soft:
		return _base_5star_rate()
	var excess = pity_count - soft + 1
	var base := _base_5star_rate()
	var inc := _soft_increment()
	return clamp(base + float(excess) * inc, base, 1.0)

## 执行单次抽奖判定
##
## rng_or_seed 接受两种形态（向后兼容）：
##   DeterministicRNG 实例 -> 直接复用（十连等批量场景必须共用同一实例，
##                            否则每抽都从同一状态重开，序列退化为重复值）
##   int 且 > 0            -> 以该种子创建独立实例，单抽完全可复现
##   null / 0              -> 回退共享实例 DeterministicRNG.global()
static func roll_single_draw(banner: GachaBannerAggregate, rng_or_seed: Variant = null) -> Dictionary:
	var rng := DeterministicRNG.resolve(rng_or_seed)

	banner.total_lifetime_pulls += 1
	banner.current_pity_count += 1

	var rate_5 = calculate_current_5star_rate(banner.current_pity_count)
	var roll := rng.randf()

	if roll < rate_5:
		var is_up := false
		if banner.is_next_guaranteed_up or rng.randf() < _up_rate():
			is_up = true
			banner.is_next_guaranteed_up = false
		else:
			is_up = false
			banner.is_next_guaranteed_up = true

		# 空奖池安全：pick() 对空数组返回 null，避免 randi() % 0 崩溃
		var reward_item_id := ""
		if is_up:
			reward_item_id = "" if banner.up_5star_item_ids.is_empty() else str(banner.up_5star_item_ids[0])
		else:
			var picked = rng.pick(banner.standard_5star_item_ids)
			reward_item_id = "" if picked == null else str(picked)

		var pity_used = banner.current_pity_count
		banner.current_pity_count = 0

		return {
			"rarity": 5,
			"is_up": is_up,
			"item_id": reward_item_id,
			"pity_count_used": pity_used
		}
	elif roll < (rate_5 + _base_4star_rate()):
		var picked_4 = rng.pick(banner.standard_4star_item_ids)
		var item_4 := "" if picked_4 == null else str(picked_4)
		return { "rarity": 4, "is_up": false, "item_id": item_4, "pity_count_used": banner.current_pity_count }
	else:
		var picked_3 = rng.pick(banner.standard_3star_item_ids)
		var item_3 := "" if picked_3 == null else str(picked_3)
		return { "rarity": 3, "is_up": false, "item_id": item_3, "pity_count_used": banner.current_pity_count }
