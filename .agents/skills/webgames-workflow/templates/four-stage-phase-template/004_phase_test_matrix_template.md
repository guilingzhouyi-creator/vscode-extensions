# Phase {NN} 阶段4：全量回归验收与防复发门禁测试矩阵

> 档号: KALAR-DEV-2026-ST{NN}-004  
> 阶段: 阶段4（全量回归验收与防复发门禁测试矩阵）  
> 状态: 方案编写中 / 待评审  

---

## 一、 单元测试矩阵

归位目录：`tests/unit/domains/{domain_name}_test.gd`

| 用例 ID | 测试目标 | 输入条件 | 预期断言 |
| :--- | :--- | :--- | :--- |
| `TC-{NN}-001` | 基础状态流转 | 合法初始状态与动作 | 返回迁移成功且状态字段更新 |
| `TC-{NN}-002` | 边界与容错处理 | 非法载荷或缺少字段 | 拒绝执行并返回特定错误码 |
| `TC-{NN}-003` | 配置热重载适配 | 动态覆盖配置参数 | 计算逻辑即时按新参数生效 |

---

## 二、 验收指令

```bash
# 运行目标领域专属单测
bash WebGames/scripts/sh/test-run.sh --domain {domain_name}

# 运行全仓全量审查门禁
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```
