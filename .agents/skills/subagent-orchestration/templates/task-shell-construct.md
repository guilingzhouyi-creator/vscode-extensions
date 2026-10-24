# SubAgent 双态任务外壳与可重入会话交接检查点样板

## 一、 写入态（Construct / Refactor）独占文件任务外壳

```markdown
[Task Scope & Zero-Intersection Path Jail]
- 独占文件列表 (Zero-Intersection Path Jail，严禁触碰列表外任何文件)：
  1. <path/to/exclusive_file_1>
  2. <path/to/exclusive_file_2>

[Objective]
<详细说明增量开发或定点重构的具体目标、输入输出契约与设计意图>

[Pre-Delivery Verification]
交割前必须执行并通过 System Contract Layer 4 规定的本地自检命令（构建 + 测试 + 静态规则三重闭环），确保全量通过且零 High/Critical 技术债务。
```

---

## 二、 只读态（Review / Explore）客观事实任务外壳

```markdown
[Task Scope & Zero-Intersection Path Jail]
- 权限与模式：只读审查模式（enable_write_tools: false，严禁创建或修改任何文件）

[Objective]
<说明静态审查或拓扑勘测的目标领域与比对基准，要求输出精确 file:line 与已登记规则 ID>

[Pre-Delivery Verification]
只读审查模式，严禁写操作；汇报时必须对照 System Contract Layer 4 提供纯客观文件路径、起始行号与质性技术依据。
```

---

## 三、 可重入会话与长程分卷交接检查点 (`mark_chapter`)

```markdown
## Chapter <N> Checkpoint: <章节标题>
- **已落盘验证文件**：`<path/to/file1>`, `<path/to/file2>`
- **已通过自检命令与断言**：`<command> -> PASS`
- **下一原子任务与前置不变式**：`<next_module>`（严守 CC <= 15 与循环零分配）
```
