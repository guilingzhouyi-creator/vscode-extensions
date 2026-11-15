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
static var _hook_interceptor: Callable = Callable()
static var _last_dispatch_receipt: Dictionary = {}
static var _last_hook_receipt: Dictionary = {}

## 由基础设施装配层注入无头/主线程过场执行器适配器 (argv: (cutscene_id: String, skip: bool) -> Dictionary)
static func register_runner(runner: Callable) -> void:
	_runner = runner

## 由基础设施装配层注入剧情节点过场 Hook 匹配拦截器 (argv: (dag_id: String, node_id: String, is_pre: bool) -> Dictionary)
static func register_hook_interceptor(interceptor: Callable) -> void:
	_hook_interceptor = interceptor

## 清空已注入的过场执行器、Hook 拦截器与执行回执（由 GameBootstrap.teardown 与测试重置调用）
static func reset_for_tests() -> void:
	_runner = Callable()
	_hook_interceptor = Callable()
	_last_dispatch_receipt.clear()
	_last_hook_receipt.clear()

## 校验是否已装配过场执行器
static func has_runner() -> bool:
	return _runner.is_valid()

## 校验是否已装配剧情节点 Hook 拦截器
static func has_hook_interceptor() -> bool:
	return _hook_interceptor.is_valid()

## 由 DAG 执行引擎节点前置/后置阶段触发：委派外层 Hook 注册表匹配并自动派发过场
static func intercept_narrative_hook(dag_id: String, node_id: String, is_pre: bool) -> Dictionary:
	if not _hook_interceptor.is_valid():
		return {"matched": false, "dag_id": dag_id, "node_id": node_id, "is_pre": is_pre}
	var raw_result: Variant = _hook_interceptor.call(dag_id, node_id, is_pre)
	var receipt: Dictionary = (raw_result as Dictionary).duplicate(true) if raw_result is Dictionary else {"matched": false}
	receipt["dag_id"] = dag_id
	receipt["node_id"] = node_id
	receipt["is_pre"] = is_pre
	if bool(receipt.get("matched", false)):
		_last_hook_receipt = receipt.duplicate(true)
	return receipt

## 通过抽象端口调度指定 ID 过场动画（未注入执行器时安全无副作用降级）
static func dispatch_cutscene(cutscene_id: String, is_skip_requested: bool = false) -> Dictionary:
	if cutscene_id.strip_edges().is_empty():
		return {"success": false, "skipped": false, "cutscene_id": "", "executed": false}
	if not _runner.is_valid():
		_last_dispatch_receipt = {
			"cutscene_id": cutscene_id,
			"skipped": is_skip_requested,
			"executed": false,
			"timestamp_utc": int(Time.get_unix_time_from_system())
		}
		return {"success": true, "skipped": is_skip_requested, "cutscene_id": cutscene_id, "executed": false}
	var call_result: Variant = _runner.call(cutscene_id, is_skip_requested)
	var receipt: Dictionary = (call_result as Dictionary).duplicate() if call_result is Dictionary else {}
	receipt["cutscene_id"] = cutscene_id
	receipt["skipped"] = is_skip_requested
	receipt["executed"] = true
	receipt["timestamp_utc"] = int(Time.get_unix_time_from_system())
	_last_dispatch_receipt = receipt
	return receipt

## 获取最近一次过场调度回执（供审计与测试验证）
static func get_last_receipt() -> Dictionary:
	return _last_dispatch_receipt.duplicate(true)

## 获取最近一次 DAG Hook 自动匹配回执（供序章过场 Hook 集成断言）
static func get_last_hook_receipt() -> Dictionary:
	return _last_hook_receipt.duplicate(true)
