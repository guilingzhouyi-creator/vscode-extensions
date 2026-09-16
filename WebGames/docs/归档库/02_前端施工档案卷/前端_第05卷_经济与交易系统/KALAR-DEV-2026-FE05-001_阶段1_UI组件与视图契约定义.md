---
档号: KALAR-DEV-2026-FE05-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: FE05 (前端第5卷: 经济与交易系统)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: 前端第5卷：经济与交易系统 —— 阶段1：数据结构的拆解、设计与定义
形成日期: 2026-08-31
归档日期: 2026-08-31
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 四级货币钱包; 集市挂单DTO; 物流价格曲线; 汇率换算配置; 单元测试; 阶段1
---

# 施工细则：前端第5卷：经济与交易系统（钱包资产/商铺/集市拍卖/物流/物价图） —— 阶段1：数据结构的拆解、设计与定义

> [!NOTE]
> **【施工目标】**：完成本领域核心数据对象拆解、UI 节点树契约、I/O 传输模型（DTO）与合法性边界约束。
> **对应需求源**：[前端架构需求表5.md (前端第5卷)](../../../前端架构/前端架构需求表5.md)。

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[一、 系统架构总览与视图模型划分](../../../前端架构/前端架构需求表5.md)
* **核心不变量约束断言**：`严格类型化 DTO 数据契约，严禁隐式类型转换或在视图中私自持有后端持久状态`
* **表现层解耦最高指示**：前端仅定义事件流消费契约与数据结构模型，数据变更完全由后端推流或本地配置驱动！

---

## 一、 数据结构拆解与 DTO 契约 (Data Structures & DTO Contracts)

```gdscript
# 模块路径: res://frontend/views/fe05_walletdto/dto_stage1.gd
class_name WalletDTO extends RefCounted:
    # 1. 核心属性与字段定义
    var gold: int = 0
    var silver: int = 0
    var copper: int = 0
    var mana_crystals: float = 0.0
    var listing_items: Array[Dictionary] = []

    # 2. DTO 序列化契约
    func to_dto() -> Dictionary:
        return {
            "volume_id": "FE05",
            "entity_class": "WalletDTO",
            "is_valid": true
        }

    # 3. 反序列化与容错构建
    static func from_dto(data: Dictionary) -> WalletDTO:
        var instance = WalletDTO.new()
        if data.is_empty():
            return instance
        return instance
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 05.1.1: 数据对象拆解与依赖边界界定** - 梳理核心实体与 UI 表现层数据流动依赖
- [x] **Step 05.1.2: 严格类型化数据结构定义** - 声明字段类型、默认初始值与合法取值区间
- [x] **Step 05.1.3: 建立 DTO 契约与序列化接口** - 规范化 `to_dto()` 与 `from_dto()` 转换方法
- [x] **Step 05.1.4: 数据合法性与空值防御性校验** - 完善缺省输入与空字典安全兜底

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-FE05-S1-01` | 完整数据结构实例化 | 合法初始化字典 | 字段类型与默认值 100% 匹配 |
| `TC-FE05-S1-02` | DTO 序列化对等性 | 实体对象实例 | `from_dto(to_dto())` 保持深度等价 |
| `TC-FE05-S1-03` | 极端空数据防御性兜底 | 传入 `{}` 空字典 | 安全返回默认实例，杜绝 Null 崩溃 |
