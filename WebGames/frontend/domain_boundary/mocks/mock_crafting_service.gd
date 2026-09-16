# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟制造工坊服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_crafting_service.gd
# 职责: 强化成功率线性衰减公式与上下限钳制（配置读取收敛至边界层）
# ==============================================================================
class_name MockCraftingService
extends ICraftingService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe12_crafting_workshop"

func preview_enhance_rate(target_level: int) -> Dictionary:
	var decay := GameConfig.get_float(RULES_SECTION, RULES_KEY + "/success_rate_decay_per_level", 0.05)
	var min_rate := GameConfig.get_float(RULES_SECTION, RULES_KEY + "/min_success_rate", 0.1)
	var max_rate := GameConfig.get_float(RULES_SECTION, RULES_KEY + "/max_success_rate", 1.0)
	var rate := clampf(1.0 - float(maxi(0, target_level)) * decay, min_rate, max_rate)
	return {"success": true, "rate": rate}
