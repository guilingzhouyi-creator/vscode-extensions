# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_instance_factory.gd
# 架构定位: Domain Factory / Entity Assembler
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 全链路发放统一入口：注册表原型 → 实例 + 权威 UID（发放来源前缀隔离）。 GM give / CDKey / 邮件礼物 / 抽卡 / 服务器发放一律经本工厂， 杜绝各链路自造实例 ID 漂移；item_id 兼容保留（item_id_prefix 非空时沿用）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemInstanceFactory extends RefCounted

# ==============================================================================
# 一、实例构建统一入口
# ==============================================================================

## 构建实例：proto 原型 + 显示名 + UID 前缀（必为已登记前缀）+ 兼容 item_id 前缀
## 品质透传（Phase 17）：proto 声明 quality_tier 时经统一基线解析写入快照；未声明零影响。
## Phase 44 P1：新增可选参 quality_registry——发放热循环（十连/批量邮件/任务奖励）可传入
## 装配期单例复用，缺省经 GameBootstrap.quality_tier_registry() 懒装配兜底，杜绝每实例
## new()+reload_configuration() 整表重建（调用方既有签名零破坏）。
static func build_instance(
	proto: ItemRegistryCatalog.ItemPrototypeTemplate,
	display_name: String,
	uid_prefix: String,
	item_id_prefix: String = "",
	quality_registry: QualityTierRegistry = null
) -> ItemEntity:
	var item := ItemEntity.from_payload(ItemRegistrySolver.build_instance_payload(proto, display_name))
	item.item_uid = ItemUIDGenerator.generate_uid(uid_prefix)
	if not item_id_prefix.is_empty():
		item.item_id = UniqueIdGenerator.next_id(item_id_prefix)
	if proto.quality_tier > 0:
		var registry: QualityTierRegistry = quality_registry
		if registry == null:
			registry = GameBootstrap.quality_tier_registry()
		if registry != null and registry.is_ready():
			var resolver := ItemQualityResolver.new(registry)
			var qr := resolver.resolve(proto.canonical_id, proto.quality_tier, proto.mythic_interval)
			if qr.get("success", false):
				item.quality_snapshot = qr.get("snapshot", {})
	return item
