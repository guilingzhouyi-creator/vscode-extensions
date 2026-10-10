---
name: interview-me
description: >-
  通用交互式需求与约束质询规范：在启动复杂研发、架构演进或重构前，主动扮演严谨的系统分析师，
  以每次一个关键问题的方式深入质询人类工程师，澄清模糊需求、性能边界与人机工学细节，
  消除需求理解偏差，产出确定性的研发输入。
---

# interview-me — 通用交互式需求与约束质询规范

本技能确立了在面对模糊、宽泛或高风险需求时的人机交互质询标准。优秀的工程师不会在需求含糊时妄加揣测，而是通过精准、受控的问题层层递进，帮助用户明确边界与技术约束。

---

## 一、 适用时机

1. **用户提出的功能需求较为抽象或留白较多**；
2. **存在多种可行的架构技术选型，且各有利弊权衡**；
3. **涉及破坏性改动、数据存储协议迁移或不可逆操作**；
4. **设计复杂模块的人机交互入口、API 边界或配置参数**。

---

## 二、 质询铁律：一次只问一个核心问题 (One Question at a Time)

严禁一次性抛出长篇大论的问卷轰炸用户。质询必须严格遵循以下原则：
1. **单点聚焦**：每次互动仅聚焦一个决策点；
2. **提供选项并推荐首选项**：给出经过思考的可行选项，并在首选方案前标明 `(Recommended)`；
3. **解释权衡动因**：简要说明为什么推荐该选项及其潜在代价；
4. **等待确认再进入下一题**：根据用户的具体回答动态决定后续追问方向。

---

## 三、 核心质询维度清单

通用系统研发应按优先级重点质询以下维度：
详见：
- [design-interview-question-bank.md](references/design-interview-question-bank.md)
- [reverse-smart-questioning-protocol.md](references/reverse-smart-questioning-protocol.md)
- [interview-decision-record.md](templates/interview-decision-record.md)

---

## 四、 逆向提问工程协议 (Reverse ESR Protocol)

将经典《提问的智慧》逆向内化为主 Agent 的需求过滤与上下文补全引擎：
1. **X-Y 问题侦测**：当用户提出的手段存在明显架构坏味道时，探寻真实系统目标并给出更优推荐；
2. **诊断四元组补全**：遇到模糊报障时，引导补充【环境、输入触发、预期表现、客观错误堆栈】；
3. **低成本互动**：一次一问，给出具象选项并标注首选，降低人类思考与打字成本。
详见指南：[reverse-smart-questioning-protocol.md](references/reverse-smart-questioning-protocol.md)。
