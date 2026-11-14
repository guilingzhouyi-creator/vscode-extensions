# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_chat_command_service.gd
# 架构定位: Domain Boundary Mock / Simulated Chat Command Service
# 依赖与触发: 上游: MockServiceContainer, 聊天输入视图 | 下游: ChatCommandSession
# 职责说明: 命令补全会话模拟工厂；将命令索引与 Tab 手势状态封装于独立 ChatCommandSession 实例。
# 退出语义与设计依据: 跨视图命令补全状态隔离契约
# ==============================================================================

## MockChatCommandService：聊天命令补全模拟服务工厂
class_name MockChatCommandService
extends IChatCommandService

## 创建一个隔离的聊天命令补全与手势判定会话实例
func create_session() -> IChatCommandSession:
	return ChatCommandSession.new()
