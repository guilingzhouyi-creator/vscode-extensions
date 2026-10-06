# 阶段 4：全量回归验收与防复发门禁测试矩阵规范

> 档号: KALAR-DEV-ARCH-004  
> 阶段: 阶段 4（全量回归验收与防复发门禁测试矩阵）  
> 状态: 方案编写中 / 待评审  

---

## 一、 单元测试矩阵

归位目录：`tests/unit/domains/{domain_name}_test.gd`

| 用例 ID | 测试目标 | 输入条件 | 预期断言 |
| :--- | :--- | :--- | :--- |
| `TC-DOM-001` | 基础状态流转 | 合法初始状态与动作 | 返回迁移成功且状态字段更新 |
| `TC-DOM-002` | 边界与容错处理 | 非法载荷或缺少字段 | 拒绝执行并返回特定错误码 |
| `TC-DOM-003` | 配置热重载适配 | 动态覆盖配置参数 | 计算逻辑即时按新参数生效 |

---

## 二、 验收指令

```bash
# 1. 运行原生 Python 静态提取门禁（极速剥离引擎冷启动）
python WebGames/scripts/py/audit_arch_static.py

# 2. 运行目标领域专属单测
bash WebGames/scripts/sh/test-run.sh --domain {domain_name}

# 3. 运行全仓全量审查门禁
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```
