---
档号: KALAR-DEV-2026-ST05-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST05 (Phase_09_物品UID体系)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_09_物品UID体系 —— 阶段1：物品UID数据契约与生成器
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: ItemUIDGenerator; 物品UID数据契约; 生成器; item_namespace_registry.json
---

# 施工细则：Phase 09 物品实例 UID 体系 —— 阶段1：物品UID数据契约与生成器

> [!NOTE]
> **【施工目标】**：新增物品实例级全局唯一 UID（跨进程/跨重启/可追溯），`ItemEntity.item_uid` 与现有原型三元组（`canonical_id/numeric_id/english_name`）职责分离，`item_id` 兼容迁移。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST05-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST05-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[item_registry_catalog.gd 三元组](..\..\..\..\..\backend\domains\item_namespace_registry\item_registry_catalog.gd) 与 [id_generator.gd 现状（仅进程内唯一）](..\..\..\..\..\backend\infrastructure\id_generator.gd)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST05-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST05-002_阶段2_全链路发放改造.md) ｜ [阶段3](KALAR-DEV-2026-ST05-003_阶段3_存档与统计及服务器发放预留.md) ｜ [阶段4](KALAR-DEV-2026-ST05-004_阶段4_安全与验收测试.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[item_registry_catalog.gd:20 三元组契约](..\..\..\..\..\backend\domains\item_namespace_registry\item_registry_catalog.gd) ｜ [item_entity.gd:20 item_id 现状](..\..\..\..\..\backend\domains\inventory\item_entity.gd)
* **核心不变量约束断言**：`UID 实例级唯一（同批无碰撞、重启不重复、跨前缀隔离）；UID 不改变原型三元组语义；旧档无 uid 可确定性迁移`。
* **防漂移最高指示**：严禁 UID 与 canonical_id/item_id 语义混用；严禁使用 Godot 全局随机（确定性优先）。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

```gdscript
# 模块路径: res://backend/domains/item_namespace_registry/item_uid_generator.gd
class_name ItemUIDGenerator extends RefCounted:
    # UID = <域前缀> + <单调计数 8 位> + <校验尾 2 位（确定性可复现）>
    # 前缀按发放来源隔离：GM_/CDK_/GAC_/MAIL_/SRV_（服务器发放）
    static func generate_uid(prefix: String) -> String: ...
    static func validate_uid(uid: String) -> bool: ... # 校验尾重算比对（防篡改）
    static func prefix_of(uid: String) -> String: ...  # 发放来源追溯

# 模块路径: res://backend/domains/inventory/item_entity.gd
var item_uid: String = ""  # 实例唯一标识（权威），item_id 保留兼容
static func migrate_legacy_uid(template_id: String, item_id: String) -> String: ... # 确定性派生
```

| 字段 | 类型 | 职责 | 变更 |
| :--- | :--- | :--- | :--- |
| `canonical_id` | String | 原型主键（类型身份） | 不变 |
| `numeric_id` | int | 压缩数字 ID（映射通道） | 不变 |
| `item_id` | String | 兼容实例 ID（进程内） | 保留，非权威 |
| `item_uid` | String | **实例全局唯一（权威/可追溯/幂等）** | 新增 |

---

## 二、 边界与合法性约束 (Validation Constraints)

| 约束字段 | 类型 | 边界范围 | 违规处理 |
| :--- | :--- | :--- | :--- |
| `uid` 前缀 | `String` | `^[A-Z]{2,6}_$` 白名单域前缀 | 非登记前缀拒绝生成 |
| `uid` 全长 | `String` | 配置 `uid/length`（默认 24） | 越界拒绝 |
| 单调计数 | `int` | 跨重启持久化（`uid/persistent_counter` 开关） | 重启后从落盘值续增 |

* **确定性**：计数递增 + 校验尾 `sha256(prefix+count).substr(0,2)`（可复现，禁全局随机）
* **配置**：`config/domains/item_namespace_registry.json:uid.{prefixes,length,persistent_counter}`

## 三、 验收矩阵 (DoD Matrix)

| 检验项 ID | 测试目标 | 上游真理约束指针 | 输入断言 | 预期输出断言 |
| :--- | :--- | :--- | :--- | :--- |
| `TC-P09-S1-01` | 同批唯一 | [item_registry_solver.gd（UID 待建于该域）](..\..\..\..\..\backend\domains\item_namespace_registry\item_registry_solver.gd) | 同前缀生成 10000 个 | 零碰撞 |
| `TC-P09-S1-02` | 重启不重复 | 持久化计数契约 | 计数落盘后重建生成器 | 新 UID > 旧最大值 |
| `TC-P09-S1-03` | 校验尾防篡改 | `validate_uid` | 篡改 UID 一位 | `false` |
| `TC-P09-S1-04` | 旧档迁移 | `migrate_legacy_uid` | 旧档 `item_id` 无 uid | 确定性派生且可复现 |
