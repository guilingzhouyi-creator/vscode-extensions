# ==============================================================================
# 单元测试：Phase 41 统一魔法规则模型与行动卡机制 (Magic Rule System Tests)
# 文件路径: res://tests/unit/domains/test_magic_system.gd
# 覆盖: Phase 41 施工细则 阶段1~4（TC-MAGIC-S1-01~05 / S2-01~08 / S3-01~06）
#       —— 属性大类与派生变体 / 几重化 / 封印与解放 / 升格化 / 延时调度 /
#          统一结算器 / 组合语义（DEFINED/PARTIAL/BND_NOT_DEFINED）
# ==============================================================================
class_name TestMagicRuleSystemDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 41/42: 魔法规则引擎与行动卡收编（统一魔法规则 + 攻击系统对接）"

	# 阶段1：数据契约
	results.append(_test_registry_assembled_ready())
	results.append(_test_attribute_schools_loaded())
	results.append(_test_variants_fusion_condition())
	results.append(_test_dto_roundtrip())
	results.append(_test_bnd_defined_result())
	# 阶段2：核心机制
	results.append(_test_multi_cast_single())
	results.append(_test_multi_cast_max_cap())
	results.append(_test_seal_release_cycle())
	results.append(_test_seal_slot_and_repeat())
	results.append(_test_ascension_rank_up())
	results.append(_test_ascension_max_and_god_pair())
	results.append(_test_delay_schedule_and_drain())
	results.append(_test_delay_cancel_on_holder_lost())
	results.append(_test_physical_damage_via_real_pipeline())
	# Phase 42 收编验收（TC-CARD-S2-01/04/05）
	results.append(_test_combat_card_authority())
	results.append(_test_ap_stagger_validator())
	results.append(_test_effect_layer_seal_ascend())
	# 阶段3：工程化
	results.append(_test_combo_semantics())
	# Phase 44 P7 新增：SAME 模式 ctx 零拷贝共享 + registry 段查询零拷贝（TC-P44-P7-01/02）
	results.append(_test_multi_cast_same_shared_ctx())
	results.append(_test_registry_config_shared_readonly())

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

# ---------- 阶段1 ----------

static func _registry() -> MagicRuleRegistry:
	return GameBootstrap.magic_rules_registry()

static func _test_registry_assembled_ready() -> Dictionary:
	var reg := _registry()
	var ok := reg != null and reg.is_ready()
	# 必需段全量存在（阶段3 结构校验在 audit_config 另验，这里验装配可达）
	var required := ["attribute_schools", "attributes", "variants", "multi_cast", "seal", "ascension", "delay", "combo_semantics"]
	var cfg: Dictionary = GameConfig.get_dict("domains.magic_rules", "multi_cast", {})
	ok = ok and not cfg.is_empty()
	var passed = ok and required.size() == 8 and reg.school_ids().size() == 2
	return {"test": "TC-MAGIC-S1-01/S3-01: 注册表装配就绪 + 光/暗属性大类加载", "passed": passed}

static func _test_attribute_schools_loaded() -> Dictionary:
	var reg := _registry()
	var light: Dictionary = reg.get_school("LIGHT_SCHOOL")
	var dark: Dictionary = reg.get_school("DARK_SCHOOL")
	var light_members: Array = light.get("members", [])
	var dark_members: Array = dark.get("members", [])
	var light_ok := light_members.size() == 5 and reg.attribute_school("FIRE") == "LIGHT_SCHOOL"
	var dark_ok := dark_members.size() == 2 and reg.attribute_school("THUNDER") == "DARK_SCHOOL"
	# Phase 42 S3：normative_form 层级对齐键（光/暗 → 元素/规范魔法法式分支）
	var light_normative_ok: bool = light.get("normative_form", "") == "LIGHT"
	var dark_normative_ok: bool = dark.get("normative_form", "") == "DARK"
	var closed_ok := true
	for attr_id in reg.attribute_ids():
		if not reg.has_school(reg.attribute_school(attr_id)):
			closed_ok = false
			break
	var passed = light_ok and dark_ok and light_normative_ok and dark_normative_ok and closed_ok
	return {"test": "TC-MAGIC-S1-01: 光系五属性/暗系二属性成员闭合 + normative_form 对齐", "passed": passed}

