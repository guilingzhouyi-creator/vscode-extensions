# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/magic_tier_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 加载 config/domains/magic_tiers.json 唯一事实源，启动校验多项硬性 不变量（阶位梯度 11 阶单调 / 能力分级区间自洽可重叠 / 资质阈值递增 / 实力称号 13 级单调 / 魔术非魔法边界），为技能/装备/角色/敌人提供 统一魔法基线查询（双维度：阶位梯度 × 能力分级）
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicTierRegistry
extends RefCounted

# ==============================================================================
# 一、配置表与索引状态
# ==============================================================================

const CONFIG_TABLE: String = "domains.magic_tiers"

var _ranks: Dictionary = {}            # rank(int) -> {name_key, strength_weight, ...}（阶位梯度）
var _tiers: Dictionary = {}            # tier(int) -> {name_key, reference_interval, weight, ...}（能力分级）
var _bands: Dictionary = {}            # band(int) -> {name_key, interval, ...}（阶位档次）
var _aptitudes: Dictionary = {}        # aptitude(int) -> {name_key, backfire_threshold, mana_gate, rarity}
var _forms: Dictionary = {}            # form(int) -> {name_key, phase_loss_min, phase_loss_max}
var _profession_ranks: Dictionary = {} # rank(int) -> {name_key, magic_domain}
var _rank_tier_index: Dictionary = {}  # rank(1~11) -> Array[int]（能力分级候选——装配期构建，O(1) 查询）
var _rank_band_index: Dictionary = {}  # rank(1~11) -> int（阶位档次——装配期构建，O(1) 查询）
var _ready: bool = false

# ==============================================================================
# 二、配置加载与索引装配
# ==============================================================================

## 重载全量魔法基线配置（阶位/能力分级/档次/资质/形态/称号），校验不变量后装配索引并登记名称键
func reload_configuration() -> void:
	# 严格类型化取值器 + 安全兜底（禁 Variant get_value）
	var ranks_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "rank_gradient", {})
	var tiers_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "ability_tiers", {})
	var bands_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "rank_bands", {})
	var aptitudes_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "mana_aptitudes", {})
	var forms_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "magic_forms", {})
	var professions_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "profession_ranks", {})
	_ranks.clear()
	for key in ranks_cfg:
		var entry: Dictionary = ranks_cfg[key]
		_ranks[int(entry.get("rank", 0))] = entry
	_tiers.clear()
	for key in tiers_cfg:
		var entry: Dictionary = tiers_cfg[key]
		_tiers[int(entry.get("tier", 0))] = entry
	_bands.clear()
	for key in bands_cfg:
		var entry: Dictionary = bands_cfg[key]
		_bands[int(entry.get("band", 0))] = entry
	_aptitudes.clear()
	for key in aptitudes_cfg:
		var entry: Dictionary = aptitudes_cfg[key]
		_aptitudes[int(entry.get("aptitude", 0))] = entry
	_forms.clear()
	for key in forms_cfg:
		var entry: Dictionary = forms_cfg[key]
		_forms[int(entry.get("form", 0))] = entry
	_profession_ranks.clear()
	for key in professions_cfg:
		var entry: Dictionary = professions_cfg[key]
		_profession_ranks[int(entry.get("rank", 0))] = entry
	_ready = _validate_invariants()
	if _ready:
		_build_rank_indexes()
		_register_name_keys()

## Phase 33 性能优化：装配期构建 rank 反查索引（能力分级候选 / 阶位档次）——
## 运行时解析器 O(1) 查询，不再每次读配置遍历（细则 S1 性能项）
func _build_rank_indexes() -> void:
	_rank_tier_index.clear()
	_rank_band_index.clear()
	for rank in range(1, 12):
		var candidates: Array = []
		for tier in _tiers:
			var entry: Dictionary = _tiers[tier]
			var interval: Array = entry.get("reference_interval", [])
			if interval.size() >= 2 and rank >= int(interval[0]) and rank <= int(interval[1]):
				candidates.append(int(entry.get("tier", 0)))
		candidates.sort()
		_rank_tier_index[rank] = candidates
		var band := 0
		for b in _bands:
			var b_entry: Dictionary = _bands[b]
			var b_interval: Array = b_entry.get("interval", [])
			if b_interval.size() >= 2 and rank >= int(b_interval[0]) and rank <= int(b_interval[1]):
				band = int(b_entry.get("band", 0))
				break
		_rank_band_index[rank] = band

