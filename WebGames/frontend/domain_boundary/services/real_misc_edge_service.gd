# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_misc_edge_service.gd
# 架构定位: Domain Boundary Adapter / Real Misc Edge Service Bridge
# 依赖与触发: 上游: MiscEdgeView, ServiceContainer, ServiceLocator | 下游: GameConfig
# 职责说明: 实现 IMiscEdgeService 接口，基于精英突变上限、地面拾取索引与命名费率配置裁决边缘交互。
# 退出语义与设计依据: 表现层零杂项规则判断与配置唯一真源契约
# ==============================================================================

## RealMiscEdgeService：依据配置裁决突变槽位、地面掉落拾取与命名手续费的真实服务
class_name RealMiscEdgeService
extends "res://frontend/domain_boundary/interfaces/i_misc_edge_service.gd"

func _extract_mutation_key(mutation_entry: Dictionary) -> String:
	var explicit_id: String = str(mutation_entry.get("mutation_id", mutation_entry.get("id", ""))).strip_edges()
	if not explicit_id.is_empty():
		return explicit_id
	return str(mutation_entry.get("name", ""))

func _has_active_mutation(active_mutations: Array, target_key: String) -> bool:
	for existing_entry in active_mutations:
		if existing_entry is Dictionary and _extract_mutation_key(existing_entry) == target_key:
			return true
	return false

## 激活指定精英突变词条（执行去重与槽位容量上限拦截）
func activate_mutation(active_mutations: Array, mutation_entry: Dictionary, max_slots: int) -> Dictionary:
	var slot_limit: int = maxi(1, max_slots)
	if active_mutations.size() >= slot_limit:
		return {"success": false, "mutations": active_mutations.duplicate(true), "reason": "MUTATION_SLOTS_FULL"}
	var target_key: String = _extract_mutation_key(mutation_entry)
	if _has_active_mutation(active_mutations, target_key):
		return {"success": false, "mutations": active_mutations.duplicate(true), "reason": "MUTATION_ALREADY_ACTIVE"}
	var updated_mutations: Array = active_mutations.duplicate(true)
	updated_mutations.append(mutation_entry.duplicate(true))
	return {"success": true, "mutations": updated_mutations, "reason": ""}

## 替换当前激活列表末位的突变词条
func replace_last_mutation(active_mutations: Array, mutation_entry: Dictionary) -> Dictionary:
	if active_mutations.is_empty():
		return {"success": false, "mutations": [], "reason": "NO_ACTIVE_MUTATIONS"}
	var updated_mutations: Array = active_mutations.duplicate(true)
	updated_mutations[updated_mutations.size() - 1] = mutation_entry.duplicate(true)
	return {"success": true, "mutations": updated_mutations, "reason": ""}

## 校验地面掉落索引并执行无副作用列表移除
func pickup_loot(loot_entries: Array, loot_index: int) -> Dictionary:
	if loot_index < 0 or loot_index >= loot_entries.size():
		return {"success": false, "loot": loot_entries.duplicate(true), "item": {}, "reason": "INVALID_LOOT_INDEX"}
	var remaining_loot: Array = loot_entries.duplicate(true)
	var picked_entry: Variant = remaining_loot[loot_index]
	remaining_loot.remove_at(loot_index)
	return {"success": true, "loot": remaining_loot, "item": picked_entry, "reason": ""}

## 读取命名类型对应的注册手续费
func get_name_type_fee(type_index: int) -> int:
	var configured_fees: Array = GameConfig.get_array("domains.identity_disguise", "registry_fees", [100, 500, 2000])
	if type_index >= 0 and type_index < configured_fees.size():
		return maxi(0, int(configured_fees[type_index]))
	return maxi(0, int(configured_fees[0])) if not configured_fees.is_empty() else 100

## 分发核名、更名、伪装、拾取与突变协议动作至后端域处理器
func dispatch_misc_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return RealProtocolBridge.dispatch_flat("misc_edge", action_type, payload_data)
