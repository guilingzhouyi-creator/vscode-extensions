---
档号: KALAR-DEV-2026-ST59-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST59 (Phase_63_自动化脚本库审查边界提升与规范性泛化治理)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_63_自动化脚本库审查边界提升与规范性泛化治理 —— 阶段1：声明式规则元模型与统一Finding数据模型设计
形成日期: 2026-09-05
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: Finding; ValueDomainRuleSchema; 声明式配置值域规则模型; 统一诊断数据模型; GDScript 4 架构与现代化治理规则扩展
---

# 施工细则：Phase 63 自动化脚本库审查边界提升与规范性泛化治理 —— 阶段1_声明式规则元模型与统一Finding数据模型设计

> 施工开始日期：2026-09-05 中午
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已闭环（第2轮声明式规则元模型与统一 Finding 数据模型设计落地，全域门禁回归全绿通过）

> [!NOTE]
> **【施工目标】**：全面终结自动化脚本库（尤其是 `audit_config.py` 与 `audit_gd.py`）中针对各业务领域不断新增硬编码 Python 函数的架构痛点，建立“声明式配置值域校验规则 Schema”与“统一 Finding 诊断数据模型”；同时针对 GDScript 4 现代化特性陷阱与跨域防腐边界，在代码规范治理库中扩充静态审查契约规则集，为全脚本库泛化调度与机械自检提供结构化数据底座。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST59-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST59-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：自动化脚本库审查边界提升与规范性泛化治理专项需求（解耦 `audit_config.py` 中 7 组硬编码专用业务函数，构建规则表驱动的通用校验引擎；统一跨脚本 CLI 诊断输出与退出码标准；强化 GDScript 4 架构静态审查边界）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST59-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST59-002_阶段2_泛化配置校验引擎与调度切片算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST59-003_阶段3_规则库统一解耦与CLI跨平台规范工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST59-004_阶段4_全量脚本自检与泛化门禁验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：
  - `WebGames/scripts/py/audit_config.py:490-496`：`check_eligibility_rules`, `check_economy_config`, `check_magic_rules_config`, `check_combat_config`, `check_value_domains`, `check_contract_value_domains`, `check_lifecycle_value_domains` 7 大专用函数硬编码于脚本内部，每新增一个业务域或配置表必须修改 Python 代码，违反开闭原则；
  - `WebGames/scripts/py/audit_common.py:36-44`：`Finding` 数据类缺乏 `category`、`rule_id`、`code` 显式分类，无法满足结构化聚合看板与自动化修复建议需求；
  - `WebGames/scripts/config/code_governance_rules.json:5-85`：现存规则集中于基础风格与简单复杂度，缺乏针对 GDScript 4 Lambda 捕获、跨域内部私有直接访问与类型推断缺陷的架构级防御规则；
  - `WebGames/scripts/py/audit_pair_parity.py:31-45`：sh/ps1 同构参数提取器依赖严格单行正则，对多行带属性参数易产生边界误判。
* **核心不变量约束断言**：
  - **Inv-GEN-1（声明式解耦不变量）**：所有业务层（domains、infrastructure、frontend）配置值域与数据约束必须以声明式规则描述（存储于 `scripts/config/value_domain_rules.json`），禁止在通用审查脚本内硬编码任何特定业务表校验逻辑；
  - **Inv-GEN-2（规则原语闭包不变量）**：声明式规则系统仅支持显式注册的 9 类规则原语（`required_sections`, `positive_num`, `bounded_range`, `range_ordered`, `enum_whitelist`, `array_elements_schema`, `unique_key`, `cross_field_dependency`, `foreign_key_reference`），任何规则必须能映射为此 9 类原语之一；
  - **Inv-GEN-3（诊断模型同构不变量）**：所有 Python 审查工具通过统一 `Finding` 数据模型输出结构化违规项，`--json` 输出格式全库对齐，并保持严格的 3 态进程退出码标准（`0=PASS`, `1=VIOLATION`, `2=USAGE_ERROR`）；
  - **Inv-GEN-4（零破坏向后兼容不变量）**：既有 117 张合法配置表与 81 套测试用例在泛化规则驱动下必须保持 100% 校验通过，无任何语义漂移或误报；
  - **Inv-GEN-5（规则自省与自检不变量）**：规则表本身具备强类型 Schema，启动时必须进行自检验证（目标表是否存在、规则类型是否合法、键路径是否合规），防止死规则或拼写错误；
  - **Inv-GEN-6（跨域纯领域防腐不变量）**：backend 领域模块间严禁跨域直接读取以 `_` 开头的私有属性或调用私有方法，必须通过标准公共方法或 EventBus 交互。