## 注册表是否就绪（不变量全通过且名称键登记无跨域冲突）
func is_ready() -> bool:
	return _ready

## 不变量校验（全部失败即注册表不可用）：
## 1) 阶位梯度 rank 1~11 严格连续递增（禁跨级倒置/断裂）；
## 2) 能力分级 tier 1~5（四等+超位）独立存在，参考区间自洽（1~11 内且 lo<=hi，**允许重叠**）；
## 3) 资质四档反噬阈值严格递增（1/3/6/9 语义保持）；
## 4) 实力称号 13 级 rank 1~13 严格连续，且 magic_domain 单调（魔术师档仅限低端，不得穿插）。
func _validate_invariants() -> bool:
	if not _validate_dimension_counts():
		return false
	if not _validate_ranks_continuity():
		return false
	if not _validate_tiers_intervals():
		return false
	if not _validate_bands_coverage():
		return false
	if not _validate_aptitudes_monotonicity():
		return false
	if not _validate_profession_ranks():
		return false
	return _validate_forms_loss()

func _validate_dimension_counts() -> bool:
	return _ranks.size() == 11 and _tiers.size() == 5 and _profession_ranks.size() == 13 and _forms.size() == 4

func _validate_ranks_continuity() -> bool:
	var rank_levels: Array[int] = []
	for rank in _ranks:
		rank_levels.append(int(_ranks[rank].get("level", 0)))
	rank_levels.sort()
	for i in range(rank_levels.size()):
		if rank_levels[i] != i + 1:
			return false
	return true

func _validate_tiers_intervals() -> bool:
	for tier in _tiers:
		var entry: Dictionary = _tiers[tier]
		var interval: Array = entry.get("reference_interval", [])
		if interval.size() < 2:
			return false
		var lo: int = int(interval[0])
		var hi: int = int(interval[1])
		if lo < 1 or hi > 11 or lo > hi:
			return false
	return true

func _validate_bands_coverage() -> bool:
	if _bands.size() != 4:
		return false
	var band_intervals: Array = []
	for band in _bands:
		var entry: Dictionary = _bands[band]
		var interval: Array = entry.get("interval", [])
		if interval.size() < 2:
			return false
		var blo: int = int(interval[0])
		var bhi: int = int(interval[1])
		if blo < 1 or bhi > 11 or blo > bhi:
			return false
		band_intervals.append([blo, bhi])
	band_intervals.sort()
	var cursor := 1
	for iv in band_intervals:
		if int(iv[0]) > cursor:
			return false
		cursor = max(cursor, int(iv[1]) + 1)
	return cursor == 12

func _validate_aptitudes_monotonicity() -> bool:
	var thresholds: Array[int] = []
	for a in _aptitudes:
		thresholds.append(int(_aptitudes[a].get("backfire_threshold", 0)))
	thresholds.sort()
	for i in range(thresholds.size() - 1):
		if thresholds[i] >= thresholds[i + 1]:
			return false
	return true

func _validate_profession_ranks() -> bool:
	var seen_magic_domain := false
	for i in range(1, 14):
		var entry: Dictionary = _profession_ranks.get(i, {})
		if entry.is_empty():
			return false
		var is_magic: bool = bool(entry.get("magic_domain", false))
		if is_magic:
			seen_magic_domain = true
		elif seen_magic_domain:
			return false
	return true

