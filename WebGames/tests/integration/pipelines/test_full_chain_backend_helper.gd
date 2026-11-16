# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_full_chain_backend_helper.gd
# 架构定位: Integration Test Harness Helper
# 依赖与触发: 由 TestFullChainBackendProtocolAndLifecyclePipeline 消费
# 职责说明: 提供全链路无头集成测试环境装配、沙箱目录擦除与统一请求派发辅助方法。
# 退出语义与设计依据: 全链路无头验收规约与物理资源安全回收
# ==============================================================================

## TestFullChainBackendHelper：全链路无头集成测试装配辅助类
class_name TestFullChainBackendHelper
extends RefCounted

const TEST_ACCOUNTS_PATH: String = "user://test_p127_accounts/account_registry.json"
const TEST_WORLDS_ROOT: String = "user://test_p127_worlds/"

static func setup_env() -> void:
	teardown_env()
	GameConfig.ensure_loaded()
	GameBootstrap.assemble()
	AccountRepository.get_instance().set_custom_registry_path(TEST_ACCOUNTS_PATH)
	WorldArchiveRepository.get_instance().set_custom_root_dir(TEST_WORLDS_ROOT)

static func teardown_env() -> void:
	WorldSessionRuntimeService.reset_for_tests()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()
	UnifiedProtocolDispatcher.reset_custom_handlers_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()
	PrologueCutscenePort.reset_for_tests()
	AuthService.clear_sessions()
	AccountRepository.reset_for_tests()
	WorldArchiveRepository.reset_for_tests()
	GameLifecycleManager.reset_for_test()
	GameBootstrap.teardown()
	remove_test_dir_recursive("user://test_p127_accounts")
	remove_test_dir_recursive("user://test_p127_worlds")
	for test_slot_id in ["slot_99", "slot_p127_guard_05", "slot_empty_strict", "slot_empty_force"]:
		for ext in [".kalar_save", ".bak", ".tmp", ".sav"]:
			var vault_file_path := "user://offline_vault/%s%s" % [test_slot_id, ext]
			if FileAccess.file_exists(vault_file_path):
				DirAccess.remove_absolute(vault_file_path)

static func remove_test_dir_recursive(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var dir_access := DirAccess.open(dir_path)
	if dir_access == null:
		return
	dir_access.list_dir_begin()
	var file_name := dir_access.get_next()
	while not file_name.is_empty():
		if file_name != "." and file_name != "..":
			var sub := dir_path.path_join(file_name)
			if dir_access.current_is_dir():
				remove_test_dir_recursive(sub)
			else:
				DirAccess.remove_absolute(sub)
		file_name = dir_access.get_next()
	dir_access.list_dir_end()
	DirAccess.remove_absolute(dir_path)

static func dispatch(
	domain: String,
	action_type: String,
	payload: Dictionary = {},
	token: String = "",
	account_id: String = "",
	character_id: String = ""
) -> UnifiedResponseEnvelopeDTO:
	var req := UnifiedProtocolFactory.create_human_request(domain, action_type, payload, token, account_id, character_id)
	return UnifiedProtocolDispatcher.dispatch_request(req)
