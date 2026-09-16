# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 36 物品命名空间注册表单元测试
# 文件路径: res://tests/unit/domains/test_item_namespace_registry.gd
# ==============================================================================
class_name TestItemNamespaceRegistryDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 36: 全域物品统一命名空间与注册表系统"

	results.append(_test_canonical_id_namespace_validation())
	results.append(_test_id_collision_prevention())
	results.append(_test_numeric_id_auto_increment())
	results.append(_test_numeric_id_collision_prevention())
	results.append(_test_name_key_uniqueness())
	results.append(_test_alias_dedup())
	results.append(_test_alias_inverted_index_search())
	results.append(_test_unregister_recycles())
	results.append(_test_config_assembly_and_reload())
	results.append(_test_english_name_strict_resolution())
	results.append(_test_uid_uniqueness_across_prefixes())
	results.append(_test_uid_counter_monotonic())
	results.append(_test_uid_checksum_anti_tamper())
	results.append(_test_uid_legacy_migration())
	results.append(_test_server_grant_idempotent())
	results.append(_test_factory_build_with_uid())

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

static func _test_canonical_id_namespace_validation() -> Dictionary:
	var valid_id = "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"
	var invalid_id_short = "MITHRIL_LONGSWORD"
	var invalid_id_domain = "OTHER:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"
	var invalid_id_empty_segment = "KALAR:EQUIP::MITHRIL_LONGSWORD"

	var ok1 = ItemRegistrySolver.validate_canonical_id_format(valid_id)
	var ok2 = ItemRegistrySolver.validate_canonical_id_format(invalid_id_short)
	var ok3 = ItemRegistrySolver.validate_canonical_id_format(invalid_id_domain)
	var ok4 = ItemRegistrySolver.validate_canonical_id_format(invalid_id_empty_segment)

	var passed = ok1 and (not ok2) and (not ok3) and (not ok4)
	return {
		"test": "TC-ITEM-REG-01: 物品 Canonical ID 分级命名空间格式校验（含空段拦截）",
		"passed": passed
	}

static func _test_id_collision_prevention() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto1 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:ARMOR:IRON_CHEST", 101, "item.iron_chest.name", "EQUIPMENT", "ARMOR_PLATE", 1, 1.5, 2, 100, [], "iron_chest"
	)
	var proto2 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:ARMOR:IRON_CHEST", 102, "item.iron_chest_v2.name", "EQUIPMENT", "ARMOR_PLATE", 1, 1.5, 2, 100, [], "iron_chest_v2"
	)

	var res1 = ItemRegistrySolver.register_prototype(catalog, proto1)
	var res2 = ItemRegistrySolver.register_prototype(catalog, proto2)

	var passed = res1.success and (not res2.success) and (res2.error_code == "ERR_ID_COLLISION")
	return {
		"test": "TC-ITEM-REG-02: 物品 ID 防撞库冲突与重复注册拦截",
		"passed": passed
	}

static func _test_numeric_id_auto_increment() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var p1 = ItemRegistryCatalog.ItemPrototypeTemplate.new("KALAR:EQUIP:WEAPON_BLADE:SWORD_A", 0, "item.sword_a.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_a")
	var p2 = ItemRegistryCatalog.ItemPrototypeTemplate.new("KALAR:EQUIP:WEAPON_BLADE:SWORD_B", 0, "item.sword_b.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_b")
	var p3 = ItemRegistryCatalog.ItemPrototypeTemplate.new("KALAR:EQUIP:WEAPON_BLADE:SWORD_C", 50, "item.sword_c.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_c")
	var p4 = ItemRegistryCatalog.ItemPrototypeTemplate.new("KALAR:EQUIP:WEAPON_BLADE:SWORD_D", 0, "item.sword_d.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_d")

	var ok1 = ItemRegistrySolver.register_prototype(catalog, p1).success
	var ok2 = ItemRegistrySolver.register_prototype(catalog, p2).success
	var ok3 = ItemRegistrySolver.register_prototype(catalog, p3).success
	var ok4 = ItemRegistrySolver.register_prototype(catalog, p4).success

	var passed = ok1 and ok2 and ok3 and ok4 \
		and p1.numeric_id == 1 and p2.numeric_id == 2 \
		and p3.numeric_id == 50 and p4.numeric_id == 51
	return {
		"test": "TC-ITEM-REG-04: 数字 ID 自动递增分配（未填按序分配，显式 ID 抬高水位）",
		"passed": passed
	}

