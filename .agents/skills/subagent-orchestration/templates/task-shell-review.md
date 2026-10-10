[Task Scope & Path Jail]
- 授权只读审查范围：<allowed/prefix/1/>, <allowed/prefix/2/>
- 严禁触碰路径前缀：严格只读，禁止写入任何文件 (enable_write_tools: false)

[Objective]
<请在此处详细说明本次静态审查的目标领域、关注的潜在架构违规或比对基准>

[Quality & Discipline Checklist]
1. 纯只读姿态：严禁创建或修改任何生产代码、测试或配置文件；
2. 质性事实断言：审查意见必须给出具体文件路径、起始行号与客观违规事实；
3. 规则单源引用：涉及的规则代码必须在 rule-catalog.json (410 条规则) 中真实登记 (RCFG-RULE-DRIFT)；
4. 语言纪律：纯技术事实，严禁敏捷工期代号、敷衍词汇或主观夸大表达。

[Pre-Delivery Verification]
纯只读审查姿态，汇报前请再次确认所有审查结论均附带源码行号依据并核实规则编号真实性。
