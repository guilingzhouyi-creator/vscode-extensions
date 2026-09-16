# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/magic_rank_band_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 阶位档次（第三平行维度：低阶 1~3 / 中阶 4~6 / 高阶 7~9 / 超位 10~11 统称）的 **确定性判定**——按 rank_bands 配置段区间分段（每阶恰属一档、互斥全覆盖）， 非逐阶枚举表；档次名经 magic.rank_band.* 键表达（禁嵌套命名，仅展示不作判定）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicRankBandResolver
extends RefCounted

# ==============================================================================
# 一、配置表与档次判定
# ==============================================================================

const CONFIG_TABLE: String = "domains.magic_tiers"

## 确定性档次判定：rank -> band（区间分段，非逐阶枚举表）；越界/未配置返回 0（UNREGISTERED_BAND）。
## Phase 33 性能：registry 必填（O(1) 反查索引唯一路径；旧读配置遍历分支已退役）。
static func rank_to_band(rank: int, registry: MagicTierRegistry) -> int:
	return registry.query_band(rank)

## 档次名键查询（magic.rank_band.*；仅展示不作判定）
static func band_name_key(band: int) -> String:
	var bands: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "rank_bands", {})
	for key in bands:
		var entry: Dictionary = bands[key]
		if int(entry.get("band", 0)) == band:
			return str(entry.get("name_key", ""))
	return ""