static func _test_numeric_id_collision_prevention() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto1 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:ARMOR:IRON_CHEST", 101, "item.iron_chest.name", "EQUIPMENT", "ARMOR_PLATE", 1, 1.5, 2, 100, [], "iron_chest"
	)
	var proto2 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:ARMOR:IRON_PAULDRON", 101, "item.iron_pauldron.name", "EQUIPMENT", "ARMOR_PLATE", 1, 1.5, 2, 100, [], "iron_pauldron"
	)

	var res1 = ItemRegistrySolver.register_prototype(catalog, proto1)
	var res2 = ItemRegistrySolver.register_prototype(catalog, proto2)

	var passed = res1.success and (not res2.success) and (res2.error_code == "ERR_NUMERIC_COLLISION")
	return {
		"test": "TC-ITEM-REG-05: 数字 ID 冲突拦截（显式重复不再静默覆盖）",
		"passed": passed
	}

static func _test_name_key_uniqueness() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto1 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_X", 0, "item.shared_sword.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_x"
	)
	var proto2 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_Y", 0, "item.shared_sword.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_y"
	)

	var res1 = ItemRegistrySolver.register_prototype(catalog, proto1)
	var res2 = ItemRegistrySolver.register_prototype(catalog, proto2)

	var passed = res1.success and (not res2.success) and (res2.error_code == "ERR_NAME_KEY_COLLISION")
	return {
		"test": "TC-ITEM-REG-06: 展示名键唯一性校验（同名键拒绝注册）",
		"passed": passed
	}

static func _test_alias_dedup() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD", 0, "item.iron_sword.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, ["铁剑", "铁剑", ""], "iron_sword"
	)

	var res = ItemRegistrySolver.register_prototype(catalog, proto)
	var hits = catalog.search_by_alias("铁剑")

	var passed = res.success and hits.size() == 1 \
		and hits[0] == proto.canonical_id \
		and catalog.search_by_alias("").is_empty()
	return {
		"test": "TC-ITEM-REG-07: 别名倒排索引去重（同物品重复别名与空别名忽略）",
		"passed": passed
	}

static func _test_alias_inverted_index_search() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD",
		1001,
		"item.mithril_longsword.name",
		"EQUIPMENT",
		"WEAPON_BLADE",
		3,
		1.5,
		2,
		350,
		["秘银剑", "蓝晶长刃", "mithril_blade"],
		"mithril_longsword"
	)
	ItemRegistrySolver.register_prototype(catalog, proto)

	var matches_zh = ItemRegistrySolver.resolve_search_term(catalog, "秘银剑")
	var matches_en = ItemRegistrySolver.resolve_search_term(catalog, "MITHRIL_BLADE")
	var matches_none = ItemRegistrySolver.resolve_search_term(catalog, "屠龙宝刀")

	var passed = (matches_zh.size() == 1 and matches_zh[0] == proto.canonical_id) and \
				 (matches_en.size() == 1 and matches_en[0] == proto.canonical_id) and \
				 (matches_none.is_empty())

	return {
		"test": "TC-ITEM-REG-03: 多语言通俗别名倒排索引极速模糊查找",
		"passed": passed
	}