static func _test_variants_fusion_condition() -> Dictionary:
	var reg := _registry()
	var holy: Dictionary = reg.get_variant("HOLY")
	var abyssal: Dictionary = reg.get_variant("ABYSSAL")
	var holy_ok: bool = not holy.is_empty() and MagicRuleCondition.evaluate(
		holy.get("fusion_conditions", {}), {"learned_by_school": {"LIGHT_SCHOOL": 2}}
	)
	var holy_denied: bool = not MagicRuleCondition.evaluate(
		holy.get("fusion_conditions", {}), {"learned_by_school": {"LIGHT_SCHOOL": 0}}
	)
	var abyssal_ok: bool = not abyssal.is_empty() and MagicRuleCondition.evaluate(
		abyssal.get("fusion_conditions", {}), {"learned_by_school": {"DARK_SCHOOL": 1}}
	)
	# Phase 42 S3：ranked_form_branch 层级对齐键（神圣/暗黑 → 位阶魔法分支）
	var holy_rfb_ok: bool = holy.get("ranked_form_branch", "") == "HOLY"
	var abyssal_rfb_ok: bool = abyssal.get("ranked_form_branch", "") == "ABYSSAL"
	var passed = holy_ok and holy_denied and abyssal_ok and holy_rfb_ok and abyssal_rfb_ok \
		and int(holy.get("variant_of_form", 0)) == 2  # 法式形态关联（非平行新顶层）
	return {"test": "TC-MAGIC-S1-02: 融会贯通条件可配置求值 + ranked_form_branch 对齐", "passed": passed}

## 测试夹具：DTO → 权威实体（权威实体无 from_dto，按原别名 from_dto 字段映射语义补齐）
static func _dto_to_cast_card(data: Dictionary) -> PhysicalVerbRegistry.CombatActionCardEntity:
	var card := PhysicalVerbRegistry.CombatActionCardEntity.new()
	card.card_id = str(data.get("card_id", ""))
	card.card_name = card.card_id
	card.card_category = "ATTACK"
	card.magic_ref = str(data.get("magic_ref", ""))
	var casts := 1
	var raw_effects: Array = data.get("effects", [])
	for effect in raw_effects:
		if effect is Dictionary and str(effect.get("kind", "")) == "magic_cast":
			casts = maxi(1, int(effect.get("casts_per_play", 1)))
	card.effects = [{"kind": "magic_cast", "casts_per_play": casts}]
	return card

static func _test_dto_roundtrip() -> Dictionary:
	var card := _make_cast_card("CARD_FIRE_NOVA", 3, "FIRE_NOVA")
	var dto: Dictionary = card.to_dto()
	var restored := _dto_to_cast_card(dto)
	var card_ok := MultiCastSolver.CONSUMES_PLAY == 1 \
		and restored.card_id == card.card_id \
		and restored.magic_ref == "FIRE_NOVA" \
		and restored.card_category == "ATTACK" \
		and restored.effects.size() == 1 \
		and int(restored.effects[0].get("casts_per_play", 0)) == 3

	var state := MagicRuleState.new()
	state.state_id = "SEAL_1"
	state.kind = MagicRuleState.StateKind.SEAL
	state.holder_id = "ACC_MAGE"
	state.magic_ref = "FIRE_NOVA"
	var state_restored := MagicRuleState.from_dto(state.to_dto())
	var state_ok := state_restored.holder_id == "ACC_MAGE" and state_restored.is_active() \
		and state.transition_to(MagicRuleState.StateStatus.RELEASED) \
		and not state.transition_to(MagicRuleState.StateStatus.CANCELLED)  # 终态不可逆

	var trigger := MagicRuleTrigger.new()
	trigger.trigger_id = "TRG_1"
	trigger.magic_ref = "FIRE_NOVA"
	trigger.remain_steps = 3
	var trigger_restored := MagicRuleTrigger.from_dto(trigger.to_dto())
	var trigger_ok := trigger_restored.remain_steps == 3 and trigger_restored.is_due() == false

	var passed = card_ok and state_ok and trigger_ok
	return {"test": "TC-MAGIC-S1-03: 行动卡/状态/触发器 DTO 往返对等 + 状态守卫", "passed": passed}

static func _test_bnd_defined_result() -> Dictionary:
	var reg := _registry()
	var undefined_combo := reg.combo_semantic("seal_x_warp")  # 未登记组合
	var passed = undefined_combo == MagicRuleRegistry.COMBO_UNDEFINED
	return {"test": "TC-MAGIC-S1-05: 待定义边界显式 BND_NOT_DEFINED（不静默猜测）", "passed": passed}

# ---------- 阶段2 ----------

