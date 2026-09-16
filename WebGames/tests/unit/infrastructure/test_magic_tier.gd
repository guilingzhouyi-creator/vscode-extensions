# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 魔法双维度体系单元测试
# 文件路径: res://tests/unit/infrastructure/test_magic_tier.gd
# 覆盖: Phase 26 施工细则 阶段1~4（TC-MD-01~06）
#       —— 阶位纯梯度 / 能力分级独立 / 弱映射非 1:1 / 越级容忍 / 参考标签 /
#          消费方零回归（Phase 18 语义保持：mana_gate/强度兜底/四维解析）
# ==============================================================================
class_name TestMagicTierDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 26: 魔法双维度体系（阶位梯度 × 能力分级）"

	results.append(_test_rank_gradient_pure())
	results.append(_test_ability_tier_independent())
	results.append(_test_weak_mapping_non_1to1())
	results.append(_test_tier_break_allowed())
	results.append(_test_reference_label())
	results.append(_test_consumer_zero_regression())
	results.append(_test_band_enum_independent())
	results.append(_test_band_deterministic())
	results.append(_test_band_out_of_range())
	results.append(_test_band_name_key())
	results.append(_test_band_consumer_integration())
	results.append(_test_three_dimensions_zero_regression())
	# Phase 33：运行时门禁验收（TC-M3——装配/数量/索引/字段分离/非法值显式错误）
	results.append(_test_registry_assembled_ready())
	results.append(_test_rank_to_level_invalid_explicit())
	results.append(_test_index_consistency())
	results.append(_test_band_index_consistency())
	results.append(_test_candidates_field_separated())
	results.append(_test_assembly_idempotent())

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

## TC-MD-01: 阶位纯梯度（MagicRank RANK_1~11 连续、无能力分级前缀；rank_to_level 严格递增）
static func _test_rank_gradient_pure() -> Dictionary:
	var ranks_ok: bool = MagicTierSnapshot.MagicRank.size() == 11 \
		and MagicTierSnapshot.MagicRank.RANK_1 == 1 \
		and MagicTierSnapshot.MagicRank.RANK_11 == 11
	var monotonic_ok: bool = MagicTierSnapshot.rank_to_level(MagicTierSnapshot.MagicRank.RANK_1) == 1 \
		and MagicTierSnapshot.rank_to_level(MagicTierSnapshot.MagicRank.RANK_4) == 4 \
		and MagicTierSnapshot.rank_to_level(MagicTierSnapshot.MagicRank.RANK_7) == 7 \
		and MagicTierSnapshot.rank_to_level(MagicTierSnapshot.MagicRank.RANK_10) == 10 \
		and MagicTierSnapshot.rank_to_level(MagicTierSnapshot.MagicRank.RANK_11) == 11
	var gradient_cfg: Dictionary = GameConfig.get_dict("domains.magic_tiers", "rank_gradient", {})
	var keys_pure := true
	var cfg_levels: Array[int] = []
	for key in gradient_cfg:
		if not str(key).begins_with("rank_") or _contains_cjk(str(key)):
			keys_pure = false
		cfg_levels.append(int(gradient_cfg[key].get("level", 0)))
	cfg_levels.sort()
	var consecutive := true
	for i in range(cfg_levels.size()):
		if cfg_levels[i] != i + 1:
			consecutive = false
			break
	var passed = ranks_ok and monotonic_ok and keys_pure and consecutive and gradient_cfg.size() == 11
	return {
		"test": "TC-MD-01: 阶位纯梯度（RANK_1~11 连续无能力前缀 + rank_to_level 严格递增）",
		"passed": passed
	}

## TC-MD-02: 能力分级独立（AbilityTier 四等+超位独立定义，不嵌入阶位名）
static func _test_ability_tier_independent() -> Dictionary:
	var tiers_ok: bool = MagicTierSnapshot.AbilityTier.size() == 5 \
		and MagicTierSnapshot.AbilityTier.ESP == 1 \
		and MagicTierSnapshot.AbilityTier.SUPERTIER == 5
	var tiers_cfg: Dictionary = GameConfig.get_dict("domains.magic_tiers", "ability_tiers", {})
	var has_five := tiers_cfg.size() == 5
	var interval_ok := true
	for key in tiers_cfg:
		var entry: Dictionary = tiers_cfg[key]
		var interval: Array = entry.get("reference_interval", [])
		if interval.size() != 2:
			interval_ok = false
			break
		var lo: int = int(interval[0])
		var hi: int = int(interval[1])
		if lo < 1 or hi > 11 or lo > hi:
			interval_ok = false
	var passed = tiers_ok and has_five and interval_ok
	return {
		"test": "TC-MD-02: 能力分级独立（异能/英雄/神圣/真神+超位独立定义，区间自洽可重叠）",
		"passed": passed
	}