static func _test_unregister_recycles() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto1 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:RECYCLE_SWORD", 5, "item.recycle_sword.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, ["回收剑", "recycle_blade"], "recycle_sword"
	)
	ItemRegistrySolver.register_prototype(catalog, proto1)

	# 注销：主表/数字映射/名称键/别名索引全部清理，数字 ID 回空闲池
	var res1 = ItemRegistrySolver.unregister_prototype(catalog, proto1.canonical_id)
	var removed = res1.success and catalog.get_prototype(proto1.canonical_id) == null
	var alias_cleaned = catalog.search_by_alias("回收剑").is_empty()
	var name_cleaned = catalog.get_canonical_id_by_loc_key("item.recycle_sword.name").is_empty()

	# 回收的数字 ID 被新物品复用
	var proto2 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:RECYCLE_DAGGER", 0, "item.recycle_dagger.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "recycle_dagger"
	)
	ItemRegistrySolver.register_prototype(catalog, proto2)
	var id_recycled = proto2.numeric_id == 5

	# 回收的名称键可复用
	var proto3 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:RECYCLE_AXE", 0, "item.recycle_sword.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "recycle_axe"
	)
	var name_reused = ItemRegistrySolver.register_prototype(catalog, proto3).success

	# 二次注销返回 NOT_FOUND
	var res2 = ItemRegistrySolver.unregister_prototype(catalog, proto1.canonical_id)
	var not_found = (not res2.success) and res2.error_code == "ERR_NOT_FOUND"

	var passed = removed and alias_cleaned and name_cleaned and id_recycled and name_reused and not_found
	return {
		"test": "TC-ITEM-REG-08: 注销回收（数字 ID 与名称键回空闲池并复用）",
		"passed": passed
	}

static func _test_config_assembly_and_reload() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var base_count: int = catalog._canonical_registry.size()

	# 装配：config/items/core.json 全量物品登记，数字 ID 自动递增且确定
	var sword = catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var assembly_ok = base_count >= 6 and sword != null and sword.numeric_id >= 1

	# 注册一件配置外的物品
	var extra = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:EXTRA_SWORD", 0, "item.extra_sword.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "extra_sword"
	)
	ItemRegistrySolver.register_prototype(catalog, extra)
	var extra_id: int = extra.numeric_id

	# 热重载：配置外物品被自动注销（数字 ID 与名称键回收）
	var reload_res = ItemLoaderPipeline.reload_from_config(catalog)
	var unregistered_ok = reload_res.get("unregistered", []).has(extra.canonical_id) \
		and catalog._canonical_registry.size() == base_count \
		and catalog.get_canonical_id_by_loc_key("item.extra_sword.name").is_empty()

	# 回收的数字 ID 被新物品复用
	var next = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:EXTRA_DAGGER", 0, "item.extra_dagger.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "extra_dagger"
	)
	ItemRegistrySolver.register_prototype(catalog, next)
	var id_reused = next.numeric_id == extra_id

	var passed = assembly_ok and unregistered_ok and id_reused
	return {
		"test": "TC-ITEM-REG-09: 装配入口与配置热重载差异回收（删除自动注销、ID/名称键回收复用）",
		"passed": passed
	}

