# ==============================================================================
# 单元测试：Phase 46 物品属性双 UID 联动与隐藏特殊词缀体系
# 文件路径: res://tests/integration/pipelines/test_item_attribute_affix_system_pipeline.gd
# 职责: 验证双 UID 身份解耦、ABC 三类属性生命周期、隐藏鉴定、品质升格、非负下界与防伪守卫
# ==============================================================================
class_name TestItemAttributeAffixSystemPipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_dual_uid_decoupling())
	results.append(_test_three_attribute_categories())
	results.append(_test_appraisal_state_lifecycle())
	results.append(_test_quality_dynamic_promotion())
	results.append(_test_non_negative_lower_bound_and_caps())
	results.append(_test_anti_spoofing_audit_security())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "Item Dual UID & Special Affix System (Phase 46)",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}

## TC-P46-S4-01: Item UID 与 Attribute UID 身份解耦与配置绑定验证
static func _test_dual_uid_decoupling() -> Dictionary:
	var registry := ItemAttributeRegistry.get_shared()
	var atk_def := registry.get_definition("ATTR_INC_ATK_T1")
	if atk_def == null:
		return {"test": "TC-P46-S4-01: 属性定义获取", "passed": false, "error": "Definition not found"}

	var item1 := ItemEntity.new()
	item1.item_uid = "ITEM_MITHRIL_SWORD_001"
	item1.template_id = "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"

	var item2 := ItemEntity.new()
	item2.item_uid = "ITEM_MITHRIL_SWORD_002"
	item2.template_id = "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"

	var mount1 := ItemAttributeMountInstance.new()
	mount1.mount_id = "MOUNT_001"
	mount1.attribute_uid = atk_def.attribute_uid
	mount1.current_value = 15.0
	item1.mount_attribute(mount1)

	var mount2 := ItemAttributeMountInstance.new()
	mount2.mount_id = "MOUNT_002"
	mount2.attribute_uid = atk_def.attribute_uid
	mount2.current_value = 18.0 # 独立实例不同浮动值
	item2.mount_attribute(mount2)

	# 断言：双物品 UID 独立，挂载同属性定义，彼此数据隔离
	if item1.item_uid == item2.item_uid:
		return {"test": "TC-P46-S4-01: 物品 UID 唯一性", "passed": false, "error": "Item UIDs collide"}
	if mount1.item_uid != item1.item_uid or mount2.item_uid != item2.item_uid:
		return {"test": "TC-P46-S4-01: 挂载所属反向绑定", "passed": false, "error": "Mount binding mismatch"}
	if mount1.attribute_uid != mount2.attribute_uid:
		return {"test": "TC-P46-S4-01: 共享属性定义 UID", "passed": false, "error": "Attribute UID mismatch"}
	if mount1.current_value == mount2.current_value:
		return {"test": "TC-P46-S4-01: 实例值独立性", "passed": false, "error": "Mount values not independent"}

	return {"test": "TC-P46-S4-01: 双 UID 身份解耦与挂载绑定", "passed": true}

