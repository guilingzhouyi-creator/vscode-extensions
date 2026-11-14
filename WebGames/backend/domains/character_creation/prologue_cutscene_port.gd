# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/prologue_cutscene_port.gd
# 架构定位: Domain Dependency Inversion Port / Cutscene Playback Gateway
# 依赖与触发: 上游: GameBootstrap (Outer Layer Injection), UnifiedProtocolDispatcher | 下游: 注册过场执行器
# 职责说明: 为序章与创角域提供依赖倒置过场动画抽象端口，接收基础设施层注入的 CutsceneOrchestrator
#           运行适配器，记录最近一次过场执行回执并支持测试生命周期对称清理。
# 退出语义与设计依据: 清洁架构依赖倒置守则 (ARCH-DIR-001, Inv-SYMMETRIC-TEARDOWN-4)
# ==============================================================================

## PrologueCutscenePort：角色创建/序章域面向基础设施媒体引擎的依赖倒置抽象端口
class_name PrologueCutscenePort
extends RefCounted

static var _runner: Callable = Callable()
static var _last_dispatch_receipt: Dictionary = {}

## 由基础设施装配层注入无头/主线程过场执行器适配器 (argv: (cutscene_id: String, skip: bool) -> Dictionary)
static func register_runner(runner: Callable) -> void:
	_runner = runner

## 清空已注入的过场执行器与执行回执（由 GameBootstrap.teardown 与测试重置调用）
static func reset_for_tests() -> void:
	_runner = Callable()
	_last_dispatch_receipt.clear()

## 校验是否已装配过场执行器
static func has_runner() -> bool:
	return _runner.is_valid()

## 通过抽象端口调度指定 ID 过场动画（未注入执行器时安全无副作用降级）
static func dispatch_cutscene(cutscene_id: String, skip_requested: bool = false) -> Dictionary:
	if cutscene_id.strip_edges().is_empty():
		return {"success": false, "skipped": false, "cutscene_id": "", "executed": false}
	if not _runner.is_valid():
		_last_dispatch_receipt = {
			"cutscene_id": cutscene_id,
			"skipped": skip_requested,
			"executed": false,
			"timestamp_utc": int(Time.get_unix_time_from_system())
		}
		return {"success": true, "skipped": skip_requested, "cutscene_id": cutscene_id, "executed": false}
	var call_result: Variant = _runner.call(cutscene_id, skip_requested)
	var receipt: Dictionary = (call_result as Dictionary).duplicate() if call_result is Dictionary else {}
	receipt["cutscene_id"] = cutscene_id
	receipt["skipped"] = skip_requested
	receipt["executed"] = true
	receipt["timestamp_utc"] = int(Time.get_unix_time_from_system())
	_last_dispatch_receipt = receipt
	return receipt

## 获取最近一次过场调度回执（供审计与测试验证）
static func get_last_receipt() -> Dictionary:
	return _last_dispatch_receipt.duplicate(true)
