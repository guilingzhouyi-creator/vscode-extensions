# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_description_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 基于已注册物品（ItemRegistryCatalog）及其状态生成/组织描述——只读消费 注册系统，不反向定义物品核心属性、不绕过注册系统建立独立物品身份。 Phase 24：文本生成收敛至统一文案核心 CopywritingResolver（模板/条件段/ {param} 填充/未填充拦截/键登记一处实现）；本类保留域红线（UNREGISTERED_ITEM 身份校验 + 已注册字段参数注入白名单）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemDescriptionResolver
extends RefCounted

# ==============================================================================
# 一、描述解析入口
# ==============================================================================

## 描述解析：基于已注册物品 + 状态 → 统一文案核心生成描述
## 唯一身份入口：canonical_id 必须存在于 ItemRegistryCatalog（禁独立身份空间）
static func resolve(
	catalog: ItemRegistryCatalog,
	canonical_id: String,
	state: Dictionary = {},
	locale_override: String = ""
) -> Dictionary:
	var proto: ItemRegistryCatalog.ItemPrototypeTemplate = catalog.get_prototype(str(canonical_id))
	if proto == null:
		return {"success": false, "code": "UNREGISTERED_ITEM", "canonical_id": canonical_id}

	# 参数注入：仅取 proto 已注册字段（白名单）+ state 运行时状态；禁新属性定义
	var params := _build_params(proto, state)

	# 文本生成：统一文案核心（Phase 24）——copy_key 用 english_name（canonical_id
	# 含冒号不符合三段式键规范）；conditions 条件段拼接 + {param} 填充 + 未填充
	# 拦截 + 描述键登记（跨域唯一）均在共享核心一处实现。
	return CopywritingResolver.resolve(
		"item." + proto.english_name + ".desc", params, "", locale_override)

# ==============================================================================
# 二、参数注入（白名单）
# ==============================================================================

## 参数注入：仅取 proto 已注册字段（白名单）+ state 运行时状态；禁新属性定义
static func _build_params(proto: ItemRegistryCatalog.ItemPrototypeTemplate, state: Dictionary) -> Dictionary:
	var params: Dictionary = {
		"name": str(proto.english_name),
		"tier_rank": proto.tier_rank,
		"mass_kg": proto.default_mass_kg,
		"volume_slots": proto.default_volume_slots,
		"market_value": proto.base_market_value,
	}
	for k in state.keys():
		params[k] = state[k]
	return params
