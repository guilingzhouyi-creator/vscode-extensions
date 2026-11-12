# 物品命名空间、品质与魔法基线注册体系 (`item_namespace_registry`)

> 对应源码：`backend/domains/item_namespace_registry/`（**15 个** `.gd`）。构成全游戏**物品原型、实例 UID、六档品质与十一阶魔法位阶**的唯一事实来源，统筹全部物品与魔法效果描述、实例工厂发放与服务端防重放。

---

## 一、三大权威子体系清单

### 1. 物品命名空间与实例发放工厂
| 文件路径 | 核心类 | 关键公开接口与契约 |
| :--- | :--- | :--- |
| [item_registry_catalog.gd](../../../../backend/domains/item_namespace_registry/item_registry_catalog.gd) | `ItemRegistryCatalog` | 维护 `canonical_id`、`numeric_id` 与归一英文名三向唯一映射及别名倒排索引；`get_prototype()`、`search_by_alias()` |
| [item_registry_solver.gd](../../../../backend/domains/item_namespace_registry/item_registry_solver.gd) | `ItemRegistrySolver` | ID 命名正则校验、碰撞拦截与增删改索引维护：`validate_canonical_id_format()`、`register_prototype()`、`resolve_search_term()` |
| [item_loader_pipeline.gd](../../../../backend/domains/item_namespace_registry/item_loader_pipeline.gd) | `ItemLoaderPipeline` | 装配入口 `build_catalog_from_config()` 自动发现并加载 `config/items/*.json`；支持热重载 `reload_from_config()` |
| [item_uid_generator.gd](../../../../backend/domains/item_namespace_registry/item_uid_generator.gd) | `ItemUIDGenerator` | 生成 `<域前缀> + <8位单调计数> + <2位校验尾>`（如 `GM_`/`CDK_`/`GAC_`/`MAIL_`/`SRV_`）：`generate_uid()`、`validate_uid()` |
| [item_instance_factory.gd](../../../../backend/domains/item_namespace_registry/item_instance_factory.gd) | `ItemInstanceFactory` | 全渠道物品发放统一工厂：`build_instance()` |
| [item_description_resolver.gd](../../../../backend/domains/item_namespace_registry/item_description_resolver.gd) | `ItemDescriptionResolver` | `resolve()` 只读消费注册表生成标准合规描述 |
| [server_grant_registry.gd](../../../../backend/domains/item_namespace_registry/server_grant_registry.gd) | `ServerGrantRegistry` | `register_grant()`、`find_grant_by_uid()` 防止服务端奖励 `grant_id` 重放发放 |

### 2. 全局物品品质体系
| 文件路径 | 核心类 | 关键不变量与接口 |
| :--- | :--- | :--- |
| [quality_tier_registry.gd](../../../../backend/domains/item_namespace_registry/quality_tier_registry.gd) | `QualityTierRegistry` | 加载 `domains.quality_tiers` 并在启动期校验单调等级序与区间从属：`is_ready()`、`get_tier_baseline()`、`get_mythic_interval_baseline()` |
| [item_quality_snapshot.gd](../../../../backend/domains/item_namespace_registry/item_quality_snapshot.gd) | `ItemQualitySnapshot` | 定义 `QualityTier`（6 档主品质）与 `MythicInterval`（神话级内部连续区间端点） |
| [item_quality_resolver.gd](../../../../backend/domains/item_namespace_registry/item_quality_resolver.gd) | `ItemQualityResolver` | `resolve()`、`get_strength_weight()` 将物品声明解析为唯一品质基线（拒收未登记品质） |

### 3. 全域魔法位阶与能力分级基线
| 文件路径 | 核心类 | 关键不变量与接口 |
| :--- | :--- | :--- |
| [magic_tier_registry.gd](../../../../backend/domains/item_namespace_registry/magic_tier_registry.gd) | `MagicTierRegistry` | 加载 `domains.magic_tiers` 并校验 11 阶单调序列、资质阈值与称号区间：`get_rank_baseline()`、`query_tier_candidates()`、`query_band()`、`is_mana_gate_passed()` |
| [magic_tier_snapshot.gd](../../../../backend/domains/item_namespace_registry/magic_tier_snapshot.gd) | `MagicTierSnapshot` | 枚举施法形态 `MagicForm`、资质 `ManaAptitude`、1~11 阶位阶 `MagicRank`、能力分级 `AbilityTier`、档次 `MagicRankBand` 与实力称号 `ProfessionRank` |
| [magic_baseline_resolver.gd](../../../../backend/domains/item_namespace_registry/magic_baseline_resolver.gd) | `MagicBaselineResolver` | `resolve()` 强校验超位形态约束并排除非魔法范畴档次 |
| [magic_ability_tier_resolver.gd](../../../../backend/domains/item_namespace_registry/magic_ability_tier_resolver.gd) | `MagicAbilityTierResolver` | 仅表达能力分级与 1~11 阶间的弱参考区间关系，禁做一刀切枚举映射：`infer_tier_candidates()`、`is_tier_break_allowed()` |
| [magic_rank_band_resolver.gd](../../../../backend/domains/item_namespace_registry/magic_rank_band_resolver.gd) | `MagicRankBandResolver` | `rank_to_band()` 将 1~11 阶确定性划分为互斥全覆盖的档次区间 |

---

## 二、关联配置与验证

- **配置映射**：`domains.item_namespace_registry.core`、`items.core`、`domains.quality_tiers`、`domains.magic_tiers`、`narratives.item_namespace_registry`。
- **测试入口**：[test_item_namespace_registry.gd](../../../../tests/unit/domains/test_item_namespace_registry.gd)、[test_item_quality.gd](../../../../tests/unit/infrastructure/test_item_quality.gd)、[test_magic_tier.gd](../../../../tests/unit/infrastructure/test_magic_tier.gd)、[test_name_registry.gd](../../../../tests/unit/infrastructure/test_name_registry.gd)。
