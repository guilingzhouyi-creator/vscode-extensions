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

func _init(delay_milliseconds: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_milliseconds

## 模拟异步拉取角色 HUD 状态快照副本
func get_hud_snapshot_async(_character_id: String, result_callback: Callable) -> void:
	var hud_snapshot_payload := MockDataCatalog.get_domain_data("hud_snapshot")
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"snapshot": hud_snapshot_payload.duplicate(true)
		},
		simulate_delay_ms
	)

## 模拟异步获取世界地图地标列表副本
func get_map_landmarks_async(result_callback: Callable) -> void:
	var map_payload := MockDataCatalog.get_domain_data("world_map")
	var landmarks: Array = map_payload.get("landmarks", [])
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"landmarks": landmarks.duplicate(true)
		},
		simulate_delay_ms
	)

## 模拟异步进入世界网关并列出可用世界列表
func enter_gateway_async(account_id: String, _token: String, result_callback: Callable) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"account_id": account_id,
			"worlds": []
		},
		simulate_delay_ms
	)

## 模拟异步探测运行模式就绪度报告
func probe_modes_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"probe_reports": {}
		},
		simulate_delay_ms
	)

## 模拟异步拉取账号下历史世界档案列表
func list_worlds_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"worlds": []
		},
		simulate_delay_ms
	)

## 模拟异步选择运行模式并绑定账号槽位上下文
func select_mode_async(
	_account_id: String,
	_token: String,
	mode_id: int,
	_account_slots: Array,
	result_callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"mode_id": mode_id
		},
		simulate_delay_ms
	)

## 模拟异步选中既有世界档案或创建新世界档案
func select_or_create_world_async(
	_account_id: String,
	_token: String,
	world_id: String,
	mode_id: int,
	result_callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		result_callback,
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
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
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
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
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
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"data": {"enabled_pack_ids": []}
		},
		simulate_delay_ms
	)

## 模拟异步查询联机界域只读列表
func list_remote_realms_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	MockBaseService.delayed_call(
		result_callback,
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
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
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
	_account_id: String,
	_token: String,
	target_mode: int,
	result_callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{
			"success": true,
			"target_mode": target_mode
		},
		simulate_delay_ms
	)

## 模拟异步退出当前世界并返回世界网关
func exit_world_to_gateway_async(
	_account_id: String,
	_token: String,
	result_callback: Callable,
	_options: Dictionary = {}
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true},
		simulate_delay_ms
	)

## 模拟异步发现已安装 MOD 包列表
func list_installed_mods_async(
	_account_id: String,
	_token: String,
	_custom_roots: Array,
	result_callback: Callable
) -> void:
	var mock_packs: Array = [
		{
			"pack_id": "mock_sandbox_base",
			"display_name": "Sandbox Base Pack",
			"version": "1.0.0",
			"pack_profile": "TOTAL_CONVERSION",
			"is_official": false,
			"has_prologue_dag": true,
			"content_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
			"dependencies": []
		}
	]
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"installed_packs": mock_packs, "selected_pack_ids": ["mock_sandbox_base"]}},
		simulate_delay_ms
	)

## 模拟异步设置当前选定的 MOD 包列表
func set_mod_selection_async(
	_account_id: String,
	_token: String,
	selected_pack_ids: Array,
	result_callback: Callable,
	_custom_roots: Array = []
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"selected_pack_ids": selected_pack_ids.duplicate()}},
		simulate_delay_ms
	)

## 模拟异步执行 MOD 栈预检
func precheck_mod_stack_async(
	_account_id: String,
	_token: String,
	enabled_pack_ids: Array,
	result_callback: Callable,
	_custom_roots: Array = []
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"enabled_pack_ids": enabled_pack_ids.duplicate(), "has_base_content_mod": not enabled_pack_ids.is_empty()}},
		simulate_delay_ms
	)

## 模拟异步创建合规 MOD 目录骨架
func create_mod_pack_async(
	_account_id: String,
	_token: String,
	pack_spec: Dictionary,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"pack_id": String(pack_spec.get("pack_id", "mock_pack")), "created": true}},
		simulate_delay_ms
	)

## 模拟异步将 MOD 目录打包为 .kmod 归档包
func pack_mod_kmod_async(
	_account_id: String,
	_token: String,
	_source_directory: String,
	output_path: String,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"output_path": output_path, "packed": true}},
		simulate_delay_ms
	)

## 模拟异步将 .kmod 或 MOD 目录安装至本地模组目录
func install_mod_pack_async(
	_account_id: String,
	_token: String,
	source_path: String,
	target_root: String,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"source_path": source_path, "target_root": target_root, "installed": true}},
		simulate_delay_ms
	)

## 模拟异步删除本地非内置 MOD 包
func delete_mod_pack_async(
	_account_id: String,
	_token: String,
	delete_spec: Dictionary,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"pack_id": str(delete_spec.get("pack_id", "")), "deleted": true}},
		simulate_delay_ms
	)

## 模拟异步更新本地 MOD 清单与 DAG 数据
func update_mod_manifest_async(
	_account_id: String,
	_token: String,
	update_spec: Dictionary,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"pack_id": str(update_spec.get("pack_id", "")), "updated": true}},
		simulate_delay_ms
	)

## 模拟异步查询世界存档 MOD 只读诊断
func get_world_mod_diagnostics_async(
	_account_id: String,
	_token: String,
	world_id: String,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"world_id": world_id, "status": "MATCHED", "locked_mods": [], "missing_mods": [], "digest_mismatches": []}},
		simulate_delay_ms
	)

## 模拟异步校验联机界域 MOD 清单摘要
func verify_realm_manifest_async(
	_account_id: String,
	_token: String,
	realm_mod_manifest: Array,
	result_callback: Callable
) -> void:
	MockBaseService.delayed_call(
		result_callback,
		{"success": true, "data": {"verified": true, "manifest_count": realm_mod_manifest.size()}},
		simulate_delay_ms
	)
