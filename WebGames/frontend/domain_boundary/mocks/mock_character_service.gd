# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟角色养成服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_character_service.gd
# 职责: 负重求和、装备词缀聚合与潜能加点守卫（视图只消费结果）
# ==============================================================================
class_name MockCharacterService
extends ICharacterService

const IAuthService = preload("res://frontend/domain_boundary/interfaces/i_auth_service.gd")

func create_character_async(account_id: String, token: String, req_data: Dictionary, callback: Callable) -> void:
	var char_name := str(req_data.get("name", "MockHero"))
	var new_char := {
		"slot_id": str(req_data.get("slot_id", "SLOT_01")),
		"name": char_name,
		"race": str(req_data.get("race", "HUMAN")),
		"class": "Novice",
		"level": 1,
		"empty": false
	}
	if callback.is_valid():
		callback.call({"success": true, "character": new_char})

func roll_attributes_async(callback: Callable) -> void:
	if callback.is_valid():
		callback.call(IAuthService.build_preview_attribute_spread())
