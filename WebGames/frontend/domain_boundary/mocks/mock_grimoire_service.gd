# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟魔典著书服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_grimoire_service.gd
# 职责: 著书估价公式与版税汇总（视图只消费区间与合计）
# ==============================================================================
class_name MockGrimoireService
extends IGrimoireService

const BASE_INCOME: int = 10000

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

func sum_royalties(books: Array) -> Dictionary:
	var total := 0
	for book in books:
		total += int(book.get("income", 0))
	return {"success": true, "total": total}
