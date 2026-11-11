# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 服务容器抽象基类
# 文件路径: res://frontend/domain_boundary/service_container.gd
# 职责: 服务依赖注入容器的抽象基类。提供通用服务注册表与 16 个领域便捷访问虚方法。
#       Mock 容器（当前）与未来 Real 容器（后端接线）都应继承此类，
#       确保上层调用方面向统一契约，屏蔽底层服务实现来源。
# 设计依据: WebGames 零逻辑纪律与领域边界穿透架构
# ==============================================================================
class_name ServiceContainer
extends RefCounted

# ==============================================================================
# 一、通用服务注册表
# ==============================================================================

## 服务实例注册表: service_name -> RefCounted
var _services: Dictionary = {}

## 当前会话激活的世界网关实例引用
var _active_gateway: RefCounted = null

## 注册当前活跃的世界网关实例
func set_active_gateway(gateway: RefCounted) -> void:
	_active_gateway = gateway

## 获取当前活跃的世界网关实例
func get_active_gateway() -> RefCounted:
	return _active_gateway

## 清空当前活跃的世界网关实例
func clear_active_gateway() -> void:
	_active_gateway = null

## 注册服务实例到通用注册表
func register_service(service_name: String, instance: RefCounted) -> void:
	_services[service_name] = instance

## 按名解析服务实例；未注册时记录告警日志并返回 null
func get_service(service_name: String) -> RefCounted:
	if not _services.has(service_name):
		EventBusCore.get_instance().emit_log(
			"warn",
			TemplateFormatter.format("ServiceContainer: unregistered service {service_name}", {"service_name": service_name})
		)
		return null
	return _services[service_name]

# ==============================================================================
# 二、领域便捷访问虚方法（子类应 override 并返回具体接口实现）
# ==============================================================================

func _unimplemented(method_name: String) -> Variant:
	EventBusCore.get_instance().emit_log(
		"error",
		TemplateFormatter.format("ServiceContainer.{method}(): subclass must override", {"method": method_name})
	)
	return null

func auth() -> Variant: return _unimplemented("auth")
func world() -> Variant: return _unimplemented("world")
func combat() -> Variant: return _unimplemented("combat")
func version() -> Variant: return _unimplemented("version")
func gacha() -> Variant: return _unimplemented("gacha")
func chat_command() -> Variant: return _unimplemented("chat_command")
func crafting() -> Variant: return _unimplemented("crafting")
func grimoire() -> Variant: return _unimplemented("grimoire")
func economy() -> Variant: return _unimplemented("economy")
func character() -> Variant: return _unimplemented("character")
func quest() -> Variant: return _unimplemented("quest")
func guild() -> Variant: return _unimplemented("guild")
func save() -> Variant: return _unimplemented("save")
func misc_edge() -> Variant: return _unimplemented("misc_edge")
func mail() -> Variant: return _unimplemented("mail")
func snapshot_data() -> Variant: return _unimplemented("snapshot_data")
