# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/world_recombination_stub.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 为「多次游玩/角色死亡/重开 → 多世界连续性」预留扩展位置： - 配置开关 world_continuity/enabled 关闭时仅返回官方默认世界（限制多独立世界）； - 开启时按「默认模板 + 历史世界可重组状态片段」生成 RECOMBINED_STUB， 不落地完整重组实现（防过度设计）；不污染现有 WorldInstance 模型。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name WorldRecombinationStub extends RefCounted

const MODE_DEFAULT_ONLY: String = "DEFAULT_ONLY"
const MODE_RECOMBINED_STUB: String = "RECOMBINED_STUB"

## 生成新世界：config.enabled 可覆盖配置开关（可测试性）；关闭 → 默认模板；开启 → 组合历史片段
## 边界：default_template 为空回退配置表；world_id 按片段数派生（防多世界 id 冲突，确定性）
static func generate_new_world(default_template: Dictionary, history_worlds: Array[Dictionary], config: Dictionary = {}) -> Dictionary:
	var enabled: bool = bool(config.get("enabled", GameConfig.get_bool("domains.world", "continuity/enabled", false)))
	var template: Dictionary = _resolve_template(default_template)
	if not enabled:
		return {"success": true, "world": template.duplicate(), "mode": MODE_DEFAULT_ONLY}
	var fragments: Array = []
	for w in history_worlds:
		if not w is Dictionary:
			continue
		fragments.append_array(w.get("history_fragments", []))
	var composed: Dictionary = template.duplicate()
	composed["recombined_fragments_count"] = fragments.size()
	composed["sources"] = ["default", "history"]
	composed["world_id"] = String(template.get("world_id", "WORLD_DEFAULT")) + "_GEN_F" + str(fragments.size())
	return {"success": true, "world": composed, "mode": MODE_RECOMBINED_STUB, "fragments_count": fragments.size()}

## 多世界连续性开关（配置驱动，关闭时限制账号建立多独立世界存档）
static func continuity_enabled() -> bool:
	return GameConfig.get_bool("domains.world", "continuity/enabled", false)

## 模板回退：空模板 → 官方默认世界模板（配置驱动）
static func _resolve_template(default_template: Dictionary) -> Dictionary:
	if not default_template.is_empty():
		return default_template
	return GameConfig.get_dict("domains.world", "default_template", {"world_id": "WORLD_DEFAULT"})