## TC-P46-S4-02: A类增量、B类减量、C类特殊词缀结构独立性验证
static func _test_three_attribute_categories() -> Dictionary:
	var registry := ItemAttributeRegistry.get_shared()
	var defs := registry.get_all_definitions()

	var mount_a := ItemAttributeMountInstance.new()
	mount_a.attribute_uid = "ATTR_INC_ATK_T1"
	mount_a.category = ItemAttributeDefinition.AttributeCategory.INCREMENT
	mount_a.current_value = 15.0
	mount_a.visibility = ItemAttributeMountInstance.VisibilityState.VISIBLE
	mount_a.is_active = true

	var mount_b := ItemAttributeMountInstance.new()
	mount_b.attribute_uid = "ATTR_DEC_DEF_CURSE_T1"
	mount_b.category = ItemAttributeDefinition.AttributeCategory.DECREMENT
	mount_b.current_value = 10.0
	mount_b.visibility = ItemAttributeMountInstance.VisibilityState.VISIBLE
	mount_b.is_active = true

	var mount_c := ItemAttributeMountInstance.new()
	mount_c.attribute_uid = "ATTR_SPECIAL_VAMPIRE_T1"
	mount_c.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
	mount_c.current_value = 0.15
	mount_c.visibility = ItemAttributeMountInstance.VisibilityState.HIDDEN
	mount_c.is_active = false # C 类未鉴定前必须不激活

	var mounts: Array = [mount_a, mount_b, mount_c]
	var base_stats := {
		"attack": 20.0,
		"defense": 30.0,
		"life_steal_rate": 0.0
	}

	var res := ItemAttributeEvaluationSolver.evaluate_effective_stats(
		"ITEM_TEST_ABC", base_stats, mounts, defs
	)
	var final_stats: Dictionary = res.get("final_stats", {})

	# A 类：20 + 15 = 35.0
	if absf(float(final_stats.get("attack", 0.0)) - 35.0) > 0.001:
		return {"test": "TC-P46-S4-02: A类增量生效", "passed": false, "error": "Attack stat incorrect"}

	# B 类：30 - 10 = 20.0
	if absf(float(final_stats.get("defense", 0.0)) - 20.0) > 0.001:
		return {"test": "TC-P46-S4-02: B类减量生效", "passed": false, "error": "Defense stat incorrect"}

	# C 类：由于 HIDDEN + inactive，life_steal_rate 保持 0.0
	if absf(float(final_stats.get("life_steal_rate", 0.0)) - 0.0) > 0.001:
		return {"test": "TC-P46-S4-02: C类隐藏态不生效", "passed": false, "error": "Hidden affix was active"}

	return {"test": "TC-P46-S4-02: ABC 三类属性结构对称与语义独立", "passed": true}

## TC-P46-S4-03: C类隐藏属性“HIDDEN -> 鉴定 -> APPRAISED”生命周期验证
static func _test_appraisal_state_lifecycle() -> Dictionary:
	var registry := ItemAttributeRegistry.get_shared()
	var def := registry.get_definition("ATTR_SPECIAL_VAMPIRE_T1")

	var mount := ItemAttributeMountInstance.new()
	mount.item_uid = "ITEM_DAGGER_099"
	mount.attribute_uid = "ATTR_SPECIAL_VAMPIRE_T1"
	mount.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
	mount.current_value = 0.15
	mount.visibility = ItemAttributeMountInstance.VisibilityState.HIDDEN
	mount.is_active = false

	# 1. 技能等级不足拦截
	var fail_ctx_skill := {"appraisal_skill_level": 1, "unlocked_lores": ["BLOOD_ALCHEMY"]}
	var r1 := ItemAttributeAppraisalSolver.appraise_mount_attribute(mount, def, fail_ctx_skill)
	if r1.success or r1.error_code != "SKILL_LEVEL_INSUFFICIENT" or mount.is_active:
		return {"test": "TC-P46-S4-03: 技能不足拦截", "passed": false, "error": "Appraisal succeeded illegally"}

	# 2. 知识体系缺失拦截
	var fail_ctx_lore := {"appraisal_skill_level": 5, "unlocked_lores": ["ANCIENT_RUNES"]}
	var r2 := ItemAttributeAppraisalSolver.appraise_mount_attribute(mount, def, fail_ctx_lore)
	if r2.success or r2.error_code != "REQUIRED_LORE_MISSING" or mount.is_active:
		return {"test": "TC-P46-S4-03: 知识缺失拦截", "passed": false, "error": "Lore check failed"}

	# 3. 满足条件成功鉴定
	var pass_ctx := {
		"appraisal_skill_level": 4,
		"unlocked_lores": ["BLOOD_ALCHEMY", "DIVINE_SCRIPTURE"],
		"actor_id": "MASTER_APPRAISER_01"
	}
	var r3 := ItemAttributeAppraisalSolver.appraise_mount_attribute(mount, def, pass_ctx)
	if not r3.success or not mount.is_active:
		return {"test": "TC-P46-S4-03: 鉴定跃迁激活", "passed": false, "error": "Valid appraisal failed"}
	if mount.visibility != ItemAttributeMountInstance.VisibilityState.APPRAISED:
		return {"test": "TC-P46-S4-03: 可见性跃迁", "passed": false, "error": "Visibility not APPRAISED"}
	if r3.audit_token.is_empty():
		return {"test": "TC-P46-S4-03: 防伪留痕签发", "passed": false, "error": "Audit token empty"}

	return {"test": "TC-P46-S4-03: C类隐藏属性鉴定与激活生命周期", "passed": true}

