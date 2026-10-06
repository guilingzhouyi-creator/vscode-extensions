# 阶段 1：数据契约与实体定义规范

> 档号: KALAR-DEV-ARCH-001  
> 阶段: 阶段 1（数据契约与实体定义）  
> 状态: 方案编写中 / 待评审  

---

## 一、 领域数据契约与 DTO 规范

定义本模块涉及的核心实体字典与强类型字段，严禁使用非类型化弱字典：

| 实体名 | 字段名 | 类型 | 约束 / 范围 | 业务含义 |
| :--- | :--- | :--- | :--- | :--- |
| `ItemEntity` | `id` | `String` | 非空，kebab-case | 物品唯一标识 |
| `ItemEntity` | `amount` | `int` | $\ge 0$ | 堆叠数量 |

---

## 二、 快照与持久化 Schema 定义

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "amount"],
  "properties": {
    "id": { "type": "string" },
    "amount": { "type": "integer", "minimum": 0 }
  }
}
```
