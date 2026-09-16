---
档号: KALAR-DEV-2026-ST42-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST42 (Phase_46_物品属性双UID联动与隐藏特殊词缀体系完善)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_46_物品属性双UID联动与隐藏特殊词缀体系完善 —— 阶段1：双UID数据契约与ABC三类属性模型设计
形成日期: 2026-09-03
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: ItemAttributeDefinition; ItemAttributeMountInstance; 属性定义元数据实体; 物品属性挂载实例契约; 物品综合属性结算快照契约
---

# 施工细则：Phase 46 物品属性双UID联动与隐藏特殊词缀体系完善 —— 阶段1：双UID数据契约与ABC三类属性模型设计

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST42-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST42-002_阶段2_隐藏属性生命周期与品质动态升格算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST42-003_阶段3_独立属性配置驱动与防伪鉴权工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST42-004_阶段4_全链路词缀联动与上下界验收测试矩阵.md)

> 施工开始日期: 2026-09-03 中午
> 责任人: 卡拉尔世界引擎架构组
> 状态: 📝 待获批（第1轮细则已编制，待批准后进入实现）

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [config/items/core.json](../../../../../config/items/core.json)（既有物品注册真源，包含 canonical_id、tier_rank、质量/槽位等基础定义）
  * [backend/domains/inventory/item_entity.gd](../../../../../backend/domains/inventory/item_entity.gd)（`ItemEntity` 物品聚合根与既有 `item_uid` 字段）
  * [backend/domains/item_namespace_registry/item_registry_catalog.gd](../../../../../backend/domains/item_namespace_registry/item_registry_catalog.gd)（`ItemRegistryCatalog` 物品原型模板与元数据）
  * [backend/domains/item_namespace_registry/quality_tier_registry.gd](../../../../../backend/domains/item_namespace_registry/quality_tier_registry.gd)（既有六级品质基线与阶梯系数）
* **核心不变量约束断言**：
  1. **双 UID 身份正交解耦不变量**：Item UID 仅决定“哪一件具体物品实例”，Attribute UID 仅决定“哪项具体属性定义及其计算规则”，二者通过挂载关系解耦绑定（`Item UID → Attribute UID → 属性配置`），严禁在物品逻辑中硬编码属性；
  2. **ABC 三类属性结构对称性与语义独立不变量**：A 类（增量属性）与 B 类（减量属性）结构对称、独立审计，严禁将 B 类简单粗暴实现为“负数 A 类”；
  3. **C 类隐藏态与生命周期隔离不变量**：C 类（特殊词缀属性）默认具备 `HIDDEN` 状态，未被合法鉴定激活前严格禁止参与最终角色面板与战斗效果计算；
  4. **属性下界非负不变量**：经 A/B/C 综合结算后的最终有效数值严格满足 $\text{EffectiveStat} \ge 0.0$，任何导致负值的计算必须在结算层明确截断钳制为 0。
* **防漂移最高指示**：严格区分 `Item UID ≠ Attribute UID ≠ 品质 ≠ C类词缀 ≠ 鉴定状态` 五大核心概念，严禁合并为单一字段或单一枚举。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1.1 属性定义元数据实体 (`ItemAttributeDefinition`)