static func _test_english_name_strict_resolution() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	# 统一英文名（大小写不敏感）命中注册表
	var hit = ItemRegistrySolver.resolve_by_english_name(catalog, "mithril_longsword")
	var hit_upper = ItemRegistrySolver.resolve_by_english_name(catalog, "MITHRIL_LONGSWORD")
	var en_ok = hit.success \
		and hit.canonical_id == "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD" \
		and hit_upper.success and hit_upper.canonical_id == hit.canonical_id

	# 中文别名与数字 ID 一律拒绝（GM /give 仅接受统一英文名）
	var zh_rejected = not ItemRegistrySolver.resolve_by_english_name(catalog, "秘银剑").success
	var num_rejected = not ItemRegistrySolver.resolve_by_english_name(catalog, "1001").success

	# 英文名必填：缺失 english_name 注册即拒（无缺省推导）
	var missing_proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:TEST_BLADE", 0, "item.test_blade.name"
	)
	var missing_catalog := ItemRegistryCatalog.new()
	var res_missing = ItemRegistrySolver.register_prototype(missing_catalog, missing_proto)
	var missing_ok = (not res_missing.success) and res_missing.error_code == "ERR_ENGLISH_NAME_MISSING"

	# 英文名唯一性：同英文名拒绝注册
	var catalog2 := ItemRegistryCatalog.new()
	var a = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_AA", 0, "item.sword_aa.name", "EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_aa"
	)
	var b = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_BB", 0, "item.sword_bb.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_aa"
	)
	ItemRegistrySolver.register_prototype(catalog2, a)
	var res_b = ItemRegistrySolver.register_prototype(catalog2, b)
	var collision_ok = (not res_b.success) and res_b.error_code == "ERR_ENGLISH_NAME_COLLISION"

	# 大小写归一：混合大小写注册后统一为小写，大小写变体解析同一物品（原大小写漏检回归用例）
	var catalog3 := ItemRegistryCatalog.new()
	var mixed = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_MIXED", 0, "item.sword_mixed.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "Sword_Mixed"
	)
	ItemRegistrySolver.register_prototype(catalog3, mixed)
	var normalized_ok = mixed.english_name == "sword_mixed" \
		and ItemRegistrySolver.resolve_by_english_name(catalog3, "SWORD_MIXED").success \
		and ItemRegistrySolver.resolve_by_english_name(catalog3, "sword_mixed").success
	var mixed2 = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_MIXED2", 0, "item.sword_mixed2.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "sword_mixed"
	)
	var res_mixed2 = ItemRegistrySolver.register_prototype(catalog3, mixed2)
	var normalized_collision_ok = (not res_mixed2.success) and res_mixed2.error_code == "ERR_ENGLISH_NAME_COLLISION"

	# 非法格式拒绝（含空格/大写）
	var bad_catalog := ItemRegistryCatalog.new()
	var bad = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:SWORD_BAD", 0, "item.sword_bad.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "Bad Sword"
	)
	var res_bad = ItemRegistrySolver.register_prototype(bad_catalog, bad)
	var invalid_ok = (not res_bad.success) and res_bad.error_code == "ERR_ENGLISH_NAME_INVALID"

	var passed = en_ok and zh_rejected and num_rejected and missing_ok and collision_ok \
		and normalized_ok and normalized_collision_ok and invalid_ok
	return {
		"test": "TC-ITEM-REG-10: 统一英文名严格解析（拒绝中文/数字 ID/必填/大小写归一/格式断言/唯一性）",
		"passed": passed
	}


static func _test_uid_uniqueness_across_prefixes() -> Dictionary:
	var seen: Dictionary = {}
	var collision := false
	var prefixes: Array = ["GM_", "CDK_", "GAC_", "MAIL_", "SRV_"]
	for pfx in prefixes:
		for i in range(2000):
			var uid := ItemUIDGenerator.generate_uid(String(pfx))
			if uid.is_empty() or seen.has(uid):
				collision = true
				break
			seen[uid] = true
	return {"test": "TC-P09-01: UID 同批零碰撞且跨前缀隔离（5x2000）", "passed": not collision and seen.size() == 10000}

static func _test_uid_counter_monotonic() -> Dictionary:
	var before := ItemUIDGenerator.current_counter()
	var uid := ItemUIDGenerator.generate_uid("GM_")
	var after := ItemUIDGenerator.current_counter()
	# 恢复路径可观察：恢复到严格大于当前计数的值，断言恢复即时可见（restore 失效即失败）
	ItemUIDGenerator.restore_counter(after + 1000)
	var restored_visible := ItemUIDGenerator.current_counter() == after + 1000
	var restored_uid := ItemUIDGenerator.generate_uid("GM_")
	var monotonic: bool = after > before and restored_visible and restored_uid != uid and ItemUIDGenerator.validate_uid(restored_uid)
	return {"test": "TC-P09-02: UID 计数单调且重启续增可复现（恢复路径可观察）", "passed": monotonic}

