# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_misc_edge_service.gd
# 架构定位: Domain Boundary Mock / Simulated Miscellaneous Gameplay Service
# 依赖与触发: 上游: MockServiceContainer, 边缘系统视图 | 下游: 无（纯规则模拟）
# 职责说明: 提供突变槽位激活、去重、末位替换、掉落拾取与命名类型计费模拟服务。
# 退出语义与设计依据: 表现层零杂项状态突变与不可变副本返回契约
# ==============================================================================

## MockMiscEdgeService：突变激活、拾取与命名计费模拟服务
class_name MockMiscEdgeService
extends IMiscEdgeService

const NAME_TYPE_FEES: Array[int] = [100, 50, 1000, 200]

## 校验槽位上限与重复状态并激活指定突变，返回更新后的突变列表副本
func activate_mutation(active_mutations: Array, mutation_entry: Dictionary, max_slots: int) -> Dictionary:
	if active_mutations.size() >= max_slots:
		return {"success": false, "error_code": "SLOTS_FULL", "mutations": active_mutations.duplicate(true)}
	var target_id: String = str(mutation_entry.get("id", ""))
	var is_already_active: bool = false
	for existing_mutation in active_mutations:
		if str(existing_mutation.get("id", "")) == target_id:
			is_already_active = true
			break
	if is_already_active:
		return {"success": false, "error_code": "ALREADY_ACTIVE", "mutations": active_mutations.duplicate(true)}
	var updated_mutations: Array = active_mutations.duplicate(true)
	updated_mutations.append(mutation_entry.duplicate(true))
	return {"success": true, "mutations": updated_mutations, "error_code": ""}

## 弹出末尾已激活突变并替换为新突变，返回更新后的列表副本
func replace_last_mutation(active_mutations: Array, mutation_entry: Dictionary) -> Dictionary:
	if active_mutations.is_empty():
		return {"success": false, "error_code": "NO_ACTIVE_MUTATION", "mutations": active_mutations.duplicate(true)}
	var updated_mutations: Array = active_mutations.duplicate(true)
	updated_mutations.pop_back()
	updated_mutations.append(mutation_entry.duplicate(true))
	return {"success": true, "mutations": updated_mutations, "error_code": ""}

## 按索引拾取地面掉落物品并从掉落列表副本中移除
func pickup_loot(loot_entries: Array, loot_index: int) -> Dictionary:
	if loot_index < 0 or loot_index >= loot_entries.size():
		return {"success": false, "error_code": "INVALID_INDEX", "loot": loot_entries.duplicate(true)}
	var updated_loot: Array = loot_entries.duplicate(true)
	var picked_entry: Dictionary = updated_loot[loot_index]
	updated_loot.remove_at(loot_index)
	return {"success": true, "loot": updated_loot, "item": picked_entry, "error_code": ""}

## 根据命名类型索引返回对应更名费用，索引越界时安全回退至默认首档费用
func get_name_type_fee(type_index: int) -> int:
	if type_index < 0 or type_index >= NAME_TYPE_FEES.size():
		return NAME_TYPE_FEES[0]
	return NAME_TYPE_FEES[type_index]

## 模拟分发核名、更名、伪装、拾取与突变协议动作
func dispatch_misc_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
