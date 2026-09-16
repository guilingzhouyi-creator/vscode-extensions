# ==============================================================================
# 单元测试：领域 17 货币祈愿抽奖与保底伪随机 (Gacha Wish Tests)
# 文件路径: res://tests/unit/domains/test_gacha_wish.gd
# ==============================================================================
class_name TestGachaDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_pity_rate_escalation())
	results.append(test_hard_pity_guarantee())
	results.append(test_multi_pull_execution())
	results.append(test_banner_rollback_on_refund())
	results.append(test_banner_restore_guard())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 17: 货币抽奖与保底伪随机", "all_passed": all_passed, "results": results }

static func test_pity_rate_escalation() -> Dictionary:
	var base_rate = GachaProbabilitySolver.calculate_current_5star_rate(10)
	var soft_rate = GachaProbabilitySolver.calculate_current_5star_rate(75)
	var hard_rate = GachaProbabilitySolver.calculate_current_5star_rate(90)
	var passed = (base_rate == 0.006) and (soft_rate > 0.20) and (hard_rate == 1.0)
	return { "test": "TC-GACHA-01: 软保底递增与 90 抽硬保底 100% 概率", "passed": passed }

static func test_hard_pity_guarantee() -> Dictionary:
	var banner := GachaBannerAggregate.new()
	banner.current_pity_count = 89
	var res = GachaProbabilitySolver.roll_single_draw(banner)
	var passed = (res.rarity == 5) and (banner.current_pity_count == 0)
	return { "test": "TC-GACHA-02: 命中 5 星后重置保底计数器", "passed": passed }

static func test_multi_pull_execution() -> Dictionary:
	var banner := GachaBannerAggregate.new()
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 5000
	var inv := WearableInventoryAggregate.new()
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 20
	inv.equip_item("CHEST", chest)
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	var res = GachaExecutionService.execute_multi_pull(banner, wallet, inv, 10, catalog)
	# 掉落物品按注册表三元组实例化：template_id 落 canonical_id，原型体积为正
	var template_ok = inv.storage_items.size() == 10 \
		and res.granted_count == 10 and res.grant_failed_count == 0
	for stored in inv.storage_items:
		if not str(stored.template_id).begins_with("KALAR:") or stored.volume_slots <= 0:
			template_ok = false
			break
	var passed = res.success and (res.drops.size() == 10) and template_ok
	return { "test": "TC-GACHA-03: 十连祈愿扣款与注册表三元组掉落实例化入包", "passed": passed }

## M1（Phase 51）：十连失败整批退款时 banner 保底进度必须整面回滚——
## 封堵「退款但保底免费累积」刷取（红证：修复前 pity/歪率锁存不随事务回滚）
static func test_banner_rollback_on_refund() -> Dictionary:
	var banner := GachaBannerAggregate.new()
	# 预置接近硬保底进度：若失败退款后进度仍保留，玩家可零成本把保底堆满
	banner.total_lifetime_pulls = 89
	banner.current_pity_count = 89
	banner.is_next_guaranteed_up = true
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 2000
	# 裸身零容量：全部掉落无法入包 → grant_failed_count > 0 → 整批退款
	var inv := WearableInventoryAggregate.new()
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	var res = GachaExecutionService.execute_multi_pull(banner, wallet, inv, 10, catalog)
	var rollback_ok = (not res.success) \
		and res.error_code == "REWARD_COMMIT_FAILED" \
		and banner.total_lifetime_pulls == 89 \
		and banner.current_pity_count == 89 \
		and banner.is_next_guaranteed_up == true \
		and wallet.gold == 2000 \
		and inv.storage_items.is_empty()
	return { "test": "TC-GACHA-04: 十连失败退款保底整面回滚（M1 刷保底封堵）", "passed": rollback_ok }

## 防御性加固：快照跨池防串扰校验、空值短路保护与数值下限钳制
static func test_banner_restore_guard() -> Dictionary:
	var b := GachaBannerAggregate.new()
	b.banner_id = "BANNER_TEST_A"
	b.current_pity_count = 50
	b.total_lifetime_pulls = 100
	b.is_next_guaranteed_up = true

	# 1. 跨池快照注入应当被拒绝
	var alien_snap := {
		"banner_id": "BANNER_TEST_B",
		"current_pity_count": 10,
		"total_lifetime_pulls": 20,
		"is_next_guaranteed_up": false
	}
	b.restore_progress(alien_snap)
	var cross_pool_rejected = (b.current_pity_count == 50 and b.total_lifetime_pulls == 100 and b.is_next_guaranteed_up == true)

	# 2. 空快照/null 保持幂等
	b.restore_progress({})
	var empty_safe = (b.current_pity_count == 50 and b.total_lifetime_pulls == 100)

	# 3. 负数快照安全归零
	var dirty_snap := {
		"banner_id": "BANNER_TEST_A",
		"current_pity_count": -99,
		"total_lifetime_pulls": -50,
		"is_next_guaranteed_up": false
	}
	b.restore_progress(dirty_snap)
	var clamped_non_negative = (b.current_pity_count == 0 and b.total_lifetime_pulls == 0 and b.is_next_guaranteed_up == false)

	# 4. 反序列化负数成本与负数保底防御钳制
	var des_banner := GachaBannerAggregate.deserialize({
		"cost_per_pull_gold": -500,
		"cost_per_pull_crystals": -10,
		"current_pity_count": -5
	})
	var des_clamped = (des_banner.cost_per_pull_gold == 0 and des_banner.cost_per_pull_crystals == 0 and des_banner.current_pity_count == 0)

	var passed = cross_pool_rejected and empty_safe and clamped_non_negative and des_clamped
	return { "test": "TC-GACHA-05: 保底快照跨池防串扰、空值短路与反序列化非负钳制", "passed": passed }