```gdscript
# 模块路径: res://backend/domains/item_attributes/item_attribute_definition.gd
class_name ItemAttributeDefinition
extends RefCounted

enum AttributeCategory {
	INCREMENT,      # A类：增量属性 (加攻/加防/加MP/魔法威力等)
	DECREMENT,      # B类：减量属性 (降低指定能力/负重惩罚/诅咒，语义独立)
	SPECIAL_AFFIX,  # C类：特殊词缀 (默认隐藏，需鉴定方可激活)
}

enum CalculationType {
	FLAT_ADD,       # 固定点数加减
	PERCENT_ADD,    # 百分比加减
	FORMULA,        # 动态公式函数求解
}

var attribute_uid: String = ""              # 唯一属性标识，如 "ATTR_INC_ATK_T1"
var canonical_id: String = ""               # 规范名称标识，如 "attribute.attack_bonus"
var category: AttributeCategory = AttributeCategory.INCREMENT
var target_stat: String = ""                # 作用目标: "attack" / "defense" / "mp" / "magic_potency" 等
var calculation_type: CalculationType = CalculationType.FLAT_ADD
var base_value: float = 0.0
var value_min: float = 0.0                  # 单条属性取值下界 (>= 0)
var value_max: float = 9999.0               # 单条属性取值上界
var appraisal_requirement: Dictionary = {}  # 仅 C 类有效：所需鉴定技能、最低等级、阅历要求
var affix_score: float = 0.0                # 词缀权重分（用于鉴定后动态重新评估物品品质）
var conflict_tags: Array[String] = []       # 互斥标签集 (防止非法词缀组合)
var synergy_tags: Array[String] = []        # 协同标签集 (支持词缀连携加成)

func to_dto() -> Dictionary:
	return {
		"attribute_uid": attribute_uid,
		"canonical_id": canonical_id,
		"category": int(category),
		"target_stat": target_stat,
		"calculation_type": int(calculation_type),
		"base_value": base_value,
		"value_min": value_min,
		"value_max": value_max,
		"appraisal_requirement": appraisal_requirement.duplicate(true),
		"affix_score": affix_score,
		"conflict_tags": conflict_tags.duplicate(),
		"synergy_tags": synergy_tags.duplicate(),
	}

static func from_dto(data: Dictionary) -> ItemAttributeDefinition:
	var def := ItemAttributeDefinition.new()
	def.attribute_uid = str(data.get("attribute_uid", ""))
	def.canonical_id = str(data.get("canonical_id", ""))
	def.category = int(data.get("category", AttributeCategory.INCREMENT)) as AttributeCategory
	def.target_stat = str(data.get("target_stat", ""))
	def.calculation_type = int(data.get("calculation_type", CalculationType.FLAT_ADD)) as CalculationType
	def.base_value = float(data.get("base_value", 0.0))
	def.value_min = max(0.0, float(data.get("value_min", 0.0))) # 下界严格不得低于 0
	def.value_max = float(data.get("value_max", 9999.0))
	def.appraisal_requirement = data.get("appraisal_requirement", {}).duplicate(true)
	def.affix_score = float(data.get("affix_score", 0.0))
	def.conflict_tags.assign(data.get("conflict_tags", []))
	def.synergy_tags.assign(data.get("synergy_tags", []))
	return def
```

### 1.2 物品属性挂载实例契约 (`ItemAttributeMountInstance`)

```gdscript
# 模块路径: res://backend/domains/item_attributes/item_attribute_mount_instance.gd
class_name ItemAttributeMountInstance
extends RefCounted

enum VisibilityState {
	VISIBLE,        # 显式可见 (A/B 类初始状态)
	HIDDEN,         # 隐藏未鉴定 (C 类初始状态)
	APPRAISED,      # 已鉴定显现 (C 类鉴定通过状态)
}

var mount_id: String = ""                   # 挂载条目全局唯一 ID (MOUNT_<UUID>)
var item_uid: String = ""                   # 所属具体物品实例 UID
var attribute_uid: String = ""              # 关联的属性定义 UID
var category: ItemAttributeDefinition.AttributeCategory = ItemAttributeDefinition.AttributeCategory.INCREMENT
var current_value: float = 0.0
var visibility: VisibilityState = VisibilityState.VISIBLE
var is_active: bool = true                  # 是否正式参与战斗/角色数值结算
var appraisal_audit: Dictionary = {         # 鉴定防伪留痕凭证
	"is_appraised": false,
	"appraised_timestamp": 0,
	"appraiser_actor_id": "",
	"appraiser_skill_id": "",
	"audit_signature": ""
}

func to_dto() -> Dictionary:
	return {
		"mount_id": mount_id,
		"item_uid": item_uid,
		"attribute_uid": attribute_uid,
		"category": int(category),
		"current_value": current_value,
		"visibility": int(visibility),
		"is_active": is_active,
		"appraisal_audit": appraisal_audit.duplicate(true),
	}

static func from_dto(data: Dictionary) -> ItemAttributeMountInstance:
	var inst := ItemAttributeMountInstance.new()
	inst.mount_id = str(data.get("mount_id", ""))
	inst.item_uid = str(data.get("item_uid", ""))
	inst.attribute_uid = str(data.get("attribute_uid", ""))
	inst.category = int(data.get("category", ItemAttributeDefinition.AttributeCategory.INCREMENT)) as ItemAttributeDefinition.AttributeCategory
	inst.current_value = float(data.get("current_value", 0.0))
	inst.visibility = int(data.get("visibility", VisibilityState.VISIBLE)) as VisibilityState
	inst.is_active = bool(data.get("is_active", true))
	inst.appraisal_audit = data.get("appraisal_audit", {}).duplicate(true)
	return inst
```