## TC-P46-S4-04: 普通品质物品经高阶 C 类词缀鉴定后的动态升格验证
static func _test_quality_dynamic_promotion() -> Dictionary:
	var registry := ItemAttributeRegistry.get_shared()
	var defs := registry.get_all_definitions()

	var mount_holy := ItemAttributeMountInstance.new()
	mount_holy.item_uid = "ITEM_RUSTY_SWORD_001"
	mount_holy.attribute_uid = "ATTR_SPECIAL_HOLY_GLOW_T1"
	mount_holy.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
	mount_holy.current_value = 45.0
	mount_holy.visibility = ItemAttributeMountInstance.VisibilityState.HIDDEN
	mount_holy.is_active = false

	# 鉴定前：原品质 1（普通），升格判定仍为 1
	var promo_before := ItemQualityPromotionSolver.evaluate_quality_promotion(1, [mount_holy], defs)
	if promo_before.effective_tier_rank != 1 or promo_before.is_promoted:
		return {"test": "TC-P46-S4-04: 未鉴定不升格", "passed": false, "error": "Promoted prematurely"}

	# 执行合法鉴定：激活神圣之光词缀 (affix_score = 280.0，超过 tier_4 260.0 门槛)
	var holy_def := registry.get_definition("ATTR_SPECIAL_HOLY_GLOW_T1")
	var pass_ctx := {
		"appraisal_skill_level": 5,
		"unlocked_lores": ["DIVINE_SCRIPTURE"],
		"actor_id": "HIGH_PRIEST_01"
	}
	var app_res := ItemAttributeAppraisalSolver.appraise_mount_attribute(mount_holy, holy_def, pass_ctx)
	if not app_res.success:
		return {"test": "TC-P46-S4-04: 词缀鉴定", "passed": false, "error": "Holy glow appraisal failed"}

	# 鉴定后：动态重新评估综合品阶
	var promo_after := ItemQualityPromotionSolver.evaluate_quality_promotion(1, [mount_holy], defs)
	if not promo_after.is_promoted or promo_after.effective_tier_rank < 4:
		return {"test": "TC-P46-S4-04: 动态升格至史诗", "passed": false, "error": "Promotion tier mismatch"}

	return {"test": "TC-P46-S4-04: 词缀评分驱动品质动态升格", "passed": true}

## TC-P46-S4-05: 属性下界非负（>=0.0）截断与上界约束验证
static func _test_non_negative_lower_bound_and_caps() -> Dictionary:
	var registry := ItemAttributeRegistry.get_shared()
	var defs := registry.get_all_definitions()

	# 1. 强力诅咒导致基础防御 5 减去 25 = -20
	var mount_curse := ItemAttributeMountInstance.new()
	mount_curse.attribute_uid = "ATTR_DEC_DEF_CURSE_T1"
	mount_curse.category = ItemAttributeDefinition.AttributeCategory.DECREMENT
	mount_curse.current_value = 25.0
	mount_curse.visibility = ItemAttributeMountInstance.VisibilityState.VISIBLE
	mount_curse.is_active = true

	var base_stats := {"defense": 5.0}
	var res := ItemAttributeEvaluationSolver.evaluate_effective_stats(
		"ITEM_CURSED_RING", base_stats, [mount_curse], defs
	)
	var final_def: float = float(res.get("final_stats", {}).get("defense", -1.0))

	# 铁律断言：计算结果为 -20，必须严格截断为 0.0
	if absf(final_def - 0.0) > 0.001:
		return {"test": "TC-P46-S4-05: 非负下界截断", "passed": false, "error": "Defense was negative or invalid: %f" % final_def}

	# 2. 超额单条属性上界钳制：ATTR_INC_ATK_T1 上界为 50.0，给入 80.0
	var mount_overflow := ItemAttributeMountInstance.new()
	mount_overflow.attribute_uid = "ATTR_INC_ATK_T1"
	mount_overflow.category = ItemAttributeDefinition.AttributeCategory.INCREMENT
	mount_overflow.current_value = 80.0
	mount_overflow.visibility = ItemAttributeMountInstance.VisibilityState.VISIBLE
	mount_overflow.is_active = true

	var res_overflow := ItemAttributeEvaluationSolver.evaluate_effective_stats(
		"ITEM_SWORD_OVERFLOW", {"attack": 0.0}, [mount_overflow], defs
	)
	var final_atk: float = float(res_overflow.get("final_stats", {}).get("attack", 0.0))
	if final_atk > 50.0:
		return {"test": "TC-P46-S4-05: 单属性上界截断", "passed": false, "error": "Attack exceeded cap: %f" % final_atk}

	return {"test": "TC-P46-S4-05: 属性非负下界截断与有效值上界约束", "passed": true}

