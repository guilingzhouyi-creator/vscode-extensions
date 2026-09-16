# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 聊天命令补全服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_chat_command_service.gd
# 职责: 规范聊天 GM 命令索引与会话创建接口，隔离底层命令行求解器实现
# ==============================================================================
class_name IChatCommandService
extends RefCounted

## 创建独立会话（每个视图实例持有自己的索引/手势状态，避免跨视图串扰）
func create_session() -> IChatCommandSession:
	printerr("IChatCommandService.create_session: 纯虚函数必须由子类实现")
	return null