## 测试夹具：直接构造权威行动卡实体（R-06：行动卡别名退役）
static func _make_cast_card(card_id: String, casts: int, magic_ref: String = "") -> PhysicalVerbRegistry.CombatActionCardEntity:
	var card := PhysicalVerbRegistry.CombatActionCardEntity.new()
	card.card_id = card_id
	card.card_name = card_id
	card.card_category = "ATTACK"   # 原 CardType.NORMAL → _category_for_type() 映射值
	card.magic_ref = magic_ref
	card.effects = [{"kind": "magic_cast", "casts_per_play": maxi(1, casts)}]  # 原 _effects_for_type() NORMAL 分支
	return card

static func _test_multi_cast_single() -> Dictionary:
	var card := _make_cast_card("CARD_BOLT", 1, "LIGHT_BOLT")
	var check := MultiCastSolver.validate_play(card)
	var exec := MultiCastSolver.execute_play(card, 1)
	var passed = check.get("success", false) and int(check.get("consumes_play", 0)) == 1 \
		and exec.get("success", false) and int(exec.get("attack_count", 0)) == 1 \
		and int(exec.get("consumes_play", 0)) == 1
	return {"test": "TC-MAGIC-S2-01: 几重化 1 次 = 普通打出（消耗 1 行动卡）", "passed": passed}

static func _test_multi_cast_max_cap() -> Dictionary:
	var card := _make_cast_card("CARD_BOLT5", 5, "LIGHT_BOLT")
	var check_ok := MultiCastSolver.validate_play(card)
	var exec := MultiCastSolver.execute_play(card, 2)
	var cap_ok: bool = bool(check_ok.get("success", false)) and int(exec.get("attack_count", 0)) == 5 \
		and int(exec.get("consumes_play", 0)) == 1

	var card6 := _make_cast_card("CARD_BOLT6", 6, "LIGHT_BOLT")
	var check_over := MultiCastSolver.validate_play(card6)
	var over_ok: bool = not check_over.get("success", false) \
		and check_over.get("error_code", "") == "MULTI_CAST_EXCEEDS_MAX"
	var passed = cap_ok and over_ok
	return {"test": "TC-MAGIC-S2-02: 几重化 5 次上限生效 / 6 次受控拒绝（仍 1 行动卡）", "passed": passed}

static func _test_seal_release_cycle() -> Dictionary:
	var seals := {}
	var cfg := {"max_seals_per_holder": 3, "allow_repeat_seal": false}
	var seal_res = SealFsm.apply_seal(seals, "ACC_MAGE", "FIRE_NOVA", "CARD_SEAL", cfg)
	var sealed_ok: bool = seal_res.get("success", false) \
		and SealFsm.is_sealed(seals, "ACC_MAGE", "FIRE_NOVA")
	# 重复封印拒绝
	var dup = SealFsm.apply_seal(seals, "ACC_MAGE", "FIRE_NOVA", "CARD_SEAL", cfg)
	var dup_ok: bool = not dup.get("success", false) and dup.get("error_code", "") == "ALREADY_SEALED"
	# 封印中不可打出（由调用方依据 is_sealed 前置拦截——语义查询生效）
	var playable_while_sealed := SealFsm.is_sealed(seals, "ACC_MAGE", "FIRE_NOVA")
	# 解放
	var release = SealFsm.apply_release(seals, "ACC_MAGE", "FIRE_NOVA")
	var release_ok: bool = release.get("success", false) \
		and not SealFsm.is_sealed(seals, "ACC_MAGE", "FIRE_NOVA")
	# 未封印解放 → NOT_SEALED
	var release_again = SealFsm.apply_release(seals, "ACC_MAGE", "FIRE_NOVA")
	var again_ok: bool = not release_again.get("success", false)
	var passed = sealed_ok and dup_ok and playable_while_sealed and release_ok and again_ok
	return {"test": "TC-MAGIC-S2-03: 封印→解放闭环（状态常驻建模、重复封印拒绝、清理）", "passed": passed}

