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

## 注册服务实例到通用注册表
func register_service(service_name: String, instance: RefCounted) -> void:
	_services[service_name] = instance

## 按名解析服务实例；未注册时打印错误并返回 null
func get_service(service_name: String) -> RefCounted:
	if not _services.has(service_name):
		printerr("[ServiceContainer] 未注册的服务: %s" % service_name)
		return null
	return _services[service_name]

# ==============================================================================
# 二、领域便捷访问虚方法（子类应 override 并返回具体接口实现）
# ==============================================================================

func auth() -> Variant:
	printerr("[ServiceContainer] auth() 未实现：子类应 override 此方法")
	return null

func world() -> Variant:
	printerr("[ServiceContainer] world() 未实现：子类应 override 此方法")
	return null

func combat() -> Variant:
	printerr("[ServiceContainer] combat() 未实现：子类应 override 此方法")
	return null

func version() -> Variant:
	printerr("[ServiceContainer] version() 未实现：子类应 override 此方法")
	return null

func gacha() -> Variant:
	printerr("[ServiceContainer] gacha() 未实现：子类应 override 此方法")
	return null

func chat_command() -> Variant:
	printerr("[ServiceContainer] chat_command() 未实现：子类应 override 此方法")
	return null

func crafting() -> Variant:
	printerr("[ServiceContainer] crafting() 未实现：子类应 override 此方法")
	return null

func grimoire() -> Variant:
	printerr("[ServiceContainer] grimoire() 未实现：子类应 override 此方法")
	return null

func economy() -> Variant:
	printerr("[ServiceContainer] economy() 未实现：子类应 override 此方法")
	return null

func character() -> Variant:
	printerr("[ServiceContainer] character() 未实现：子类应 override 此方法")
	return null

func quest() -> Variant:
	printerr("[ServiceContainer] quest() 未实现：子类应 override 此方法")
	return null

func guild() -> Variant:
	printerr("[ServiceContainer] guild() 未实现：子类应 override 此方法")
	return null

func save() -> Variant:
	printerr("[ServiceContainer] save() 未实现：子类应 override 此方法")
	return null

func misc_edge() -> Variant:
	printerr("[ServiceContainer] misc_edge() 未实现：子类应 override 此方法")
	return null

func mail() -> Variant:
	printerr("[ServiceContainer] mail() 未实现：子类应 override 此方法")
	return null

func snapshot_data() -> Variant:
	printerr("[ServiceContainer] snapshot_data() 未实现：子类应 override 此方法")
	return null