static func _test_uid_checksum_anti_tamper() -> Dictionary:
	var uid := ItemUIDGenerator.generate_uid("MAIL_")
	var tampered: String = uid
	var tail := tampered.substr(tampered.length() - 1, 1)
	tampered = tampered.substr(0, tampered.length() - 1) + ("X" if tail != "X" else "Y")
	var passed: bool = ItemUIDGenerator.validate_uid(uid) and not ItemUIDGenerator.validate_uid(tampered) and ItemUIDGenerator.prefix_of(uid) == "MAIL_"
	return {"test": "TC-P09-03: UID 校验尾防篡改与来源追溯", "passed": passed}

static func _test_uid_legacy_migration() -> Dictionary:
	var mig1 := ItemEntity.migrate_legacy_uid("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "GM_ITEM_172")
	var mig2 := ItemEntity.migrate_legacy_uid("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "GM_ITEM_172")
	var item := ItemEntity.deserialize({"item_id": "GM_ITEM_172", "template_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"})
	# 碰撞守卫：同模板同 item_id 的两件旧档实例，经不同判别子（槽位键/序号）迁移得到互异 UID
	var dup_a := ItemEntity.migrate_legacy_uid("KALAR:CONSUM:ALCHEMY:POTION_MANA", "KALAR:CONSUM:ALCHEMY:POTION_MANA", "BACKPACK_0")
	var dup_b := ItemEntity.migrate_legacy_uid("KALAR:CONSUM:ALCHEMY:POTION_MANA", "KALAR:CONSUM:ALCHEMY:POTION_MANA", "BACKPACK_1")
	# legacy 感知：迁移 UID 通过系统自校验（validate_uid）且来源可溯（prefix_of = LGC_）
	var legacy_valid := ItemUIDGenerator.validate_uid(mig1) and ItemUIDGenerator.prefix_of(mig1) == "LGC_"
	var passed: bool = mig1 == mig2 and mig1.begins_with("LGC_") and item.item_uid == mig1 \
		and dup_a != dup_b and legacy_valid
	return {"test": "TC-P09-04: 旧档无 uid 确定性迁移可复现且同模板多实例判别子防碰撞", "passed": passed}

static func _test_server_grant_idempotent() -> Dictionary:
	var registry := ServerGrantRegistry.new()
	var uid := ItemUIDGenerator.generate_uid("SRV_")
	var first := registry.register_grant("GRANT_A", uid, "CDKEY")
	var second := registry.register_grant("GRANT_A", uid, "CDKEY")
	var found := registry.find_grant_by_uid(uid)
	var passed: bool = first.success and (not second.success) and second.error_code == "GRANT_ALREADY_EXISTS" and found == "GRANT_A"
	return {"test": "TC-P09-05: 服务器发放幂等只增（同 grant 拒绝重放）", "passed": passed}

static func _test_factory_build_with_uid() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 1, "item.mithril.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "mithril_longsword"
	)
	ItemRegistrySolver.register_prototype(catalog, proto)
	var item := ItemInstanceFactory.build_instance(proto, "秘银剑", "GM_", "GM_ITEM_")
	var mail_item := ItemInstanceFactory.build_instance(proto, "礼物", "MAIL_")
	var passed: bool = ItemUIDGenerator.validate_uid(item.item_uid) and ItemUIDGenerator.prefix_of(item.item_uid) == "GM_" 		and ItemUIDGenerator.prefix_of(mail_item.item_uid) == "MAIL_" and mail_item.item_uid != item.item_uid
	return {"test": "TC-P09-06: 统一工厂发放链路携带权威 UID（GM/MAIL 前缀隔离）", "passed": passed}
