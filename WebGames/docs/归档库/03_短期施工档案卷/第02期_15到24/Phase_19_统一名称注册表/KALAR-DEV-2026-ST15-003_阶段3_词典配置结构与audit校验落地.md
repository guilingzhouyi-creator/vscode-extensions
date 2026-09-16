---
档号: KALAR-DEV-2026-ST15-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST15 (Phase_19_统一名称注册表)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_19_统一名称注册表 —— 阶段3：词典配置结构与audit校验落地
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 文件布局; 登记流; localization_i18n.json
---

# 施工细则：统一名称注册表 —— 阶段3：词典配置结构与audit校验落地

> [!NOTE]
> **【施工目标】**：确立 i18n 词典配置结构（`config/i18n/en_US.json` 英文唯一底座 + `config/i18n/zh_CN.json` 中文展示层，键空间 = 全局名称键）；audit 新增名称键校验（三段格式 / 跨域唯一性 / en_US 覆盖率 100% / 键本体禁中文）；落地存量中文迁移批次清单（逻辑 fallback 迁移，剧情展示层保留）。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST15-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST15-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ③（配置驱动）④（audit 校验）⑤（英文唯一底座）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST15-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST15-001_阶段1_全局名称键数据契约与既有体系盘点.md) ｜ [阶段2](KALAR-DEV-2026-ST15-002_阶段2_resolve名称解析与全局冲突检测实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST15-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 词典配置结构（唯一事实源）

### 1.1 文件布局

| 文件 | 角色 | 内容示例 |
| :--- | :--- | :--- |
| `config/i18n/en_US.json` | **英文唯一底座**（机器可读规范语言） | `"item.steel_sword.name": "Steel Sword"`、`"magic.rank.god_2": "Divine God II"` |
| `config/i18n/zh_CN.json` | 中文展示层（可缺省，缺失回退英文） | `"item.steel_sword.name": "精钢长剑"`、`"magic.rank.god_2": "真神二阶"` |
| `config/domains/localization_i18n.json` | 既有 i18n 域表（defaults 等，零改动） | `defaults/current_locale`、`defaults/fallback_locale` |

- 词典 JSON 遵循既有规范序列化（ensure_ascii=false + 2 空格缩进 + LF + 末行换行），键本体 100% 英文三段式；
- 加载：新增轻量加载器（或并入既有 config 管线）在启动时 `load_locale_dict("en_US", ...)` + `load_locale_dict("zh_CN", ...)` 灌入 `LocalizationRegistryCatalog`；
- **en_US 覆盖率门禁**：audit 校验「已登记名称键集合 ⊆ en_US 词典键集合」——英文唯一 fallback 必达（缺失即门禁阻断）。

### 1.2 登记流（与 S2 一致，配置为源、动态登记）

```
启动 → 加载 en_US/zh_CN 词典 → 各域加载器（物品 ItemLoaderPipeline / 魔法 MagicTierRegistry …）
     → 逐条 register_name_key(name_key, domain, en_name, zh_name)
     → 冲突/英文缺失 → 注册表拒绝就绪 + audit 报告
```

---

## 二、 audit 名称键校验（新增脚本或并入既有链）

| 校验项 | 规则 | 违规级别 |
| :--- | :--- | :--- |
| 三段格式 | `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` | 阻断 |
| 键本体禁中文 | 键含 `\u4e00-\u9fff` → 违规 | 阻断 |
| 跨域唯一性 | 同 key 多域登记 → `NAME_KEY_COLLISION` | 阻断 |
| en_US 覆盖率 | 登记键集合 ⊄ en_US 词典 → 缺失清单 | 阻断 |
| 存量迁移核对 | 逻辑 fallback 中文未列入迁移批次/未迁移 → 提示 | 提示（suggestion） |

- 接线：挂入 `audit-all.sh` 链（与 audit_config/audit_item_keys 同级）；规则声明同步 `scripts/py/audit_docs.py --rules` 或独立规则文件；
- 事实源：配置 `config/i18n/*.json` + 各域加载器登记结果（审计与运行同源，防漂移）。

---

## 三、 存量中文迁移批次（S1 盘点第 6 项的落地）

| 批次 | 范围 | 迁移动作 |
| :---: | :--- | :--- |
| **批次 1**（Phase 18 遗留 9 处） | `profession_tier_name`（"初阶行者 阶位 1"）/ `canonical_name`（"圣魔导师"/"极效魔剑士"）/ `inventory.json` 职业 titles `name` / `guest_name_prefix`（"游侠_"）/ `gm_command_catalog` 命令描述 / narratives 默认名 / 各 config fallback 中文 | 值改 `name_key` 引用 → 词典登记（en_US 英文 + zh_CN 中文）→ 逻辑键引用不变、显示经 `resolve_name_key` |
| **批次 2**（config 逻辑 fallback） | character_creation / account / elite / combat / lattice / monster 中的逻辑键显示值（如职业称谓、头衔、状态名） | 同上：改 name_key 引用 + 词典登记 |
| **保留**（剧情展示层） | quest / npc / elite / combat 剧情叙事文本、公告、描述长文 | 保留中文（展示数据，非逻辑键）；标注 `narratives` 类目不参与名称键迁移 |

- 批次 1/2 完成后 `missing_name_keys` 静态计数归零（运行期验证）；剧情类文本不登记名称键（audit 按域白名单跳过）。

---

## 四、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-NAM-S3-01` | 词典结构加载 | en_US/zh_CN 词典文件 | 双词典灌入 catalog 成功；键集合与登记键一致 |
| `TC-NAM-S3-02` | en_US 覆盖率门禁 | 登记键 vs en_US 词典 | 覆盖 100%；缺失键被 audit 阻断并列出清单 |
| `TC-NAM-S3-03` | 键格式/禁中文校验 | 含中文键 / 两段键样本 | audit 报告违规并阻断 |
| `TC-NAM-S3-04` | 跨域唯一校验 | 同 key 双域登记 | `NAME_KEY_COLLISION` 报告 |
| `TC-NAM-S3-05` | 批次 1 迁移完成 | 9 处后端 fallback | 全部改 name_key 引用；运行期 `missing_name_keys == 0` |
| `TC-NAM-S3-06` | 剧情展示层保留 | quest/npc 剧情文本 | 保留中文且 audit 按白名单跳过，零误报 |