### 1.3 物品综合属性结算快照契约 (`ItemEvaluationSnapshotDTO`)

```gdscript
# 模块路径: res://backend/domains/item_attributes/item_evaluation_snapshot_dto.gd
class_name ItemEvaluationSnapshotDTO
extends RefCounted

var item_uid: String = ""
var original_tier_rank: int = 1
var effective_tier_rank: int = 1            # 动态升格后的最终品阶
var is_tier_promoted: bool = false
var total_affix_score: float = 0.0
var active_stats: Dictionary = {}           # 综合生效数值 (stat_name -> value >= 0.0)
var raw_increment_stats: Dictionary = {}    # A类增量汇总
var raw_decrement_stats: Dictionary = {}    # B类减量汇总
var active_special_affixes: Array[String] = [] # 已激活生效的 C 类 attribute_uid 列表
var hidden_affix_count: int = 0             # 尚未鉴定的 C 类词缀数量

func to_dto() -> Dictionary:
	return {
		"item_uid": item_uid,
		"original_tier_rank": original_tier_rank,
		"effective_tier_rank": effective_tier_rank,
		"is_tier_promoted": is_tier_promoted,
		"total_affix_score": total_affix_score,
		"active_stats": active_stats.duplicate(true),
		"raw_increment_stats": raw_increment_stats.duplicate(true),
		"raw_decrement_stats": raw_decrement_stats.duplicate(true),
		"active_special_affixes": active_special_affixes.duplicate(),
		"hidden_affix_count": hidden_affix_count,
	}
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 1.1: 属性定义元模型与 ABC 三类分类契约** - 声明 `ItemAttributeDefinition` 实体，实现枚举与 DTO 互转；
- [ ] **Step 1.2: 双 UID 挂载实例与可见性契约设计** - 建立 `ItemAttributeMountInstance`，严密隔离 `item_uid` 与 `attribute_uid`；
- [ ] **Step 1.3: C 类隐藏生命周期与防伪审计结构设计** - 在挂载实例中内置 `appraisal_audit` 凭证字典，防篡改；
- [ ] **Step 1.4: 综合评价与品质动态升格快照 DTO** - 封装 `ItemEvaluationSnapshotDTO`，清晰展示原始品质与升格品质。

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-P46-S1-01` | 属性定义实体实例化与非负下界 | 传入 `value_min = -5.0` | 经 `from_dto()` 自动钳制为 `value_min >= 0.0` |
| `TC-P46-S1-02` | 双 UID 挂载结构关联有效性 | 绑定具体 `item_uid` 与 `attribute_uid` | 实例完整持有两独立标识，无硬编码混淆 |
| `TC-P46-S1-03` | C 类属性初始隐藏与非激活契约 | 创建 `SPECIAL_AFFIX` 挂载条目 | `visibility == HIDDEN` 且 `is_active == false` |
| `TC-P46-S1-04` | 评价快照 DTO 序列化对等 | 构造含升格属性的快照实例 | `to_dto()` 完整反映原品质、升格品质与各分类统计 |
