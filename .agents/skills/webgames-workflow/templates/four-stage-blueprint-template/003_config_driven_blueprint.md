# 阶段 3：全域配置驱动与泛化路由接入规范

> 档号: KALAR-DEV-ARCH-003  
> 阶段: 阶段 3（全域配置驱动与泛化路由接入）  
> 状态: 方案编写中 / 待评审  

---

## 一、 领域配置表路径与 Schema

配置表规范归位路径：`config/domains/{domain_name}/core.json`

```json
{
  "domain": "{domain_name}",
  "version": "1.0.0",
  "parameters": {
    "default_rate": 1.5,
    "max_capacity": 100
  }
}
```

---

## 二、 `GameConfig` 读取与热重载路由

```gdscript
# 通过统一入口读取配置，严禁根目录平铺或硬编码
var rate: float = GameConfig.get_value("{domain_name}.parameters.default_rate", 1.0)
var cap: int = GameConfig.get_value("{domain_name}.parameters.max_capacity", 50)
```
