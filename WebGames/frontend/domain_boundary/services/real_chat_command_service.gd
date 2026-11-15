# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_chat_command_service.gd
# 架构定位: Domain Boundary Adapter / Real Chat Command Service
# 依赖与触发: 上游: MainHUDView, ServiceContainer, ServiceLocator | 下游: RealChatCommandSession
# 职责说明: 实现 IChatCommandService 接口，为每个控制台/聊天面板签发独立命令会话实例。
# 退出语义与设计依据: 跨视图命令状态隔离与后端索引求解契约
# ==============================================================================

## RealChatCommandService：签发直连后端命令索引会话的真实聊天命令服务
class_name RealChatCommandService
extends "res://frontend/domain_boundary/interfaces/i_chat_command_service.gd"

const RealChatCommandSession = preload("res://frontend/domain_boundary/services/real_chat_command_session.gd")

## 为调用方视图创建独立的命令补全与手势会话
func create_session() -> IChatCommandSession:
	var created_session: IChatCommandSession = RealChatCommandSession.new()
	if created_session == null:
		EventBusCore.get_instance().emit_log(
			"error",
			"RealChatCommandService.create_session: session instantiation returned null"
		)
		return null
	created_session.reset_cursor()
	created_session.reset_gesture()
	return created_session
