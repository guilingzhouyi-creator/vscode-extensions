# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/mode_readiness_probe.gd
# 架构定位: Domain Probe / Environment Validator
# 依赖与触发: 上游: WorldGatewayFSM, GameBootstrap | 下游: CanaryRolloutSolver, GameModeRoutingSolver | 配置: config/domains/world_gateway/core.json | 信号: 无
# 职责说明: 提供单机与联机运行模式环境就绪态探测，执行存储可写性诊断、灰度白名单校验与防越权阻断。
# 退出语义与设计依据: 业务域第一性原理 / 模式就绪探测与防越权隔离拓扑规范
# ==============================================================================

## ModeReadinessProbe：Domain Probe / Environment Validator
class_name ModeReadinessProbe
extends RefCounted

const DOMAIN_WORLD_GATEWAY_CONFIG: String = "domains.world_gateway"
const DEFAULT_SP_ROOT_DIR: String = "user://worlds/sp/"
const DEFAULT_SIMULATED_PING_MS: int = 24

## 探测单机模式环境：校验本地存储目录可写性、配额可用性与基础内容 MOD 就绪态
static func probe_single_player_environment() -> ModeReadinessReportDTO:
	var report := ModeReadinessReportDTO.new()
	report.mode = WorldGatewayModel.GameMode.SINGLE_PLAYER
	var has_base_content := _has_installed_base_content_mod()

	var should_check_disk: bool = GameConfig.get_bool(DOMAIN_WORLD_GATEWAY_CONFIG, "probe_policy/sp_disk_check", true)
	if not should_check_disk:
		report.is_ready = true
		report.status_code = "READY"
		report.message = "Single-player storage environment ready (media check skipped)"
		report.latency_ms = 0
		report.capabilities = ["local_storage", "offline_continuity", "base_content_mod_ready" if has_base_content else "base_content_mod_missing"]
		return report

	var root_directory: String = GameConfig.get_string(DOMAIN_WORLD_GATEWAY_CONFIG, "local_archive/root_dir", DEFAULT_SP_ROOT_DIR)
	if not root_directory.ends_with("/"):
		root_directory += "/"

	var mkdir_error := DirAccess.make_dir_recursive_absolute(root_directory)
	if mkdir_error != OK and mkdir_error != ERR_ALREADY_EXISTS:
		report.is_ready = false
		report.status_code = "DIR_UNWRITABLE"
		report.message = TemplateFormatter.format("Failed to create local archive directory: {dir}", {"dir": root_directory})
		report.latency_ms = 0
		report.capabilities = []
		return report

	var test_probe_path := root_directory + ".probe_write_test.tmp"
	var file_handle := FileAccess.open(test_probe_path, FileAccess.WRITE)
	if file_handle == null:
		report.is_ready = false
		report.status_code = "DIR_UNWRITABLE"
		report.message = TemplateFormatter.format("Local archive directory not writable or insufficient permissions: {dir}", {"dir": root_directory})
		report.latency_ms = 0
		report.capabilities = []
		return report

	file_handle.store_string("probe_ok")
	file_handle.flush()
	file_handle.close()
	DirAccess.remove_absolute(test_probe_path)

	report.is_ready = true
	report.status_code = "READY"
	report.message = "Single-player storage environment ready"
	report.latency_ms = 0
	report.capabilities = ["local_storage", "offline_continuity", "base_content_mod_ready" if has_base_content else "base_content_mod_missing"]
	return report


static func _has_installed_base_content_mod() -> bool:
	var scan_result := ModPackageDiscoverySolver.scan_installed_packs_with_diagnostics()
	var packages: Variant = scan_result.get("packages", [])
	if packages is Array:
		for package_entry in (packages as Array):
			if package_entry is NarrativePackManifestDTO:
				var manifest_dto := package_entry as NarrativePackManifestDTO
				if manifest_dto.pack_profile in ["OFFICIAL_BASE", "TOTAL_CONVERSION"]:
					return true
	return false

## 探测联机模式环境：校验服务器维护态与当前账号灰度放行资格
static func probe_multiplayer_environment(account_id: String) -> ModeReadinessReportDTO:
	var report := ModeReadinessReportDTO.new()
	report.mode = WorldGatewayModel.GameMode.MULTIPLAYER
	var ping_milliseconds: int = GameConfig.get_int(DOMAIN_WORLD_GATEWAY_CONFIG, "probe_policy/mp_simulated_ping_ms", DEFAULT_SIMULATED_PING_MS)
	report.latency_ms = ping_milliseconds

	var is_maintenance: bool = GameConfig.get_bool(DOMAIN_WORLD_GATEWAY_CONFIG, "probe_policy/maintenance_mode", false)
	if is_maintenance:
		report.is_ready = false
		report.status_code = "MAINTENANCE"
		report.message = "Multiplayer server is currently under maintenance"
		report.capabilities = []
		return report

	if account_id.is_empty():
		report.is_ready = false
		report.status_code = "FEATURE_DISABLED"
		report.message = "Account unauthenticated or empty, multiplayer mode access denied"
		report.capabilities = []
		return report

	var flags: Dictionary = GameModeRoutingSolver.load_default_canary_flags()
	var multiplayer_feature: Variant = flags.get("FEATURE_MULTIPLAYER_GATEWAY", null)
	var is_enabled: bool = false
	if multiplayer_feature != null and CanaryRolloutSolver != null:
		is_enabled = CanaryRolloutSolver.is_feature_enabled_for_account(multiplayer_feature, account_id)

	if not is_enabled:
		report.is_ready = false
		report.status_code = "FEATURE_DISABLED"
		report.message = "Multiplayer mode is currently under maintenance and not available for this account"
		report.capabilities = []
		return report

	report.is_ready = true
	report.status_code = "READY"
	report.message = "Multiplayer gateway environment ready"
	report.capabilities = ["remote_realm", "multiplayer_sync"]
	return report

## 全域模式并行综合探测
static func probe_all_modes(account_id: String) -> Dictionary:
	return {
		"single_player": probe_single_player_environment(),
		"multiplayer": probe_multiplayer_environment(account_id)
	}
