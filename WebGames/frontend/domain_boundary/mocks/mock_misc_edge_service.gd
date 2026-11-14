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
func activate_mutation(active: Array, item: Dictionary, max_slots: int) -> Dictionary:
	if active.size() >= max_slots:
		return {"success": false, "reason": "SLOTS_FULL", "mutations": active.duplicate(true)}
	var target_id: String = str(item.get("id", ""))
	var already_active: bool = false
	for existing in active:
		if str(existing.get("id", "")) == target_id:
			already_active = true
			break
	if already_active:
		return {"success": false, "reason": "ALREADY_ACTIVE", "mutations": active.duplicate(true)}
	var updated: Array = active.duplicate(true)
	updated.append(item.duplicate(true))
	return {"success": true, "mutations": updated}

## 弹出末尾已激活突变并替换为新突变，返回更新后的列表副本
func replace_last_mutation(active: Array, item: Dictionary) -> Dictionary:
	if active.is_empty():
		return {"success": false, "reason": "NO_ACTIVE_MUTATION", "mutations": active.duplicate(true)}
	var updated: Array = active.duplicate(true)
	updated.pop_back()
	updated.append(item.duplicate(true))
	return {"success": true, "mutations": updated}

## 按索引拾取地面掉落物品并从掉落列表副本中移除
func pickup_loot(loot: Array, index: int) -> Dictionary:
	if index < 0 or index >= loot.size():
		return {"success": false, "reason": "INVALID_INDEX", "loot": loot.duplicate(true)}
	var updated: Array = loot.duplicate(true)
	var item: Dictionary = updated[index]
	updated.remove_at(index)
	return {"success": true, "loot": updated, "item": item}

## 根据命名类型索引返回对应更名费用，索引越界时安全回退至默认首档费用
func get_name_type_fee(type_index: int) -> int:
	if type_index < 0 or type_index >= NAME_TYPE_FEES.size():
		return NAME_TYPE_FEES[0]
	return NAME_TYPE_FEES[type_index]
