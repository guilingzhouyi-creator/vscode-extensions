# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_world_service.gd
# 架构定位: Domain Boundary Mock / Simulated World Gateway & HUD Service
# 依赖与触发: 上游: MockServiceContainer, 世界网关与大世界视图 | 下游: MockBaseService, MockDataCatalog
# 职责说明: 模拟主页 HUD 快照、小地图地标、世界网关模式探测与世界档案建删，经 MockBaseService 模拟延迟。
# 退出语义与设计依据: 前端单向快照隔离规范与无后端联机测试隔离契约
## MockWorldService：世界网关、世界档案与主页 HUD 状态模拟服务
class_name MockWorldService
extends IWorldService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

## 模拟异步拉取角色 HUD 状态快照副本
func get_hud_snapshot_async(character_id: String, callback: Callable) -> void:
	var snapshot := MockDataCatalog.get_domain_data("hud_snapshot")
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"snapshot": snapshot.duplicate(true)
		},
		simulate_delay_ms
	)

## 模拟异步获取世界地图地标列表副本
func get_map_landmarks_async(callback: Callable) -> void:
	var map_data := MockDataCatalog.get_domain_data("world_map")
	var landmarks: Array = map_data.get("landmarks", [])
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"landmarks": landmarks.duplicate(true)
		},
		simulate_delay_ms
	)

## 模拟异步进入世界网关并列出可用世界列表
func enter_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"account_id": account_id,
			"worlds": []
		},
		simulate_delay_ms
	)

## 模拟异步探测运行模式就绪度报告
func probe_modes_async(account_id: String, token: String, callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"probe_reports": {}
		},
		simulate_delay_ms
	)

## 模拟异步拉取账号下历史世界档案列表
func list_worlds_async(account_id: String, token: String, callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"worlds": []
		},
		simulate_delay_ms
	)

## 模拟异步选择运行模式并绑定账号槽位上下文
func select_mode_async(
	account_id: String,
	token: String,
	mode_id: int,
	account_slots: Array,
	callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"mode_id": mode_id
		},
		simulate_delay_ms
	)

## 模拟异步选中既有世界档案或创建新世界档案
func select_or_create_world_async(
	account_id: String,
	token: String,
	world_id: String,
	mode_id: int,
	callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"world_id": world_id,
			"mode_id": mode_id
		},
		simulate_delay_ms
	)

## 模拟异步将已就绪角色挂载至当前世界网关会话
func attach_ready_character_async(
	_account_id: String,
	_token: String,
	character_id: String,
	callback: Callable
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"character_id": character_id}
		},
		simulate_delay_ms
	)

## 模拟异步正式进入指定世界档案
func enter_world_async(
	_account_id: String,
	_token: String,
	world_id: String,
	_allow_safe_degrade: bool,
	callback: Callable
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"world_id": world_id}
		},
		simulate_delay_ms
	)

## 模拟异步发现与预检已启用的 MOD 资源包
func discover_mods_async(
	_account_id: String,
	_token: String,
	_enabled_pack_ids: Array,
	callback: Callable
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"enabled_pack_ids": []}
		},
		simulate_delay_ms
	)

## 模拟异步查询联机界域只读列表
func list_remote_realms_async(_account_id: String, _token: String, callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"realms": []
		},
		simulate_delay_ms
	)

## 模拟异步删除指定世界档案
func delete_world_async(
	_account_id: String,
	_token: String,
	world_id: String,
	callback: Callable
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {
				"world_id": world_id,
				"deleted": true
			}
		},
		simulate_delay_ms
	)

## 模拟异步切换网关运行模式
func switch_gateway_mode_async(
	account_id: String,
	token: String,
	target_mode: int,
	callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"target_mode": target_mode
		},
		simulate_delay_ms
	)

## 模拟异步退出当前世界并返回世界网关
func exit_world_to_gateway_async(
	account_id: String,
	token: String,
	callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		callback,
		{"success": true},
		simulate_delay_ms
	)
