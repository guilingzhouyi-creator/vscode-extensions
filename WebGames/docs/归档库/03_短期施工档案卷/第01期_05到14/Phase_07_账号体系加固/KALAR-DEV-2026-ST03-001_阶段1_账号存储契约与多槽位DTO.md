---
档号: KALAR-DEV-2026-ST03-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST03 (Phase_07_账号体系加固)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_07_账号体系加固 —— 阶段1：账号存储契约与多槽位DTO
形成日期: 2026-08-31
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: AccountStorageDTO; SaveSlotSummaryDTO; account.json
---

# 施工细则：Phase 07 账号体系加固 —— 阶段1：账号存储契约与多槽位DTO

> [!NOTE]
> **【施工目标】**：定义账号存储契约、多角色槽位映射 DTO 及序列化/反序列化标准。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST03-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST03-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：[后端架构需求表14](../../../../后端架构/后端架构需求表14.md) 与 [账号域配置](..\..\..\..\..\config\domains\account.json)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST03-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST03-002_阶段2_登录鉴权与会话Token.md) ｜ [阶段3](KALAR-DEV-2026-ST03-003_阶段3_创建角色第一步后端存储联动.md) ｜ [阶段4](KALAR-DEV-2026-ST03-004_阶段4_安全与验收测试.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[一、 账号档案领域实体](../../../../后端架构/后端架构需求表14.md) ｜ [account.json 契约](..\..\..\..\..\config\domains\account.json)
* **核心不变量约束断言**：`单一账号下槽位编号严格在 [1, max_slots] 闭区间，槽位元数据与角色实体强绑定，账号 ID 全局唯一且不可变`。
* **防漂移最高指示**：严禁在 DTO 中引入易变业务逻辑；严禁硬编码默认槽位上限。

---

## 一、 数据结构与 DTO 契约 (Data Transfer Objects)

```gdscript
# 模块路径: res://backend/domains/account/account_storage_dto.gd
class_name AccountStorageDTO extends RefCounted:
    var account_id: String = ""
    var username: String = ""
    var created_at_unix: int = 0
    var last_login_unix: int = 0
    var active_slot_id: int = 1
    var slots: Array[Dictionary] = [] # Array of SaveSlotSummaryDTO dicts

    func to_dict() -> Dictionary:
        return {
            "account_id": account_id,
            "username": username,
            "created_at_unix": created_at_unix,
            "last_login_unix": last_login_unix,
            "active_slot_id": active_slot_id,
            "slots": slots.duplicate(true)
        }

    static func from_dict(data: Dictionary) -> AccountStorageDTO:
        var dto := AccountStorageDTO.new()
        dto.account_id = str(data.get("account_id", ""))
        dto.username = str(data.get("username", ""))
        dto.created_at_unix = int(data.get("created_at_unix", 0))
        dto.last_login_unix = int(data.get("last_login_unix", 0))
        dto.active_slot_id = int(data.get("active_slot_id", 1))
        var raw_slots: Array = data.get("slots", [])
        dto.slots = raw_slots.duplicate(true)
        return dto

class SaveSlotSummaryDTO extends RefCounted:
    var slot_id: int = 1
    var character_id: String = ""
    var character_name: String = ""
    var level: int = 1
    var race: String = ""
    var primary_class: String = ""
    var play_time_seconds: int = 0
    var is_permadeath: bool = false
    var is_alive: bool = true

    func to_dict() -> Dictionary:
        return {
            "slot_id": slot_id,
            "character_id": character_id,
            "character_name": character_name,
            "level": level,
            "race": race,
            "primary_class": primary_class,
            "play_time_seconds": play_time_seconds,
            "is_permadeath": is_permadeath,
            "is_alive": is_alive
        }

    static func from_dict(data: Dictionary) -> SaveSlotSummaryDTO:
        var dto := SaveSlotSummaryDTO.new()
        dto.slot_id = int(data.get("slot_id", 1))
        dto.character_id = str(data.get("character_id", ""))
        dto.character_name = str(data.get("character_name", ""))
        dto.level = int(data.get("level", 1))
        dto.race = str(data.get("race", ""))
        dto.primary_class = str(data.get("primary_class", ""))
        dto.play_time_seconds = int(data.get("play_time_seconds", 0))
        dto.is_permadeath = bool(data.get("is_permadeath", false))
        dto.is_alive = bool(data.get("is_alive", true))
        return dto
```

---

## 二、 字段级校验与约束规则

| 字段名 | 类型 | 范围 / 格式 | 违规处理策略 |
| :--- | :--- | :--- | :--- |
| `account_id` | `String` | 32位 UUID / 规范前缀 `ACC_` | 拒绝加载，标记数据损坏 |
| `active_slot_id` | `int` | `[1, GameConfig.get_int("domains.account", "storage/max_slots", 4)]` | 自动回退至第 1 槽位 |
| `slots` | `Array[Dictionary]` | 元素数 $\le$ `max_slots` | 截断超出槽位并记录审计日志 |
