---
档号: KALAR-DEV-2026-ST47-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST47 (Phase_51_事务快照面与回滚对象集完整性加固)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_51_事务快照面与回滚对象集完整性加固 —— 阶段3：快照DTO复用与反序列化收敛工程化
形成日期: 2026-09-04
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 快照面能力复用登记表; 配置化要求; 反序列化收敛收敛化
---

# 施工细则：阶段3_快照DTO复用与反序列化收敛工程化

> 施工开始日期: 2026-09-04 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: 📝 待获批（第1轮细则已编制，待批准后进入实现）

> [!NOTE]
> **【施工目标】**：将阶段1/2 确立的快照面契约工程化收口——① 快照/恢复方法以**纯数据 DTO + 显式命名**落地（不引入隐式全局状态）；② 全部修复点零新增硬编码，涉及阈值与开关一律走既有配置表；③ 文档与代码同步登记，确保「快照面清单」成为后续案卷可复用的工程资产。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST47-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST47-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：全域质量与边界专项审查报告（2026-09-04）→ M1 / M5 / M9
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST47-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST47-001_阶段1_事务快照面与回滚对象集契约设计.md) ｜ [阶段2](KALAR-DEV-2026-ST47-002_阶段2_保底计数与装备槽回滚对称性算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST47-004_阶段4_事务原子性与经济一致性验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：阶段1 §一「快照面清单契约」；阶段2 §一 三处实现
* **核心不变量约束断言**：`Inv-ENG-1`：快照 DTO 均为 `Dictionary` 纯数据、可序列化、无对象引用泄漏；`Inv-ENG-2`：新增代码零新硬编码字面量（通过 audit_hardcode 门禁）；`Inv-ENG-3`：不引入新的跨域依赖方向（保持既有单向依赖拓扑）
* **工程化重构最高指示**：严格使用既有类型化取值器（`GameConfig.get_int/get_float/get_string`），严禁 Variant `get_value`；新增方法一律先补头注释（职责/时序铁律），命名对齐既有 `snapshot()/restore()` 惯例

---

## 一、 配置驱动与泛化扩展实现 (Configuration-Driven & Refactoring)

### 1. 快照面能力复用登记表（本卷落地产物）

| 新增/改造方法 | 载体文件 | 归属快照面 | 复用方（现状/未来） |
| :--- | :--- | :--- | :--- |
| `snapshot_progress()` / `restore_progress()` | `gacha_wish/gacha_banner_entity.gd` | COUNTER | `GachaExecutionService`（本卷）；后续其它含保底计数域 |
| `snapshot_slots()` / `restore_slots()` | `equipment_loadout/equipment_loadout_entity.gd` | LOADOUT | `DisposalPipeline`（本卷）；后续分解/重铸/熔炼等销毁类事务 |
| `deserialize` 收敛（clampi 序关系） | `potential_growth/potential_growth_engine.gd` | ENGINE_STATE | 全部存档加载入口（save/装配层间接复用） |
| 成本分子 `maxi(0, …)` | `potential_growth/respec_pipeline.gd` | — | 洗点/重构成本计算唯一入口 |

**通用契约**：所有 `snapshot_*()` 返回的 Dictionary 必须满足「可直接入 `to_json` 序列化、无 `RefCounted` 对象、无跨域引用」；`restore_*()` 一律 `void` 且幂等（重复调用不产生副作用）——与既有 `WearableInventoryAggregate.snapshot/restore` 惯例对齐。

### 2. 配置化要求（零新增硬编码）

本卷修复均为**结构语义修复**，不引入新业务阈值；凡涉及既有可调参数（如 `respec/crystal_divisor`、gacha 概率档）一律继续走既有配置键，**不改动任何配置默认值**。阶段2 代码中的魔法值仅限：枚举/常量名、`0`/`1` 边界（属既有代码风格），不新增 `GameConfig` 表；若实现中发现「回挂槽位上限」「快照裁剪阈值」等确实需要参数化处，须先登记本细则追加段并经批准，严禁擅自造表。

### 3. 反序列化收敛收敛化（工程统一模式沉淀）

将 M9 的收敛写法沉淀为团队模式并在本卷注释中标注，供后续存档加载类代码套用：

```gdscript
# 反序列化收敛模式（Inv-TX-3）：
# 1) 单值下限收敛：maxi(0, raw)
# 2) 状态族序关系收敛：clampi(子态, 0, 父态)（如 unassigned ∈ [0, lifetime]）
# 3) 先收敛、后返回；收敛失败不回滚为默认值而是就近夹紧，保留可审计的存档脏数据现场
```

### 4. 依赖治理与文档同步

- 新增方法不得引入新 `preload` 跨层依赖；`restore_slots(snap, inventory)` 以参数注入方式接收 inventory（依赖注入，避免反向引用 `WearableInventoryAggregate`）。
- 本卷阶段1 的「快照面清单」小节作为工程资产，登记入口为后续案卷阶段1 的溯源指针；不另建独立文档文件（保持案卷目录 4 文件铁律）。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 3.1**: 实现前逐方法核对「零硬编码」——grep 新增代码块无裸数值/文案字面量
- [ ] **Step 3.2**: 为四个新增/改造方法补齐头注释（职责/时序铁律/调用方），注释密度对齐周边既有文件
- [ ] **Step 3.3**: 确认无新增跨域依赖方向（`file_dependencies` 复核 gacha/equipment_loadout/matter_disposal/potential_growth 四域）
- [ ] **Step 3.4**: 复核阶段1 快照面清单与实际代码一致（快照面归属矩阵逐行打勾）

---

## 三、 工程化验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-RO-S3-01` | 快照 DTO 纯数据可序列化 | 三快照对 JSON.stringify/parse 往返 | 深度等价，无对象引用泄漏 |
| `TC-RO-S3-02` | 恢复方法幂等 | 对同一快照连续调用两次 restore | 第二次无副作用、状态不变 |
| `TC-RO-S3-03` | 零新增硬编码 | `audit_hardcode` 全域扫描 | 本卷改动 0 违规字面量（基线 0 新增） |
| `TC-RO-S3-04` | 无新增跨域依赖 | `audit_arch` 架构护栏 | 领域拓扑与改造前一致，0 新增告警 |
| `TC-RO-S3-05` | 配置默认值零变更 | `git diff config/` | 无 config 文件改动 |
