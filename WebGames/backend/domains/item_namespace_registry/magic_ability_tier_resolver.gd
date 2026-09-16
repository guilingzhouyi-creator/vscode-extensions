# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/magic_ability_tier_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 能力分级（异能/英雄/神圣/真神 + 超位）与阶位梯度（1~11）之间的 **弱映射关联**——仅经参考区间/权重/参考标签/越级容忍表达经验性关系， **严禁 Tier↔Rank 一对一枚举映射作为核心判定逻辑**；允许区间重叠与越级。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicAbilityTierResolver
extends RefCounted

# ==============================================================================
# 一、配置表与弱映射推断
# ==============================================================================

const CONFIG_TABLE: String = "domains.magic_tiers"

## 经验性弱映射：从阶位推断能力分级候选集合（命中参考区间 → 候选；允许重叠；
## 区间查询，非逐阶固定映射表；空/越界阶位返回空集合）。
## Phase 33 性能：registry 必填（O(1) 反查索引唯一路径；旧读配置遍历分支已退役）。
static func infer_tier_candidates(rank: int, registry: MagicTierRegistry) -> Array:
	return registry.query_tier_candidates(rank)

## 越级容忍：特殊个体/特殊魔法/装备/环境/状态可突破通常区间（allow_break 或
## allow_break_types 白名单）；系统不强制，仅查询判定
static func is_tier_break_allowed(tier: int, break_type: String = "") -> bool:
	var tiers: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "ability_tiers", {})
	for key in tiers:
		var entry: Dictionary = tiers[key]
		if int(entry.get("tier", 0)) != tier:
			continue
		if bool(entry.get("allow_break", false)):
			return true
		var allowed_types: Array = entry.get("allow_break_types", [])
		if not break_type.is_empty() and allowed_types.has(break_type):
			return true
		return false
	return false

## 参考标签（经验性称呼，如 5 阶 → 通常被概括为英雄级）：返回配置的 i18n 键本体，
## 仅展示不作判定（显示层经名称注册表/i18n 解析）
static func tier_reference_label(tier: int) -> String:
	var tiers: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "ability_tiers", {})
	for key in tiers:
		var entry: Dictionary = tiers[key]
		if int(entry.get("tier", 0)) == tier:
			return str(entry.get("reference_label", ""))
	return ""