* **防漂移最高指示**：
  - 第 1 轮严格仅落盘四阶段施工细则与路线图总索引登记，严禁在未获明确批准前修改任何业务代码或脚本实现；
  - 所有规则 ID 保持固定大写前缀（`VD_*`, `ADV-*`, `SIM-*`），严禁随版本变动更名。

---

## 一、 数据结构设计与契约模型

### 1. 声明式配置值域规则模型 (ValueDomainRuleSchema)

在 `scripts/config/value_domain_rules.json` 中统一管理所有配置值域约束，元数据结构定义如下：

```json
{
  "$schema": "scripts/config/value_domain_rules.schema.json",
  "schema_version": 1,
  "description": "卡拉尔世界引擎全域配置表值域与拓扑完整性声明式规则库",
  "primitive_types": [
    "required_sections",
    "positive_num",
    "bounded_range",
    "range_ordered",
    "enum_whitelist",
    "array_elements_schema",
    "unique_key",
    "cross_field_dependency",
    "foreign_key_reference"
  ],
  "rules": [
    {
      "rule_id": "VD_POTENTIAL_TIER_SIZE",
      "primitive": "positive_num",
      "target_file": "domains/potential.json",
      "key_path": "point_cost/tier_size",
      "params": { "allow_float": false, "min_exclusive": 0 },
      "severity": "ERROR",
      "description": "潜能突破阶梯尺寸必须为正整数，防止除零崩溃"
    },
    {
      "rule_id": "VD_HARDWARE_STICK_DEADZONE",
      "primitive": "range_ordered",
      "target_file": "domains/hardware_input.json",
      "key_path_left": "stick_deadzone/inner",
      "key_path_right": "stick_deadzone/outer",
      "params": { "strict_less": true },
      "severity": "ERROR",
      "description": "手柄摇杆内死区必须严格小于外死区，防止死区倒置"
    },
    {
      "rule_id": "VD_LIFECYCLE_FORCE_KILL_BOUND",
      "primitive": "bounded_range",
      "target_file": "infrastructure/lifecycle.json",
      "key_path": "timeouts/force_kill_timeout_seconds",
      "params": { "min_val": 1.0, "max_val": 10.0, "inclusive": true },
      "severity": "ERROR",
      "description": "强制停机超时时间必须处于 [1.0, 10.0] 秒合理窗口内"
    },
    {
      "rule_id": "VD_CONTRACT_ENDPOINT_KIND",
      "primitive": "enum_whitelist",
      "target_file": "infrastructure/contracts.json",
      "array_path": "entries",
      "item_key_path": "endpoint_kind",
      "params": { "whitelist": ["DTO", "EVENT", "COMMAND", "GM_READONLY"] },
      "severity": "ERROR",
      "description": "前后端契约端点类型必须属于合法白名单枚举"
    },
    {
      "rule_id": "VD_CONTRACT_ID_UNIQUENESS",
      "primitive": "unique_key",
      "target_file": "infrastructure/contracts.json",
      "array_path": "entries",
      "item_key_path": "contract_id",
      "params": {},
      "severity": "ERROR",
      "description": "前后端契约条目 contract_id 必须全表唯一，禁止重复注册"
    },
    {
      "rule_id": "VD_MAGIC_ATTRIBUTE_SCHOOL_REF",
      "primitive": "foreign_key_reference",
      "target_file": "domains/magic_rules.json",
      "source_dict_path": "attributes",
      "source_item_key": "school",
      "target_dict_path": "attribute_schools",
      "params": {},
      "severity": "ERROR",
      "description": "所有魔法属性归属体系必须已在 attribute_schools 字典中注册"
    }
  ]
}
```

### 2. 统一诊断数据模型 (Standardized Finding Model)