## 测试用 MagicTierRegistry 装配（R-05：registry 必填后统一经此装配）
static func _make_tier_registry() -> MagicTierRegistry:
	var registry := MagicTierRegistry.new()
	registry.reload_configuration()
	return registry

## TC-MD-03: 弱映射非 1:1（区间查询命中候选集合；3 阶重叠；无逐阶固定映射表）
static func _test_weak_mapping_non_1to1() -> Dictionary:
	var registry := _make_tier_registry()
	var cand_3: Array = MagicAbilityTierResolver.infer_tier_candidates(3, registry)
	var cand_5: Array = MagicAbilityTierResolver.infer_tier_candidates(5, registry)
	var overlap_ok: bool = cand_3 == [1, 2]          # 3 阶 ∈ 异能∩英雄（重叠样例）
	var heroic_ok: bool = cand_5 == [2]              # 5 阶 → 通常概括为英雄级
	var out_of_range: Array = MagicAbilityTierResolver.infer_tier_candidates(99, registry)
	var passed = overlap_ok and heroic_ok and out_of_range.is_empty()
	return {
		"test": "TC-MD-03: 弱映射非 1:1（区间查询：3 阶→[异能,英雄] 重叠；5 阶→[英雄]）",
		"passed": passed
	}

## TC-MD-04: 越级容忍（SUPERTIER allow_break；其余能力分级默认不突破）
static func _test_tier_break_allowed() -> Dictionary:
	var super_break: bool = MagicAbilityTierResolver.is_tier_break_allowed(5, "")
	var god_no_break: bool = not MagicAbilityTierResolver.is_tier_break_allowed(4, "")
	var passed = super_break and god_no_break
	return {
		"test": "TC-MD-04: 越级容忍（超位 allow_break=true；真神默认不突破，系统不强制）",
		"passed": passed
	}

## TC-MD-05: 参考标签（经验性称呼键本体，仅展示不作判定）
static func _test_reference_label() -> Dictionary:
	var label: String = MagicAbilityTierResolver.tier_reference_label(2)
	var passed = label == "magic.ability_tier.heroic_ref"
	return {
		"test": "TC-MD-05: 参考标签（英雄级参考标签键本体，展示用非判定）",
		"passed": passed
	}

## TC-MD-06: 消费方零回归（registry 双体系不变量就绪 + baseline 解析 + 强度兜底 + mana_gate）
static func _test_consumer_zero_regression() -> Dictionary:
	var registry := MagicTierRegistry.new()
	registry.reload_configuration()
	var ready_ok: bool = registry.is_ready()
	var tier_bl: Dictionary = registry.get_tier_baseline(2)
	var tier_ok: bool = tier_bl.get("name_key", "") == "magic.ability_tier.heroic"
	var resolver := MagicBaselineResolver.new(registry)
	var result := resolver.resolve(
		MagicTierSnapshot.MagicForm.INCANTATION,
		MagicTierSnapshot.MagicRank.RANK_5,
		MagicTierSnapshot.ManaAptitude.WORD_SPEAKER,
		MagicTierSnapshot.ProfessionRank.SENIOR_MAGE)
	var resolve_ok: bool = result.get("success", false) and bool(result.get("magic_domain", false))
	var fallback: float = resolver.get_strength_weight(99)
	var fallback_ok: bool = is_equal_approx(fallback, 1.0)
	var gate_ok: bool = registry.is_mana_gate_passed(MagicTierSnapshot.ManaAptitude.MANA_ADAPTOR)
	var passed = ready_ok and tier_ok and resolve_ok and fallback_ok and gate_ok
	return {
		"test": "TC-MD-06: 消费方零回归（双体系不变量就绪/基线解析/强度兜底 1.0/mana_gate 保持）",
		"passed": passed
	}

