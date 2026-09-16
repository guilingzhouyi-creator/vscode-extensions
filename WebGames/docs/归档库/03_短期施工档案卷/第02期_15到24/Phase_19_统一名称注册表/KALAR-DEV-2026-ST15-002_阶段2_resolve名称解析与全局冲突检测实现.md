---
档号: KALAR-DEV-2026-ST15-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST15 (Phase_19_统一名称注册表)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_19_统一名称注册表 —— 阶段2：resolve名称解析与全局冲突检测实现
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: localization_solver; LocalizationSolver 扩展; localization_registry_catalog
---

# 施工细则：统一名称注册表 —— 阶段2：resolve_name_key 解析与全局冲突检测实现

> [!NOTE]
> **【施工目标】**：在既有 i18n 层实现 `resolve_name_key` 统一名称解析（locale 查表 → fallback → 英文兜底 → 未登记告警留痕）；实现名称键登记入口 `register_name_key`（跨域全局唯一性 + 英文 fallback 必达）；将物品域 `loc_key_to_canonical` 冲突检测**全局化**为「名称键 → 域所有者」注册表。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST15-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST15-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ②（统一解析入口）⑤（全局唯一性约束）；Phase 18 细则 i18n 整改清单。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST15-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST15-001_阶段1_全局名称键数据契约与既有体系盘点.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST15-003_阶段3_词典配置结构与audit校验落地.md) ｜ [阶段4](KALAR-DEV-2026-ST15-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 实现设计（写入既有文件，最小外科手术）

### 1.1 LocalizationSolver 扩展（`localization_solver.gd`）

```gdscript
## 未登记名称键告警计数（遥测/审计只读查询，禁写业务判断）
static var missing_name_keys: int = 0

## 统一名称解析：locale 查表 → fallback_locale 回退 → 英文兜底(en_US) → [key] 原样 + 告警计数
static func resolve_name_key(
	catalog: LocalizationRegistryCatalog,
	key: String,
	locale_override: String = ""
) -> String:
	if catalog == null or key.is_empty():
		missing_name_keys += 1
		return "[%s]" % key
	var resolved := translate(catalog, key, {}, locale_override)
	if resolved == "[%s]" % key:
		# 未登记（locale/fallback/en_US 均未命中）→ 告警留痕
		missing_name_keys += 1
		return resolved
	return resolved
```

- `translate()` 既有解析链已含 fallback_locale 回退；**英文兜底**通过 catalog 初始化时强制登记 en_US 词典实现（见 1.2）；
- `missing_name_keys` 为静态计数器，测试/审计可断言清零或核对（只读，不做业务分支）。

### 1.2 LocalizationRegistryCatalog 登记入口（`localization_registry_catalog.gd`）

```gdscript
## 全局名称键登记（跨域唯一性 + 英文 fallback 必达）
var _name_key_owners: Dictionary = {}   # key -> domain（域所有者，冲突检测）
var registered_name_keys: Array = []    # 已登记键清单（audit 只读）

func register_name_key(key: String, domain: String, en_name: String, zh_name: String = "") -> Dictionary:
	if _name_key_owners.has(key):
		return {"success": false, "code": "NAME_KEY_COLLISION", "key": key, "owner": _name_key_owners[key]}
	_name_key_owners[key] = domain
	registered_name_keys.append(key)
	register_translation("en_US", key, en_name)   # 英文唯一 fallback 必达
	if zh_name != "":
		register_translation("zh_CN", key, zh_name)
	return {"success": true, "key": key, "domain": domain}
```

- **冲突检测全局化**：`_name_key_owners` 为跨域唯一注册表（物品域既有 `loc_key_to_canonical` 保留为物品内部映射，新增全局层不破坏既有查询）；
- en_US 必达：每个 key 登记即写 en_US 词典（英文 = 机器可读唯一底座）；zh_CN 可为空（显示层缺失时回退英文，符合「英文唯一 fallback」）。

### 1.3 消费方对齐（最小只读接线）

| 既有实现 | 对齐动作 |
| :--- | :--- |
| `ItemRegistryCatalog`（物品 `loc_name_key`） | 物品加载时经 `register_name_key(loc_name_key, "item", english_name)` 登记（域所有者 = item）；`loc_key_to_canonical` 保留内部映射不变 |
| `MagicTierRegistry`（Phase 18 魔法 `name_key`） | 魔法基线加载时逐条 `register_name_key(name_key, "magic", en_fallback)` 登记；登记失败（跨域冲突）→ 注册表拒绝就绪并告警（延续 Phase 18 不变量语义） |
| `I18nHotReloadPipeline.switch_language` | 名称解析与翻译共用同一 catalog，切换语言后显示层 resolve 自动生效（零改动，天然接线） |
| 前端显示层 | 展示文本一律经 `resolve_name_key` 取最终显示值；**逻辑判断永远引用名称键本体（英文）**，禁以显示文本作分支依据 |

---

## 二、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-NAM-S2-01` | 正常路径解析 | 已登记键 + zh_CN locale | 返回中文显示名；`missing_name_keys` 不增长 |
| `TC-NAM-S2-02` | 未登记告警 | 未登记键 resolve | 返回 `[key]` 原样 + `missing_name_keys` +1，不抛 Fatal |
| `TC-NAM-S2-03` | 跨域冲突拦截 | 同 key 二次登记（不同域） | 返回 `NAME_KEY_COLLISION` 且不覆盖原所有者 |
| `TC-NAM-S2-04` | 英文 fallback 必达 | 仅 en_US 登记（无 zh_CN） | zh_CN locale 下 resolve 回退英文显示，无 `[key]` |
| `TC-NAM-S2-05` | 物品/魔法接入 | 物品 loc_name_key / 魔法 name_key 全量登记 | 两类键全部进入全局注册表且唯一，零冲突 |
| `TC-NAM-S2-06` | 逻辑层解耦 | 后端逻辑引用 | 逻辑代码仅引用名称键本体，无显示文本分支依据 |