扩展 `scripts/py/audit_common.py` 中的 `Finding` 数据类，确保全脚本库具有一致的结构化诊断契约：

```python
from dataclasses import dataclass, field
from typing import Optional, Dict, Any

@dataclass
class Finding:
    rule_id: str                      # 唯一规则编号，如 VD_LC_01, ADV-LAM-001, SIM-CMP-001
    category: str                     # 领域大类: "config" | "gdscript" | "parity" | "arch" | "doc"
    file_path: str                    # 相对仓库根目录的规范化 POSIX 路径
    line_number: int                  # 违规所在行号（若无精准行号标记为 0）
    message: str                      # 违规问题描述
    severity: str = "ERROR"           # 严重度: "ERROR"（阻断 CI）| "WARN"（告警）| "INFO"（提示）
    suggestion: str = ""              # 修复建议指引
    context: Dict[str, Any] = field(default_factory=dict)  # 附加上下文键值（如实测值、期望区间等）

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "category": self.category,
            "file": self.file_path,
            "line": self.line_number,
            "severity": self.severity,
            "message": self.message,
            "suggestion": self.suggestion,
            "context": self.context
        }
```

### 3. GDScript 4 架构与现代化治理规则扩展 (Code Governance Expansion)

在 `scripts/config/code_governance_rules.json` 中扩展定义 4 项高级代码治理规则契约：

```json
{
  "advanced_rules": {
    "ADV-LAM-001": {
      "level": "WARN",
      "name": "Lambda 捕获作用域与生命周期安全",
      "description": "GDScript 4 中 lambda 表达式捕获基础类型为值传递、捕获对象可能引发生命周期循环引用，严禁在闭包中直接修改捕获的基本类型局部变量",
      "fix_suggestion": "使用 Callable 或将状态封装于 RefCounted 容器对象中传递引用"
    },
    "ADV-BND-001": {
      "level": "ERROR",
      "name": "纯领域模型跨域私有成员访问禁令",
      "description": "backend/domains/ 下不同子域之间严禁跨域直接读写以 '_' 开头的私有属性或调用私有方法，必须使用公有契约方法或 EventBus 进行交互",
      "fix_suggestion": "通过公开的公共方法、DTO 传输载荷或发布领域事件解耦交互"
    },
    "ADV-TYP-003": {
      "level": "WARN",
      "name": "不可控 Variant 返回值盲目静态推断防范",
      "description": "严禁对可能返回 null、Variant 或动态字典查询结果使用 := 进行强类型绑定（如 var x := dict.get(k) 会推断为 Variant 并隐藏类型缺陷）",
      "fix_suggestion": "显式声明期望类型并进行空值卫语句守卫：var x: Type = dict.get(k, default)"
    },
    "ADV-SIG-001": {
      "level": "ERROR",
      "name": "信号发射参数完整性契约",
      "description": "emit_signal() 或 signal.emit() 传入的参数数量和类型必须与 signal 声明完全匹配",
      "fix_suggestion": "核对信号声明签名并确保发射传参一一对应"
    }
  }
}
```

### 4. 统一 CLI 退出码与运行契约 (Execution Contract)

| 退出码 | 状态含义 | 触发条件 | 控制台表现 |
| :---: | :---: | :--- | :--- |
| **0** | **通过 (PASS)** | 违规项中 `severity == "ERROR"` 的数量为 0 | 打印 `【审查结论】通过`，绿色高亮 |
| **1** | **阻断 (FAIL)** | 存在至少 1 项 `severity == "ERROR"` 的违规 | 打印 `【审查结论】未通过，已阻断`，红色高亮 |
| **2** | **用法错误 (USAGE ERROR)** | 传入非法参数、互斥选项组合或必需规则文件缺失 | 打印 `【用法错误】参数或依赖异常`，黄色高亮 |

---

## 二、 阶段交付物清单

1. `scripts/config/value_domain_rules.json` 数据契约草案定义；
2. `scripts/py/audit_common.py` 中 `Finding` 数据模型与标准输出接口契约；
3. `scripts/config/code_governance_rules.json` 中 4 项现代化代码治理规则定义；
4. 阶段 1 架构设计不变量清单（Inv-GEN-1 ~ Inv-GEN-6）确立。
