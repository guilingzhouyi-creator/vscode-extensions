# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_prologue_service.gd
# 架构定位: Domain Boundary Adapter / Real Prologue Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: RealProtocolBridge
# 职责说明: 实现 IPrologueService 接口，通过统一协议调度序章启动、查询、推进与完结交接大世界。
# 退出语义与设计依据: 表现层零计算纪律与全链路契约校验
## RealPrologueService：直连后端序章调度协议的真实边界服务实现
class_name RealPrologueService
extends "res://frontend/domain_boundary/interfaces/i_prologue_service.gd"

## 异步请求启动当前角色的序章剧情上下文
func start_prologue_async(
	account_id: String,
	token: String,
	request_payload: Dictionary,
	result_callback: Callable
) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"prologue",
		"START_PROLOGUE",
		request_payload,
		account_id,
		token,
		result_callback
	)

## 异步查询当前序章所处阶段与只读状态快照
func get_prologue_state_async(account_id: String, token: String, result_callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"prologue",
		"GET_PROLOGUE_STATE",
		{},
		account_id,
		token,
		result_callback
	)

## 异步提交序章分支选择并推演下一阶段剧情节点
func advance_prologue_async(
	account_id: String,
	token: String,
	choice_id: String,
	request_payload: Dictionary,
	result_callback: Callable
) -> void:
	var step_payload := request_payload.duplicate(true)
	step_payload["choice_id"] = choice_id if not choice_id.is_empty() else "NEXT"
	RealProtocolBridge.dispatch_and_reply(
		"prologue",
		"ADVANCE_PROLOGUE",
		step_payload,
		account_id,
		token,
		result_callback
	)

## 异步完结或跳过序章剧情并触发大世界探索交接
func complete_prologue_async(
	account_id: String,
	token: String,
	cutscene_id: String = "",
	should_skip: bool = false,
	result_callback: Callable = Callable()
) -> void:
	var prologue_action := "SKIP_PROLOGUE" if should_skip else "COMPLETE_PROLOGUE"
	var done_payload := {"cutscene_id": cutscene_id} if not cutscene_id.is_empty() else {}
	RealProtocolBridge.dispatch_and_reply(
		"prologue",
		prologue_action,
		done_payload,
		account_id,
		token,
		result_callback
	)