## TC-RB-01: 档次枚举独立（MagicRankBand LOW/MID/HIGH/SUPERTIER 独立定义，不嵌入阶位名）
static func _test_band_enum_independent() -> Dictionary:
	var bands_ok: bool = MagicTierSnapshot.MagicRankBand.size() == 4 \
		and MagicTierSnapshot.MagicRankBand.LOW == 1 \
		and MagicTierSnapshot.MagicRankBand.SUPERTIER == 4
	var passed = bands_ok
	return {
		"test": "TC-RB-01: 档次枚举独立（LOW/MID/HIGH/SUPERTIER，不嵌入阶位名）",
		"passed": passed
	}

## TC-RB-02: 确定性判定（rank_to_band 区间分段：每阶恰属一档）
static func _test_band_deterministic() -> Dictionary:
	var registry := _make_tier_registry()
	var passed = MagicRankBandResolver.rank_to_band(1, registry) == MagicTierSnapshot.MagicRankBand.LOW \
		and MagicRankBandResolver.rank_to_band(3, registry) == MagicTierSnapshot.MagicRankBand.LOW \
		and MagicRankBandResolver.rank_to_band(4, registry) == MagicTierSnapshot.MagicRankBand.MID \
		and MagicRankBandResolver.rank_to_band(6, registry) == MagicTierSnapshot.MagicRankBand.MID \
		and MagicRankBandResolver.rank_to_band(7, registry) == MagicTierSnapshot.MagicRankBand.HIGH \
		and MagicRankBandResolver.rank_to_band(9, registry) == MagicTierSnapshot.MagicRankBand.HIGH \
		and MagicRankBandResolver.rank_to_band(10, registry) == MagicTierSnapshot.MagicRankBand.SUPERTIER \
		and MagicRankBandResolver.rank_to_band(11, registry) == MagicTierSnapshot.MagicRankBand.SUPERTIER
	return {
		"test": "TC-RB-02: 确定性判定（1/3→低阶、4/6→中阶、7/9→高阶、10/11→超位）",
		"passed": passed
	}

## TC-RB-03: 越界拦截（未登记阶位返回 0，不抛 Fatal）
static func _test_band_out_of_range() -> Dictionary:
	var registry := _make_tier_registry()
	var passed = MagicRankBandResolver.rank_to_band(0, registry) == 0 \
		and MagicRankBandResolver.rank_to_band(12, registry) == 0 \
		and MagicRankBandResolver.rank_to_band(99, registry) == 0
	return {
		"test": "TC-RB-03: 越界拦截（0/12/99 → 0，UNREGISTERED_BAND 语义）",
		"passed": passed
	}

## TC-RB-04: 名键查询（magic.rank_band.*，展示用非判定）
static func _test_band_name_key() -> Dictionary:
	var key: String = MagicRankBandResolver.band_name_key(MagicTierSnapshot.MagicRankBand.MID)
	var passed = key == "magic.rank_band.mid"
	return {
		"test": "TC-RB-04: 名键查询（中阶 → magic.rank_band.mid）",
		"passed": passed
	}

## TC-RB-05: 消费方接入（registry 档次互斥全覆盖不变量就绪 + get_band_baseline + resolve rank_band）
static func _test_band_consumer_integration() -> Dictionary:
	var registry := MagicTierRegistry.new()
	registry.reload_configuration()
	var ready_ok: bool = registry.is_ready()
	var band_bl: Dictionary = registry.get_band_baseline(2)
	var band_ok: bool = band_bl.get("name_key", "") == "magic.rank_band.mid"
	var resolver := MagicBaselineResolver.new(registry)
	var result := resolver.resolve(
		MagicTierSnapshot.MagicForm.INCANTATION,
		MagicTierSnapshot.MagicRank.RANK_5,
		MagicTierSnapshot.ManaAptitude.WORD_SPEAKER,
		MagicTierSnapshot.ProfessionRank.SENIOR_MAGE)
	var resolve_ok: bool = int(result.get("rank_band", -1)) == MagicTierSnapshot.MagicRankBand.MID
	var passed = ready_ok and band_ok and resolve_ok
	return {
		"test": "TC-RB-05: 消费方接入（互斥全覆盖不变量就绪/get_band_baseline/resolve 含 rank_band）",
		"passed": passed
	}