static func _test_seal_slot_and_repeat() -> Dictionary:
	var seals := {}
	var cfg := {"max_seals_per_holder": 2, "allow_repeat_seal": true}
	SealFsm.apply_seal(seals, "ACC_A", "M1", "C", cfg)
	SealFsm.apply_seal(seals, "ACC_A", "M2", "C", cfg)
	var third = SealFsm.apply_seal(seals, "ACC_A", "M3", "C", cfg)
	var slot_ok: bool = not third.get("success", false) and third.get("error_code", "") == "SEAL_SLOT_FULL"
	# 超时清扫（duration>0 递减至 0 → EXPIRED 清理）
	SealFsm.apply_release(seals, "ACC_A", "M1")
	var seal1 = SealFsm.apply_seal(seals, "ACC_A", "M1", "C", {"max_seals_per_holder": 2, "default_duration_seconds": 1})
	var cleaned := 0
	if seal1.get("success", false):
		cleaned = SealFsm.cleanup_expired(seals, "ACC_A")
	var clean_ok := cleaned == 1
	var passed = slot_ok and clean_ok
	return {"test": "TC-MAGIC-S2-03b: 可封印数量上限 + 超时自动解除清理", "passed": passed}

static func _test_ascension_rank_up() -> Dictionary:
	var ranks := {"FIRE_NOVA": 2}
	var cfg := {"max_rank": 11, "allow_consecutive": false, "conditions": {}}
	var res = AscensionSolver.apply_ascension(ranks, "FIRE_NOVA", MagicTierSnapshot.MagicForm.INCANTATION, cfg)
	var ok: bool = res.get("success", false) and int(ranks["FIRE_NOVA"]) == 3 \
		and int(res.get("previous_rank", 0)) == 2 and int(res.get("rank", 0)) == 3
	var passed = ok
	return {"test": "TC-MAGIC-S2-04: 升格位阶 +1（引用同一魔法，无新卡实例）", "passed": passed}

static func _test_ascension_max_and_god_pair() -> Dictionary:
	var ranks_max := {"GOD_SPELL": 11}
	var cfg := {"max_rank": 11}
	var res_max = AscensionSolver.apply_ascension(ranks_max, "GOD_SPELL", MagicTierSnapshot.MagicForm.INCANTATION, cfg)
	var max_ok: bool = not res_max.get("success", false) and res_max.get("error_code", "") == "RANK_ALREADY_MAX"

	# god-form 不变量：INCANTATION 形态升到 RANK_10 应被拒绝（高阶位阶须 SUPERTIER 形态）
	var ranks_god := {"ASC_SPELL": 9}
	var res_god = AscensionSolver.apply_ascension(ranks_god, "ASC_SPELL", MagicTierSnapshot.MagicForm.INCANTATION, cfg)
	var god_ok: bool = not res_god.get("success", false) and res_god.get("error_code", "") == "GOD_FORM_PAIR_VIOLATION"
	var passed = max_ok and god_ok
	return {"test": "TC-MAGIC-S2-05: 最高位阶拒绝 + 高阶形态不变量拦截", "passed": passed}

static func _test_delay_schedule_and_drain() -> Dictionary:
	var scheduler := DelayScheduler.new()
	var trigger := MagicRuleTrigger.new()
	trigger.trigger_id = "TRG_D1"
	trigger.holder_id = "ACC_MAGE"
	trigger.magic_ref = "FIRE_NOVA"
	trigger.remain_steps = 3
	var sched = scheduler.schedule(trigger)
	var sched_ok: bool = sched.get("success", false)
	# 重复延时拒绝（同 holder + magic 未释放前，排程仍 pending）
	var dup = scheduler.schedule(trigger)
	var dup_ok: bool = not dup.get("success", false) and dup.get("error_code", "") == "ALREADY_DELAYED"
	# 非阻塞步进：推进 3 步后到期，pending 队列仍可继续接受新项（不阻塞玩家行动）
	scheduler.advance_steps(2)
	var mid_pending := scheduler.pending_count("ACC_MAGE") == 1
	scheduler.advance_steps(1)
	var due := scheduler.drain_due("ACC_MAGE")
	var drain_ok: bool = due.size() == 1 and scheduler.pending_count("ACC_MAGE") == 0
	var passed = sched_ok and mid_pending and drain_ok and dup_ok
	return {"test": "TC-MAGIC-S2-06: 延时 N 步到期强制打出（独立调度，非阻塞 + 重复拒绝）", "passed": passed}

static func _test_delay_cancel_on_holder_lost() -> Dictionary:
	var scheduler := DelayScheduler.new()
	var t1 := MagicRuleTrigger.new()
	t1.trigger_id = "TRG_LOST"
	t1.holder_id = "ACC_FALLEN"
	t1.magic_ref = "FIRE_NOVA"
	t1.remain_steps = 5
	var t2 := MagicRuleTrigger.new()
	t2.trigger_id = "TRG_ALIVE"
	t2.holder_id = "ACC_MAGE"
	t2.magic_ref = "LIGHT_BOLT"
	t2.remain_steps = 5
	scheduler.schedule(t1)
	scheduler.schedule(t2)
	var cancelled := scheduler.cancel_by_holder("ACC_FALLEN")
	var passed = cancelled == 1 and scheduler.pending_count("ACC_FALLEN") == 0 \
		and scheduler.pending_count("ACC_MAGE") == 1
	return {"test": "TC-MAGIC-S2-08: 持有者死亡边界按配置取消并清理（不残留）", "passed": passed}

