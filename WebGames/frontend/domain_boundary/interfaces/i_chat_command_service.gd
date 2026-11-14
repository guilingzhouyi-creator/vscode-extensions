# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_chat_command_service.gd
# 架构定位: Domain Boundary Interface / Chat Command Service Contract
# 依赖与触发: 上游: 聊天与控制台视图, ServiceContainer | 下游: MockChatCommandService, 命令行求解器
# 职责说明: 规范聊天 GM 命令索引与独立会话创建接口，隔离底层命令行求解器实现。
# 退出语义与设计依据: 跨视图会话状态隔离与领域边界服务解耦契约
# ==============================================================================

## IChatCommandService：聊天指令补全服务抽象接口
class_name IChatCommandService
extends RefCounted

## 创建独立会话（每个视图实例持有自己的索引/手势状态，避免跨视图串扰）
func create_session() -> IChatCommandSession:
	EventBusCore.get_instance().emit_log("error", "IChatCommandService.create_session: pure virtual method must be implemented by subclass")
	return null
