---
name: debugging-and-error-recovery
description: >-
  系统化故障排查与自愈恢复规范：建立观察-假说-SSCCE探针隔离-最小修复-质性证明的五步科学排错流程。
  贯彻两次尝试受挫即停（Rule of 2）与 16 步滑动窗口死循环熔断法则，杜绝盲目修改破坏代码基线。
---

# debugging-and-error-recovery — 科学故障排查与自愈恢复规范

本技能规范了定位缺陷、构建 SSCCE 最小复现探针与安全实施修复的标准工作流，严禁盲目猜测或在生产代码中乱撞试错。

---

## 一、 科学排错五步法与 SSCCE 最小可复现哲学

```text
1. 观察现象 (Observe) ──▶ 2. 提出假说 (Hypothesize) ──▶ 3. SSCCE 探针隔离 (Isolate) ──▶ 4. 最小修复 (Fix) ──▶ 5. 质性证明 (Prove)
```

1. **观察与本地事实穷尽 (Grounded Pre-Investigation)**：收集完整报错堆栈与环境信息；向人类汇报前必须先查验模块六字段 JSDoc 契约、AST 调用栈与 Git 变更历史，呈现【环境版本、触发输入、期望行为、实测症状与已排除假说】四元事实组；
2. **SSCCE 最小完整可复现 (Short, Self-Contained, Correct Example)**：
   - **短小 ($\le 30$ 行)**：剥离无关业务包装，仅保留触发异常的最小代码切片；
   - **自给自足**：用内存桩替代真实 I/O，支持脱机秒级运行并 100% 稳定复现红灯；
   - **资产沉淀**：修复后直接将 SSCCE 脚本升级为防回归单元测试。

---

## 二、 刚性熔断：两次失败即停 (Rule of Two) 与长程死循环反思

1. **两次失败即停法则 (Rule of Two)**：
   同一缺陷连续 **2 次修复尝试未见成效**（测试仍红或引入新报错）时，必须**立即停止编码**，运行 `git diff` 清理无效试错改动，回归初始假说排查隐式前置依赖或环境问题，并以根因分析单向人类汇报；
2. **多步长程死循环振荡检测 ($k \le 16$ 滑动窗口)**：
   不仅拦截相邻单步振荡（$A \to B \to A$），在自愈流水线中维护深度至多 16 步的确定性状态哈希窗口；一旦检测到 $H_t = H_{t - \text{cycleLength}}$（如 $A \to B \to C \to A$），立即熔断机械重试并回退至上一级宏观方案。

---

## 三、 关联参考与模板资产

- [software-failure-modes.md](references/software-failure-modes.md)：通用系统故障谱系（初始化、IPC、并发竞态）、宿主扩展特化断点与 SSCCE 实操指南；
- [root-cause-analysis-template.md](templates/root-cause-analysis-template.md)：结构化缺陷根因分析与恢复记录单（RCA Template）。
