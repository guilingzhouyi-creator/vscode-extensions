---
档号: KALAR-DEV-2026-ST20-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST20 (Phase_24_统一文案配置系统)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_24_统一文案配置系统 —— 阶段3：统一配置布局与audit合并
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: items.json
---

# 施工细则：统一文案配置系统 —— 阶段3：统一配置布局与audit合并

> [!NOTE]
> **【施工目标】**：确立统一配置布局 `copywriting.<域>`（四域：item / narrative / probability / bulletin）；既有表迁移（`descriptions.items` / `narratives.events` → `copywriting.*`）+ 存量 `%s` 迁移归零 + 适配层兜底；**统一 audit_copywriting.py**（合并通用校验 + 域红线保留），旧 audit 退役。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST20-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST20-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ③（配置布局）④（audit 统一）⑤（域红线保留）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST20-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST20-001_阶段1_数据契约与既有体系盘点.md) ｜ [阶段2](KALAR-DEV-2026-ST20-002_阶段2_共享文案解析核心与域接入.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST20-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 统一配置布局

| 表 | 内容 | 迁移来源 |
| :--- | :--- | :--- |
| `copywriting.item` | 物品描述模板 + 状态条件段 | `descriptions/items.json`（Phase 21） |
| `copywriting.narrative` | 事件描述结果分支 + 剧情文案 | `narratives/events.json`（Phase 23）+ `narratives/*.json` 存量（Phase 20 目标） |
| `copywriting.probability` | 概率结果展示文案（`{probability_pct}`/`{adjusted_by}`） | 新表（Phase 22 概率层扩展） |
| `copywriting.bulletin` | 公告/通知文案 | `narratives/bulletin_board_maintenance.json`（`%s` 迁移） |

**迁移策略**：

1. **存量迁移**：既有模板值迁移到 `copywriting.<域>`（结构不变：模板 + conditions + branches），`%s`/`%d` → `{param}` 语义化（占位符归零）；
2. **适配层兜底**：`CopywritingResolver` 对 `copywriting.<域>` 未命中时回读旧表（`descriptions.items` / `narratives.events`）——迁移期间零打断，迁移完成后适配层退役（audit 提示废弃表）；
3. **目录族登记**：`config/copywriting/` 目录在 `audit_config.py LAYERS` 登记（同 i18n/descriptions 先例）。

---

## 二、 统一 audit_copywriting.py（合并通用校验 + 域红线）

| 校验项 | 规则 | 级别 |
| :--- | :--- | :--- |
| **通用·占位符残留** | 四域模板含 `%s`/`%d`/空 `{}` → 违规 | 阻断 |
| **通用·零内联** | 后端代码含 `{param}` 中文模板字面量 → 违规 | 阻断 |
| **通用·键格式** | 文案键非三段式英文 → 违规 | 阻断 |
| **通用·名称注册表登记** | `copy_key` 未登记 → 违规 | 阻断 |
| **域红线·物品属性白名单** | `copywriting.item` 占位符/条件键 ∉ 属性白名单 → 违规（防反向定义） | 阻断 |
| **域红线·事件判定禁入** | `copywriting.narrative` 模板含判定/执行语义字段 → 违规 | 阻断 |
| **域红线·概率只读** | `copywriting.probability` 含判定/执行字段 → 违规 | 阻断 |
| **适配层废弃提示** | 旧表（descriptions.items/narratives.events）仍有消费 → 提示（suggestion） | 提示 |

- **合并**：`audit_item_descriptions.py` + `audit_event_descriptions.py` 的通用检查（占位符残留/零内联）收敛至 `audit_copywriting.py`；旧两 audit **退役**（audit_runner 挂载点替换为 `task_id="copywriting"`）；
- **域红线保留**：物品属性白名单/事件判定禁入/概率只读作为统一 audit 的分域节（不因合并而放宽）；
- 事实源：`config/copywriting/*.json` + 名称注册表登记键 + 属性白名单。

---

## 三、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-COPY-S3-01` | 统一布局加载 | `copywriting.<域>` 四表 | GameConfig 递归扫描加载成功（零装配）+ LAYERS 登记 |
| `TC-COPY-S3-02` | 存量迁移归零 | 四域模板扫描 | `%s`/`%d` 归零，全部 `{param}` 语义化 |
| `TC-COPY-S3-03` | 适配层兜底 | 旧表条目（未迁移） | 迁移期间旧表仍可解析（零打断） |
| `TC-COPY-S3-04` | 通用校验合并 | 统一 audit 运行 | 占位符残留/零内联/键格式/登记覆盖四域，旧 audit 退役 |
| `TC-COPY-S3-05` | 域红线保留 | 三域红线样本 | 物品属性白名单/事件判定禁入/概率只读在统一 audit 内仍阻断 |
| `TC-COPY-S3-06` | 键登记 | 四域文案键 | 名称注册表登记可查，跨域唯一 |
