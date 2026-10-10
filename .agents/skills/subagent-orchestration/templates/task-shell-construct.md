[Task Scope & Zero-Intersection Path Jail]
- 授权独占文件列表（严格仅允许修改以下指定文件，严禁触碰任何其他文件）：
  1. <path/to/exclusive_file_1>
  2. <path/to/exclusive_file_2>
- 严禁触碰路径前缀（越界操作立即阻断）：
  - <forbidden/prefix/1/>
  - <forbidden/prefix/2/>

[Objective]
<请在此处详细说明本次增量开发或定点重构的具体目标、输入输出契约与设计意图>

[Quality & Discipline Checklist]
1. 物理卫生：严禁创建 0 字节物理空文件或遗留未实现占位符；
2. 复杂度控制：单函数圈复杂度 CC <= 15，控制流深度 Depth <= 4，单文件双轨体积 ELOC <= 900 / LOC <= 1400；
3. 空间优化：循环体内严禁动态编译正则或产生瞬态堆分配 (CPX-SPACE-001 / ADV-PRF-002)；
4. 注释规范：核心模块头部严格满足六字段 JSDoc 契约，零敏捷过程黑话，零幽灵空分支；
5. 债务红线：严禁引入任何 High/Critical 技术债务反弹，保持 0 项刚性基线。

[Pre-Delivery Verification]
完成改动后，在向主 Agent 汇报前必须自行在对应子目录下执行并通过以下本地验证命令：
  $ <local_verification_command_1>
  $ <local_verification_command_2>
