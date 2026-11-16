# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_version_service.gd
# 架构定位: Domain Boundary Adapter / Version Handshake Service Bridge
# 依赖与触发: 上游: AppBootstrap, ServiceContainer, ServiceLocator | 下游: VersionActivationGate, GameConfig
# 职责说明: 实现 IVersionService 接口，读取版本清单并调用 VersionActivationGate 校验启动准入状态。
# 退出语义与设计依据: 启动阶段版本兼容性校验与领域边界解耦契约
# ==============================================================================

## RealVersionService：基于版本清单配置与激活门禁的真实版本握手服务
class_name RealVersionService
extends "res://frontend/domain_boundary/interfaces/i_version_service.gd"

## 异步检查客户端版本与发布通道状态
func check_version_async(result_callback: Callable) -> void:
	var manifest_releases: Dictionary = GameConfig.get_dict("infrastructure.version_manifest", "releases", {})
	var installed_version: String = str(ProjectSettings.get_setting("application/config/version", "1.0.0")).strip_edges()
	if installed_version.is_empty():
		installed_version = "1.0.0"
	var release_entry: Dictionary = manifest_releases.get(installed_version, {}) if manifest_releases.has(installed_version) else {}
	var version_code: int = int(release_entry.get("version_code", 10000))
	var latest_version: String = installed_version
	var max_code: int = version_code
	for release_key in manifest_releases.keys():
		var candidate_entry: Variant = manifest_releases[release_key]
		if candidate_entry is Dictionary:
			var candidate_code: int = int((candidate_entry as Dictionary).get("version_code", 0))
			if candidate_code > max_code:
				max_code = candidate_code
				latest_version = str(release_key)
	var gate_verdict: Dictionary = VersionActivationGate.evaluate_startup_eligibility(installed_version, null)
	var is_compatible: bool = bool(gate_verdict.get("allowed", true))
	var release_channel: String = str(release_entry.get("patch_type", "FULL_RELEASE"))
	if not result_callback.is_valid():
		return
	result_callback.call({
		"success": is_compatible,
		"compatible": is_compatible,
		"version": installed_version,
		"client_version": installed_version,
		"latest_version": latest_version,
		"update_required": latest_version != installed_version and max_code > version_code,
		"version_code": version_code,
		"channel": release_channel,
		"reason": str(gate_verdict.get("reason", "")),
	})
