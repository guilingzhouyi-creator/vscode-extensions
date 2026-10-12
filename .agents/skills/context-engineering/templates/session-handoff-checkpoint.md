# 可重入会话交接检查点样板 (Session Handoff Checkpoint)

## 1. 已闭环落盘状态 (Completed & Verified State)
- **修改文件列表**：
  - `<path/to/file1>`
- **已通过自检断言**：
  - 构建与类型检查通过；
  - 领域静态规则与单元测试通过。

## 2. 下一原子任务契约 (Next Atomic Task)
- **目标模块**：`<path/to/next-module>`
- **刚性约束**：$\text{CC} \le 15, \text{Depth} \le 4$，循环内零瞬态堆分配（`CPX-SPACE-001`）。

## 3. 未决边界与风险项 (Open Risks & Decisions)
- `<记录待澄清或需跨模块验证的边界条件>`