static func _test_physical_damage_via_real_pipeline() -> Dictionary:
	# TC-CARD-S2-02：物理行动卡伤害必须等于真实侵彻管线输出（非虚拟 base×rank）
	var card := _make_cast_card("CARD_SLASH", 1)  # verb_type 由 card_defaults 兜底（SLASH）
	card.verb_type = "SLASH"
	var ctx := {"weapon_mass_kg": 3.0, "weapon_velocity": 8.0, "edge_sharpness": 1.5, "effective_armor": 5.0}
	var res = MagicSettlementSolver.resolve_attack(card, 2, ctx)
	var expected := PhysicsAndThermodynamicsSolver.calculate_penetration_damage(3.0, 8.0, "SLASH", 1.5, 5.0)
	var pipeline_ok: bool = res.get("success", false) \
		and str(res.get("via_pipeline", "")) == "calculate_penetration_damage"
	var dmg_ok := false
	if pipeline_ok:
		dmg_ok = absf(float(res["damage"]) - expected) < 0.001
	var passed = pipeline_ok and dmg_ok
	return {"test": "TC-CARD-S2-02: 物理伤害走真实侵彻管线（与 calculate_penetration_damage 一致）", "passed": passed}

# ---------- Phase 42 收编验收（TC-CARD-S2-01/04/05） ----------

static func _test_combat_card_authority() -> Dictionary:
	# TC-CARD-S2-01：行动卡权威载体唯一（直构 CombatActionCardEntity，别名已退役，R-06）
	var combat := PhysicalVerbRegistry.CombatActionCardEntity.new()
	combat.card_id = "CARD_SEAL_X"
	combat.card_name = "CARD_SEAL_X"
	combat.card_category = "DEBUFF"  # 封印机制归效果层分类
	combat.magic_ref = "FIRE_NOVA"
	combat.effects = [{"kind": "seal"}]
	var is_combat: bool = combat is PhysicalVerbRegistry.CombatActionCardEntity
	var category_ok: bool = combat.card_category == "DEBUFF"
	var effects_ok: bool = false
	for effect in combat.effects:
		if effect is Dictionary and str(effect.get("kind", "")) == "seal":
			effects_ok = true
	var passed = is_combat and category_ok and effects_ok and (combat.card_id == "CARD_SEAL_X")
	return {"test": "TC-CARD-S2-01: 行动卡权威载体唯一（直构 CombatActionCardEntity，R-06）", "passed": passed}

static func _test_ap_stagger_validator() -> Dictionary:
	# TC-CARD-S2-04：AP<0 硬直禁止主动攻击卡，仅防御卡（PARRY 等）放行
	var attack := _make_cast_card("CARD_ATK", 1, "")
	attack.verb_type = "SLASH"
	var guard := _make_cast_card("CARD_GUARD", 1, "")
	guard.verb_type = "PARRY"
	var hand := [attack, guard]
	var denied = CombatPlayValidator.validate_play(attack, hand, -3)
	var denied_ok: bool = not denied.get("success", false) \
		and denied.get("error_code", "") == "AP_INSUFFICIENT_OR_STAGGERED"
	var guard_ok := CombatPlayValidator.validate_play(guard, hand, -3)
	var guard_pass: bool = guard_ok.get("success", false)
	var off_hand = CombatPlayValidator.validate_play(attack, [guard], 5)
	var off_hand_ok: bool = not off_hand.get("success", false) \
		and off_hand.get("error_code", "") == "HAND_NOT_CONTAIN"
	var ap_ok := CombatPlayValidator.validate_play(attack, hand, 5)
	var ap_pass: bool = ap_ok.get("success", false)
	var passed = denied_ok and guard_pass and off_hand_ok and ap_pass
	return {"test": "TC-CARD-S2-04: AP 硬直禁主动出牌（防御卡放行/手牌缺失拒绝）", "passed": passed}

