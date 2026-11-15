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

const VersionActivationGate = preload("res://backend/domains/version_governance/version_activation_gate.gd")

## 异步检查客户端版本与发布通道状态
func check_version_async(result_callback: Callable) -> void:
	var installed_version: String = GameConfig.get_string("infrastructure.version_manifest", "version", "1.0.0")
	var version_code: int = GameConfig.get_int("infrastructure.version_manifest", "version_code", 10000)
	var release_channel: String = GameConfig.get_string("infrastructure.version_manifest", "release_channel", "stable")
	var gate_verdict: Dictionary = VersionActivationGate.evaluate_startup_eligibility(installed_version, null)
	if not result_callback.is_valid():
		return
	result_callback.call({
		"success": bool(gate_verdict.get("allowed", true)),
		"version": installed_version,
		"version_code": version_code,
		"channel": release_channel,
		"reason": str(gate_verdict.get("reason", "")),
	})