func _validate_forms_loss() -> bool:
	for form in _forms:
		var f_entry: Dictionary = _forms[form]
		var f_lo: float = float(f_entry.get("phase_loss_min", 0.0))
		var f_hi: float = float(f_entry.get("phase_loss_max", 0.0))
		if not is_finite(f_lo) or not is_finite(f_hi) or f_lo > f_hi:
			return false
	return true

# ==============================================================================
# 三、基线查询接口
# ==============================================================================

## 按阶位取基线（未登记返回空字典）
func get_rank_baseline(rank: int) -> Dictionary:
	return _ranks.get(rank, {})

## 按能力分级取基线（未登记返回空字典）
func get_tier_baseline(tier: int) -> Dictionary:
	return _tiers.get(tier, {})

## 按阶位档次取基线（未登记返回空字典）
func get_band_baseline(band: int) -> Dictionary:
	return _bands.get(band, {})

## Phase 33：rank 反查能力分级候选（装配期索引 O(1)——供解析器注入查询）
func query_tier_candidates(rank: int) -> Array:
	return _rank_tier_index.get(rank, [])

## Phase 33：rank 反查阶位档次（装配期索引 O(1)——供解析器注入查询；越界返回 0）
func query_band(rank: int) -> int:
	return int(_rank_band_index.get(rank, 0))

## 按资质档取基线（未登记返回空字典）
func get_aptitude_baseline(aptitude: int) -> Dictionary:
	return _aptitudes.get(aptitude, {})

## 按魔法形态取基线（未登记返回空字典）
func get_form_baseline(form: int) -> Dictionary:
	return _forms.get(form, {})

## 按实力称号 rank 取基线（未登记返回空字典）
func get_profession_rank_baseline(rank: int) -> Dictionary:
	return _profession_ranks.get(rank, {})

## 修炼门槛判定：是否具备魔法修炼必要体质（魔适者 mana_gate=true）
func is_mana_gate_passed(aptitude: int) -> bool:
	return bool(get_aptitude_baseline(aptitude).get("mana_gate", false))

# ==============================================================================
# 四、名称键登记与全量导出
# ==============================================================================

## Phase 19 统一名称注册表接线：魔法 name_key 全量登记（域所有者 = magic）。
## 英文兜底 = 键本体（英文即机器可读名）；跨域冲突 → 注册表拒绝就绪并告警。
func _register_name_keys() -> void:
	var shared := LocalizationRegistryCatalog.get_shared()
	var collisions: Array = []
	for entry in _ranks.values():
		_register_one(shared, entry, collisions)
	for entry in _tiers.values():
		_register_one(shared, entry, collisions)
	for entry in _bands.values():
		_register_one(shared, entry, collisions)
	for entry in _aptitudes.values():
		_register_one(shared, entry, collisions)
	for entry in _forms.values():
		_register_one(shared, entry, collisions)
	for entry in _profession_ranks.values():
		_register_one(shared, entry, collisions)
	if not collisions.is_empty():
		_ready = false
		push_warning("MagicTierRegistry: 名称键跨域冲突 %s" % JSON.stringify(collisions))

## 单条目名称键登记（域所有者 magic，英文兜底键本体；跨域冲突入列）
func _register_one(shared: LocalizationRegistryCatalog, entry: Dictionary, collisions: Array) -> void:
	var key: String = str(entry.get("name_key", ""))
	if key.is_empty():
		return
	# 英文底座优先取词典文件值（config/i18n/en_US.json），未登记时兜底键本体
	var en_name: String = str(shared._locale_dictionaries.get("en_US", {}).get(key, key))
	var res := shared.register_name_key(key, "magic", en_name)
	if not res.success:
		collisions.append(res)

## 全量基线导出（供遥测/统计/审计只读引用）
func export_baselines() -> Dictionary:
	return {
		"ranks": _ranks.duplicate(true),
		"tiers": _tiers.duplicate(true),
		"bands": _bands.duplicate(true),
		"aptitudes": _aptitudes.duplicate(true),
		"forms": _forms.duplicate(true),
		"profession_ranks": _profession_ranks.duplicate(true),
		"ready": _ready,
	}