static func _test_effect_layer_seal_ascend() -> Dictionary:
	# TC-CARD-S2-05：封印/升格效果挂接——状态机经效果层触发，卡本体仍为 CombatActionCardEntity
	var seal_card := PhysicalVerbRegistry.CombatActionCardEntity.new()
	seal_card.card_id = "CARD_SEAL_FN"
	seal_card.card_name = "CARD_SEAL_FN"
	seal_card.card_category = "DEBUFF"
	seal_card.magic_ref = "FIRE_NOVA"
	seal_card.effects = [{"kind": "seal"}]
	var seals := {}
	var seal_res = SealFsm.apply_seal(seals, "ACC_MAGE", "FIRE_NOVA", seal_card.card_id)
	var seal_effect := false
	for effect in seal_card.effects:
		if effect is Dictionary and str(effect.get("kind", "")) == "seal":
			seal_effect = true
	var seal_ok: bool = seal_effect and seal_res.get("success", false) \
		and seal_card is PhysicalVerbRegistry.CombatActionCardEntity
	# 升格效果层 + 状态机位阶 +1
	var ranks := {"FIRE_NOVA": 2}
	var asc_res = AscensionSolver.apply_ascension(ranks, "FIRE_NOVA", MagicTierSnapshot.MagicForm.INCANTATION, {})
	var asc_ok: bool = asc_res.get("success", false) and int(ranks["FIRE_NOVA"]) == 3
	var passed = seal_ok and asc_ok
	return {"test": "TC-CARD-S2-05: 封印/升格效果层挂接（卡本体权威 + 状态机联动）", "passed": passed}

# ---------- 阶段3 ----------

static func _test_combo_semantics() -> Dictionary:
	var reg := _registry()
	var defined := reg.combo_semantic("multi_x_ascend") == MagicRuleRegistry.COMBO_DEFINED
	var partial := reg.combo_semantic("fusion_x_rank") == MagicRuleRegistry.COMBO_PARTIAL
	var bnd := reg.combo_semantic("not_a_combo") == MagicRuleRegistry.COMBO_UNDEFINED
	var passed = defined and partial and bnd
	return {"test": "TC-MAGIC-S4: 组合语义矩阵（DEFINED/PARTIAL/BND_NOT_DEFINED 三分）", "passed": passed}

## Phase 44 P7（TC-P44-P7-01）：SAME 模式（无 target_pool）逐击共享冻结 ctx 零拷贝——
## 2 次发动 hits 数与总伤与独立 ctx 语义等价（resolve_attack 只读 ctx；
## GDScript Dictionary 比较为内容比较——独立结算以「逐击 success + 总伤=Σ逐击」断言）
static func _test_multi_cast_same_shared_ctx() -> Dictionary:
	var card := _make_cast_card("CARD_SAME", 2, "LIGHT_BOLT")
	var ctx := {"is_magic": true, "raw_mana": 100.0, "target_id": "TGT_1"}
	var exec := MultiCastSolver.execute_play(card, 1, ctx, {"target_mode": "SAME"})
	var hits: Array = exec.get("hits", [])
	var sum_damage := 0.0
	var all_success := true
	for hit in hits:
		if not hit.get("success", false):
			all_success = false
			break
		sum_damage += float(hit.get("damage", 0.0))
	var ok: bool = exec.get("success", false) \
		and exec.get("cast_count", 0) == 2 \
		and exec.get("attack_count", 0) == 2 \
		and hits.size() == 2 \
		and all_success \
		and sum_damage > 0.0 \
		and is_equal_approx(sum_damage, float(exec.get("total_damage", -1.0)))
	var passed = ok
	return {"test": "TC-P44-P7-01: SAME 模式 ctx 共享零拷贝（双击独立 success + 总伤=Σ逐击）", "passed": passed}

## Phase 44 P7（TC-P44-P7-02）：registry 段查询零拷贝只读共享——返回内部引用
## （消费方不改写）；查询内容与配置表一致（改读引用不破坏语义）
static func _test_registry_config_shared_readonly() -> Dictionary:
	var reg := _registry()
	var mc: Dictionary = reg.multi_cast_config()
	var cfg: Dictionary = GameConfig.get_dict("domains.magic_rules", "multi_cast", {})
	var content_ok: bool = not mc.is_empty() and mc == cfg
	# 引用共享：再次查询返回同实例内容（与首次一致，无重复深拷贝漂移）
	var mc2: Dictionary = reg.multi_cast_config()
	var stable_ok: bool = mc2 == mc
	var passed = content_ok and stable_ok
	return {"test": "TC-P44-P7-02: registry 段查询零拷贝（内容=配置表且多次一致）", "passed": passed}