## TC-P46-S4-06: 伪造已鉴定状态的客户端作弊拦截与防伪凭证验证
static func _test_anti_spoofing_audit_security() -> Dictionary:
	# 1. 客户端伪造：声明为已鉴定，但签名缺失
	var fake_mount1 := ItemAttributeMountInstance.new()
	fake_mount1.item_uid = "ITEM_CHEAT_01"
	fake_mount1.attribute_uid = "ATTR_SPECIAL_VAMPIRE_T1"
	fake_mount1.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
	fake_mount1.visibility = ItemAttributeMountInstance.VisibilityState.APPRAISED
	fake_mount1.is_active = true
	fake_mount1.appraisal_audit = {"is_appraised": true, "audit_signature": ""} # 伪造但无签名

	if ItemAttributeSecurityGuard.verify_mount_integrity(fake_mount1):
		return {"test": "TC-P46-S4-06: 空签名伪造拦截", "passed": false, "error": "Empty signature was accepted"}

	# 2. 客户端伪造：篡改时间戳导致哈希不匹配
	var fake_mount2 := ItemAttributeMountInstance.new()
	fake_mount2.item_uid = "ITEM_CHEAT_02"
	fake_mount2.attribute_uid = "ATTR_SPECIAL_VAMPIRE_T1"
	fake_mount2.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
	fake_mount2.visibility = ItemAttributeMountInstance.VisibilityState.APPRAISED
	fake_mount2.is_active = true
	fake_mount2.appraisal_audit = {
		"is_appraised": true,
		"appraised_timestamp": 1234567,
		"appraiser_actor_id": "HACKER",
		"audit_signature": "DEADBEEFCAFE0000"
	}

	if ItemAttributeSecurityGuard.verify_mount_integrity(fake_mount2):
		return {"test": "TC-P46-S4-06: 假哈希签名拦截", "passed": false, "error": "Invalid signature was accepted"}

	# 3. 服务端合法鉴定生成的凭据校验
	var def := ItemAttributeRegistry.get_shared().get_definition("ATTR_SPECIAL_VAMPIRE_T1")
	var valid_mount := ItemAttributeMountInstance.new()
	valid_mount.item_uid = "ITEM_LEGIT_01"
	valid_mount.attribute_uid = "ATTR_SPECIAL_VAMPIRE_T1"
	valid_mount.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
	valid_mount.visibility = ItemAttributeMountInstance.VisibilityState.HIDDEN
	valid_mount.is_active = false

	var pass_ctx := {
		"appraisal_skill_level": 5,
		"unlocked_lores": ["BLOOD_ALCHEMY"],
		"actor_id": "MASTER_01"
	}
	var app_res := ItemAttributeAppraisalSolver.appraise_mount_attribute(valid_mount, def, pass_ctx)
	if not app_res.success:
		return {"test": "TC-P46-S4-06: 正当鉴定执行", "passed": false, "error": "Legit appraisal failed"}

	if not ItemAttributeSecurityGuard.verify_mount_integrity(valid_mount):
		return {"test": "TC-P46-S4-06: 合法签名校验", "passed": false, "error": "Legit signature was rejected"}

	return {"test": "TC-P46-S4-06: 鉴定状态防伪签名与客户端篡改拦截", "passed": true}
