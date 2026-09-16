# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 统一名称注册表单元测试
# 文件路径: res://tests/unit/infrastructure/test_name_registry.gd
# 覆盖: Phase 19 施工细则 阶段1~4（TC-NAM-01~06）
#       —— 既有键盘点 / 键规范唯一 / 英文 fallback 必达 / 未登记告警 /
#          跨域冲突拦截 / 存量迁移批次 1
# ==============================================================================
class_name TestNameRegistryDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 19: 统一名称注册表"

	results.append(_test_existing_keys_inventory())
	results.append(_test_name_key_format_unique())
	results.append(_test_en_us_fallback_required())
	results.append(_test_unregistered_warning())
	results.append(_test_cross_domain_collision())
	results.append(_test_migration_batch_one_done())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-NAM-01: 既有键盘点（物品 loc_name_key + 魔法 name_key 全量登记，可经 resolve 解析）
static func _test_existing_keys_inventory() -> Dictionary:
	var magic_tiers: Dictionary = GameConfig.get_dict("domains.magic_tiers", "rank_gradient", {})
	var magic_count: int = magic_tiers.size()
	var shared := LocalizationRegistryCatalog.get_shared()
	var reg := MagicTierRegistry.new()
	reg.reload_configuration()
	# 魔法位阶 11 + 资质 4 + 形态 4 + 实力 13 = 32 键应全部进入共享注册表
	var magic_registered := 0
	for key in shared.registered_name_keys:
		if str(key).begins_with("magic."):
			magic_registered += 1
	var zh_ok := LocalizationSolver.resolve_name_key(shared, "magic.rank.rank_11", "zh_CN") == "十一阶"
	var passed = magic_count == 11 and magic_registered >= 32 and zh_ok
	return {
		"test": "TC-NAM-01: 既有键盘点（魔法 32 键全量登记 + 中文展示解析）",
		"passed": passed
	}

## TC-NAM-02: 键规范唯一（三段式格式 + 同域重登记幂等不重复 + 跨域拒绝）
static func _test_name_key_format_unique() -> Dictionary:
	var catalog := LocalizationRegistryCatalog.new()
	var r1 := catalog.register_name_key("item.demo_sword.name", "item", "Demo Sword")
	var r2 := catalog.register_name_key("item.demo_sword.name", "item", "Demo Sword")  # 同域幂等重登记
	var no_dup: bool = catalog.registered_name_keys.count("item.demo_sword.name") == 1
	var r3 := catalog.register_name_key("item.demo_sword.name", "magic", "Magic Sword")  # 跨域拒绝
	var format_ok := _key_format_valid("monster.dragon_king.name") and not _key_format_valid("monster.dragon_king")
	var passed = r1.success and r2.success and str(r2.get("idempotent", false)) == "true" \
		and no_dup and not r3.success and format_ok
	return {
		"test": "TC-NAM-02: 键规范唯一（三段式格式 + 同域幂等重登记不重复 + 跨域拒绝）",
		"passed": passed
	}

## TC-NAM-03: 英文 fallback 必达（仅 en_US 登记 → zh_CN locale 回退英文显示）
static func _test_en_us_fallback_required() -> Dictionary:
	var catalog := LocalizationRegistryCatalog.new()
	catalog.register_name_key("npc.merchant.quest.title", "npc", "The Merchant's Quest")
	var resolved := LocalizationSolver.resolve_name_key(catalog, "npc.merchant.quest.title", "zh_CN")
	var passed = resolved == "The Merchant's Quest"
	return {
		"test": "TC-NAM-03: 英文 fallback 必达（en_US 唯一底座，缺失中文时回退英文无 [key]）",
		"passed": passed
	}

## TC-NAM-04: 未登记告警（未登记键 → [key] 原样 + missing_name_keys +1，不抛 Fatal）
static func _test_unregistered_warning() -> Dictionary:
	LocalizationSolver.missing_name_keys = 0
	var catalog := LocalizationRegistryCatalog.new()
	var resolved := LocalizationSolver.resolve_name_key(catalog, "ghost.unregistered.key", "zh_CN")
	var passed = resolved == "[ghost.unregistered.key]" and LocalizationSolver.missing_name_keys == 1
	return {
		"test": "TC-NAM-04: 未登记告警（[key] 原样返回 + 计数 +1，不抛 Fatal）",
		"passed": passed
	}

## TC-NAM-05: 跨域冲突拦截（同 key 双域登记 → NAME_KEY_COLLISION，原所有者不被覆盖）
static func _test_cross_domain_collision() -> Dictionary:
	var catalog := LocalizationRegistryCatalog.new()
	var r1 := catalog.register_name_key("shared.conflict.name", "item", "Item Name")
	var r2 := catalog.register_name_key("shared.conflict.name", "magic", "Magic Name")
	var owner_kept := catalog.get_name_key_owner("shared.conflict.name") == "item"
	var passed = r1.success and not r2.success \
		and str(r2.get("code", "")) == "NAME_KEY_COLLISION" and owner_kept
	return {
		"test": "TC-NAM-05: 跨域冲突拦截（NAME_KEY_COLLISION + 原所有者保留）",
		"passed": passed
	}

## TC-NAM-06: 存量迁移批次 1（九处后端 fallback 英文化落地 + 魔法键中文解析无 [key]）
static func _test_migration_batch_one_done() -> Dictionary:
	var guest_prefix: String = GameConfig.get_string("domains.account", "auth/guest_name_prefix", "")
	var title_prefix: String = GameConfig.get_string("domains.account", "save_slot/defaults/title_prefix", "")
	var shared := LocalizationRegistryCatalog.get_shared()
	var archmage_key := LocalizationSolver.resolve_name_key(shared, "magic.profession_rank.holy_archmage", "zh_CN")
	var passed = guest_prefix == "ROGUE_" and title_prefix == "Apprentice Adventurer" \
		and archmage_key == "圣魔导师" and not archmage_key.begins_with("[")
	return {
		"test": "TC-NAM-06: 存量迁移批次 1（guest_name_prefix/职业称号英文化 + 魔法键中文解析）",
		"passed": passed
	}

## 三段式名称键格式校验（<域>.<条目>.<字段> 全小写英文）
static func _key_format_valid(key: String) -> bool:
	var parts := key.split(".")
	if parts.size() != 3:
		return false
	for part in parts:
		if part.is_empty() or not part[0].is_valid_identifier():
			return false
	return true
