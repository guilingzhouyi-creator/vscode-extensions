# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟聊天命令补全服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_chat_command_service.gd
# 职责: 命令补全会话工厂；具体索引与手势实现收敛至 ChatCommandSession 会话实例
# ==============================================================================
class_name MockChatCommandService
extends IChatCommandService

func create_session() -> IChatCommandSession:
	return ChatCommandSession.new()
