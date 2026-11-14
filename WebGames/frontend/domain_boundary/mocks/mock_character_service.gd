# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_character_service.gd
# 架构定位: Domain Boundary Mock / Simulated Character Service
# 依赖与触发: 上游: MockServiceContainer, 创角与角色养成视图 | 下游: IAuthService, MockBaseService
# 职责说明: 提供角色养成与创角模拟服务，封装负重、装备词缀聚合、潜能加点与命途预览。
# 退出语义与设计依据: 无后端联机环境创角流程隔离与确定性预览契约
# ==============================================================================

## MockCharacterService：角色养成与权威创角模拟服务
class_name MockCharacterService
extends ICharacterService

const IAuthService = preload("res://frontend/domain_boundary/interfaces/i_auth_service.gd")

## 模拟异步创建角色并返回组装后的角色槽位摘要
func create_character_async(account_id: String, token: String, request_payload: Dictionary, result_callback: Callable) -> void:
	var character_name := str(request_payload.get("name", "MockHero"))
	var created_character := {
		"slot_id": str(request_payload.get("slot_id", "SLOT_01")),
		"name": character_name,
		"race": str(request_payload.get("race", "MOCK_RACE")),
		"class": "Novice",
		"level": 1,
		"empty": false
	}
	if result_callback.is_valid():
		result_callback.call({"success": true, "character": created_character})

## 模拟异步触发六维预览属性骰点
func roll_attributes_async(result_callback: Callable) -> void:
	if result_callback.is_valid():
		result_callback.call(IAuthService.build_preview_attribute_spread())

## 模拟异步返回创角命途轮盘预览快照
func roll_destiny_preview_async(_account_id: String, _token: String, _request_payload: Dictionary, result_callback: Callable) -> void:
	MockBaseService.delayed_call(result_callback, {
		"success": true,
		"data": {
			"race_id": "MOCK_RACE",
			"origin_id": "MOCK_ORIGIN",
			"attributes": {"STR": 4, "CON": 3, "INT": 4, "AGI": 3, "SPR": 3, "VIT": 4}
		}
	}, MockBaseService.DEFAULT_SIMULATE_DELAY_MS)

## 模拟异步拉取创角界面只读配置快照
func get_creation_ui_snapshot_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	MockBaseService.delayed_call(result_callback, {
		"success": true,
		"data": {"creation_ui_snapshot": {"available_origins": [], "available_trait_pairs": []}}
	}, MockBaseService.DEFAULT_SIMULATE_DELAY_MS)
