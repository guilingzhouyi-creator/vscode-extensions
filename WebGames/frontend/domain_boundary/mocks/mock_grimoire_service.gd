# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_grimoire_service.gd
# 架构定位: Domain Boundary Mock / Simulated Grimoire Service
# 依赖与触发: 上游: MockServiceContainer, 魔典著书视图 | 下游: 无（纯计算模拟）
# 职责说明: 提供模拟魔典著书估价区间计算与版税汇总功能，隔离收入公式。
# 退出语义与设计依据: 表现层零收益计算契约
# ==============================================================================

## MockGrimoireService：魔典著书估价与版税结算模拟服务
class_name MockGrimoireService
extends IGrimoireService

const BASE_INCOME: int = 10000

## 按稿酬分成模式索引估算魔典著书收益区间 [min, max]
func estimate_authoring_income(royalty_mode_index: int) -> Dictionary:
	var estimate := BASE_INCOME
	match royalty_mode_index:
		1:
			estimate = int(float(BASE_INCOME) * 0.3 * 12.0)
		2:
			estimate = int(float(BASE_INCOME) * 0.5 + float(BASE_INCOME) * 0.1 * 12.0)
	return {
		"success": true,
		"min": int(float(estimate) * 0.8),
		"max": int(float(estimate) * 1.2),
	}

## 汇总已出版魔典列表的总版税收益
func sum_royalties(books: Array) -> Dictionary:
	var total_royalties := 0
	for book in books:
		total_royalties += int(book.get("income", 0))
	return {"success": true, "total": total_royalties}

## 模拟分发魔典编纂、编译与版税领取协议动作
func dispatch_grimoire_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
