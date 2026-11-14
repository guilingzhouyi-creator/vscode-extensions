# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_version_service.gd
# 架构定位: Domain Boundary Interface / Version Handshake Service Contract
# 依赖与触发: 上游: AppBootstrap, ServiceContainer | 下游: MockVersionService
# 职责说明: 规范客户端版本握手与热更新兼容性检测接口，对齐版本灰度分群体系。
# 退出语义与设计依据: 启动阶段版本兼容性校验解耦契约
# ==============================================================================

## IVersionService：客户端版本握手与灰度检测边界服务抽象接口
class_name IVersionService
extends RefCounted

## 异步检查客户端版本与灰度分群状态
func check_version_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IVersionService.check_version_async: pure virtual method must be implemented by subclass")