## TC-RB-06: 三维度零回归（档次为纯增量维度，不参与强度权重；双维度行为保持）
static func _test_three_dimensions_zero_regression() -> Dictionary:
	var registry := MagicTierRegistry.new()
	registry.reload_configuration()
	var resolver := MagicBaselineResolver.new(registry)
	var r5 := resolver.resolve(
		MagicTierSnapshot.MagicForm.INCANTATION,
		MagicTierSnapshot.MagicRank.RANK_5,
		MagicTierSnapshot.ManaAptitude.WORD_SPEAKER,
		MagicTierSnapshot.ProfessionRank.SENIOR_MAGE)
	var strength_ok: bool = is_equal_approx(float(r5.get("strength_weight", 0.0)), 2.4)
	var tier_candidates: Array = r5.get("ability_tier", [])
	var tier_ok: bool = tier_candidates == [2]   # 5 阶 → 英雄级（弱映射保持）
	var band_ok: bool = int(r5.get("rank_band", -1)) == MagicTierSnapshot.MagicRankBand.MID
	var passed = r5.get("success", false) and strength_ok and tier_ok and band_ok
	return {
		"test": "TC-RB-06: 三维度零回归（强度 2.4 保持/弱映射英雄级保持/档次中阶并存）",
		"passed": passed
	}

## 中文（CJK）检测辅助：含 \u4e00-\u9fff 区间即判定含中文
static func _contains_cjk(text: String) -> bool:
	for i in text.length():
		var code: int = text.unicode_at(i)
		if code >= 0x4E00 and code <= 0x9FFF:
			return true
	return false

## TC-M3-01: 装配就绪（GameBootstrap 唯一装配——六类数量/区间校验通过 is_ready）
static func _test_registry_assembled_ready() -> Dictionary:
	var registry := GameBootstrap.magic_registry()
	var passed = registry != null and registry.is_ready()
	return { "test": "TC-M3-01: 装配期 registry 就绪（六类数量/区间校验通过）", "passed": passed }

## TC-M3-02: rank_to_level 非法值显式错误（0 哨兵——不静默伪装一阶）
static func _test_rank_to_level_invalid_explicit() -> Dictionary:
	var invalid: int = MagicTierSnapshot.rank_to_level(99)
	var valid: int = MagicTierSnapshot.rank_to_level(MagicTierSnapshot.MagicRank.RANK_7)
	var passed = invalid == 0 and valid == 7
	return { "test": "TC-M3-02: rank_to_level 非法值显式错误（0 哨兵，合法 7 保持）", "passed": passed }

## TC-M3-03: rank 反查索引与弱映射解析一致性（装配期索引，R-05）
static func _test_index_consistency() -> Dictionary:
	var registry := _make_tier_registry()
	var idx: Array = registry.query_tier_candidates(5)
	var old: Array = MagicAbilityTierResolver.infer_tier_candidates(5, registry)
	var passed = idx == old and idx == [2]
	return { "test": "TC-M3-03: 索引查询与弱映射解析一致（5 阶→[2] 英雄级，R-05）", "passed": passed }

## TC-M3-04: 档次索引确定性（装配期反查——2→LOW/5→MID）
static func _test_band_index_consistency() -> Dictionary:
	var registry := MagicTierRegistry.new()
	registry.reload_configuration()
	var b2: int = registry.query_band(2)
	var b5: int = registry.query_band(5)
	var passed = b2 == MagicTierSnapshot.MagicRankBand.LOW and b5 == MagicTierSnapshot.MagicRankBand.MID
	return { "test": "TC-M3-04: 档次索引确定性（2→LOW / 5→MID）", "passed": passed }

## TC-M3-05: ability_tier 标量与候选集合字段分离（禁止隐式类型转换）
static func _test_candidates_field_separated() -> Dictionary:
	var snap := MagicTierSnapshot.new()
	snap.ability_tier = MagicTierSnapshot.AbilityTier.HEROIC
	snap.ability_tier_candidates = [1, 2]
	var passed = snap.ability_tier == MagicTierSnapshot.AbilityTier.HEROIC \
		and snap.ability_tier_candidates == [1, 2]
	return { "test": "TC-M3-05: ability_tier 标量与候选集合字段分离", "passed": passed }

## TC-M3-06: 装配幂等（registry 唯一——重复装配零开销）
static func _test_assembly_idempotent() -> Dictionary:
	var r1 := GameBootstrap.assemble()
	var r2 := GameBootstrap.assemble()
	var passed = r1.get("success", false) and r2.get("already_assembled", false) \
		and GameBootstrap.magic_registry() != null
	return { "test": "TC-M3-06: 装配幂等（registry 唯一 + 重复装配零开销）", "passed": passed }
