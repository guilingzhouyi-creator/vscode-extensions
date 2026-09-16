---
档号: KALAR-DEV-2026-ST02-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST02 (Phase_06_GD风格提纯)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_06_GD风格提纯 —— 阶段1：变量命名与GD类型契约规范
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: GameConfig; PhysicalVerbRegistry; 变量命名; GD类型契约规范
---

# 施工细则：Phase 06 GD老练风格提纯 —— 阶段1：变量命名与GD类型契约规范

> [!NOTE]
> **【施工目标】**：统一 WebGames 全域变量命名与 GD 类型契约，确立老练 GD 品味的硬性规范底座。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST02-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST02-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[AGENTS.md 关键约定](..\..\..\..\..\..\AGENTS.md) 与 [WebGames 配置分层规范](..\..\..\..\..\config\README.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST02-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST02-002_阶段2_硬性写法与工程品味实现.md) ｜ [阶段3](KALAR-DEV-2026-ST02-003_阶段3_审计脚本与配置驱动约束提纯.md) ｜ [阶段4](KALAR-DEV-2026-ST02-004_阶段4_全量门禁与品味验收.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[AGENTS.md 命名与格式](..\..\..\..\..\..\AGENTS.md) ｜ [config/README.md 取值规范](..\..\..\..\..\config\README.md)
* **核心不变量约束断言**：`文件名 kebab-case、类 PascalCase、常量 UPPER_SNAKE、变量/函数 snake_case；static var 亦需 snake_case；类型化取值器零 get_value`。
* **防漂移最高指示**：严禁 `camelCase`、大写 `var`、`static var UPPER_SNAKE`；所有新增 `static var/func/const` 必须通过 `audit_gd_style` 新正则。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

```gdscript
# 模块路径: res://backend/infrastructure/game_config.gd
class_name GameConfig extends RefCounted:
    static var _tables: Dictionary = {}
    static var _loaded: bool = false
    const CONFIG_DIR: String = "res://config/"

# 命名契约（老练 GD 品味）
# 文件: kebab-case  | 类: PascalCase | 常量: UPPER_SNAKE | 变量/函数: snake_case
# 私有前缀: _  | 静态可变: snake_case（禁 UPPER_SNAKE） | 枚举: PascalCase + UPPER_SNAKE 成员
```

```gdscript
# 模块路径: res://backend/domains/physics_thermodynamics/physical_verb_registry.gd
class_name PhysicalVerbRegistry extends RefCounted:
    static var verbs: Dictionary:
        get:
            return GameConfig.get_dict("domains.combat", "verbs", {})
    # 禁止: static var VERBS / static var _FORBIDDEN_TOKENS
```

| 命名域 | 正则 | 违规示例 | 合规示例 |
| :--- | :--- | :--- | :--- |
| 文件名 | `^[a-z][a-z0-9_]*\.gd$` | `SaveManager.gd` | `save_manager.gd` |
| 类名 | `^[A-Z][A-Za-z0-9_]*$` | `save_manager` | `SaveManager` |
| 变量/函数 | `^_?[a-z][a-z0-9_]*$` | `VERBS`、`_FORBIDDEN_TOKENS` | `verbs`、`_forbidden_tokens` |
| 常量 | `^_?[A-Z][A-Z0-9_]*$` | `maxLevel` | `MAX_LEVEL` |

---

## 二、 边界与合法性约束 (Validation Constraints)

| 约束字段 | 类型 | 边界范围 | 违规处理 |
| :--- | :--- | :--- | :--- |
| `SNAKE_RE` | `RegExp` | `static var` 前缀可选 | 漏检即审计盲区，阻断合入 |
| `HEADER_MUST` | `String` | 含 `文件路径:` 与 `职责` | `backend/frontend/benchmarks` 缺失即阻断，`tests/` 豁免 |

---

## 三、 配置驱动与审计契约

* `scripts/py/audit_gd_style.py` 已覆盖 `backend/frontend/benchmarks`，`--all` 追加 `tests/`；`static var/func/const` 正则 `^\s*(?:static\s+)?` 已修复 `scripts/py/audit_gd_style.py:63`

## 四、 验收矩阵 (DoD Matrix)

| 检验项 ID | 测试目标 | 上游真理约束指针 | 输入断言 | 预期输出断言 |
| :--- | :--- | :--- | :--- | :--- |
| `TC-P06-S1-01` | 命名全量合规 | [AGENTS.md 命名](..\..\..\..\..\..\AGENTS.md) | `rg "var [A-Z]"` 全仓扫描 | 0 命中，`audit_gd_style` 166 文件通过 |
| `TC-P06-S1-02` | static 前缀覆盖 | [audit_gd_style.py:63](..\..\..\..\..\scripts\py\audit_gd_style.py) | `static var VERBS` | 报 `变量名应为 snake_case` |
| `TC-P06-S1-03` | 类型化取值 | [config/README.md 取值规范](..\..\..\..\..\config\README.md) | `GameConfig.get_value` 外部调用 | 0 命中，仅底座内部回退 |
