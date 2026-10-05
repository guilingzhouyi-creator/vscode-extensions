# vscode-extensions

> 个人开发与实验工作区 | Personal Development & Experimental Monorepo  
> 探索性项目 · 持续迭代 · 崩溃防丢 · 基础门禁  
> Exploratory Projects · Active Iteration · Crash Resilience · Baseline Gates

[![CI](https://github.com/guilingzhouyi-creator/vscode-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/guilingzhouyi-creator/vscode-extensions/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./workspace-timing/LICENSE)

> ⚠️ **说明 / Note**：  
> 本仓库主要用于个人日常工具开发、架构实验与原型演进。仓库内多数模块仍在持续摸索与未完成状态，接口与实现可能随日常开发随时调整，仅供个人练习与实验留痕。  
> *This repository serves as a personal workspace for daily utility development, architectural experiments, and ongoing prototypes. Most modules are works in progress and subject to change.*

---

## 📌 仓库收录 | Repository Scope

本仓库以 Monorepo 形式归纳了几个相对独立的个人项目，各自独立构建与运行，并共用基础的本地提交检查与 CI 流水线：

This monorepo groups several self-contained personal projects that build and run independently while sharing baseline commit checks and CI automation:

1. **[Workspace Timing](./workspace-timing)**：VS Code 工作区编码计时扩展（日常可用，持续微调）；  
   *A lightweight VS Code time-tracking extension for daily use.*
2. **[auto-refactor](./auto-refactor)**：代码分析与静态审查工具实验（独立 Node CLI，探索 TS 与 Rust 原生算子混合调用，大量功能尚在试验与完善中）；  
   *Experimental static code analysis and refactoring CLI, exploring TS + Rust native operators (in active experimentation).*
3. **[WebGames](./WebGames)**：基于 Godot 4.7 的游戏逻辑解耦原型（探索纯逻辑无头测试与配置驱动设计，处于早期开发阶段）；  
   *Early-stage Godot 4.7 game logic prototype exploring headless decoupling and data-driven configuration.*
4. **[架构蓝图](./docs/agent-native-system-blueprint.md)**：面向 AI/Agent 时代的自治体系、一体两面三层拓扑 Diff 与记忆提纯顶层设计案卷；  
   *Architecture blueprint for agent-native autonomous systems and multi-tier diff review pipelines.*

---

## 📦 项目概况 | Project Matrix

| 项目 | 类型 | 状态 | 涉及技术 | 简要说明 |
| :--- | :--- | :---: | :--- | :--- |
| **[Workspace Timing](./workspace-timing)** | VS Code 扩展<br/>*Extension* | `v0.5.0`<br/>日常维护 | TypeScript<br/>VS Code API | 记录编码时长，提供热力图、周上限健康提醒、多工作区聚合与四级崩溃安全存储，支持中英双语切换。 |
| **[auto-refactor](./auto-refactor)** | 静态分析 CLI<br/>*CLI Tool* | `v0.4.0`<br/>实验探索中 | Node.js / TS<br/>Rust (Crates) | 探索 TS 编排与 Rust 原生算子结合的静态检查工具，含差分、支配树与克隆检测实验，支持 SARIF 导出。 |
| **[WebGames](./WebGames)** | 游戏原型工程<br/>*Game Prototype* | `Godot 4.7`<br/>早期构建中 | GDScript<br/>JSON Config | 游戏世界逻辑原型，尝试将业务模型与画面表现彻底隔离，探索全域配置驱动与对象池复用。 |

---

## ⏱️ Workspace Timing（VS Code 插件）

### 🌟 功能特点 | Features

- ⏱ **自动计时** · Auto-timing：打开工作区后感知编码活动并开始计时，空闲与窗口失焦时自动暂停。
- 🎯 **周目标监控** · Weekly Limit：可设定周工作上限时间，面板中直观显示当前进度与健康提醒。
- 📊 **图表趋势** · Charts：提供近 7 天活跃柱状图与平滑曲线切换，直观查看时间节奏。
- 🔥 **12 周热力图** · Activity Heatmap：查看过去 12 周每日活跃度分布。
- ⏰ **24 小时活跃分布** · Hourly Breakdown：查看今日在各个时间槽的编码分布。
- 🌐 **多工作区聚合** · Cross-Workspace：在同一个面板查看不同项目的历史累计用时与占比。
- 🛡️ **数据防丢缓冲** · Crash Protection：内存时间片收集 + 实时日志追加 + 定时全量保存，异常关闭时不易丢失数据。
- 🌐 **双语界面** · Bilingual UI：支持跟随编辑器或在面板内手动切换中英文。
- 📤 **数据导出与还原** · Export & Restore：支持导出 CSV 明细及 JSON 备份恢复。

### 🗄️ 数据存储分层 | Storage

- **内存即时缓冲**：秒级时间片增量在内存中累加，减少对本地文件的频繁读写；
- **增量运行日志**：以轻量格式按间隔追加写入，供意外退出时启动回放；
- **全量快照持久化**：定时与退出时同步至本地 JSON 文件与全局状态；
- **全局跨项目索引**：统一记录历史各工作区的累计时间信息。

### 💻 常用命令 | Commands

| 命令 (Command) | 说明 (Description) |
| :--- | :--- |
| `workspaceTiming.openDashboard` | 打开统计与设置面板 (Open dashboard) |
| `workspaceTiming.enable` | 开启当前工作区计时 (Enable timing) |
| `workspaceTiming.disable` | 暂停当前工作区计时 (Disable timing) |
| `workspaceTiming.toggleStatusBar` | 切换状态栏显示格式 (Toggle status bar format) |
| `workspaceTiming.exportCsv` | 导出当前工作区记录为 CSV (Export CSV) |
| `workspaceTiming.restoreBackup` | 从本地备份文件还原数据 (Restore from backup) |

---

## 🔍 auto-refactor（代码分析与重构实验）

### 🎯 简要说明 | Overview

`auto-refactor` 是一个用于个人代码库探索的独立静态分析与重构辅助工具（Node CLI），不属于 VS Code 扩展。目前主要用于实验 TS 编排层与底层原生算子的配合，大量规则与功能仍在摸索和实验中。

*A standalone experimental CLI for static code analysis and refactoring explorations. Currently used to evaluate performance characteristics of mixed TS and native operators. Many features remain experimental.*

### ⚡ 双轨探索 | Dual-Track Architecture

- **TypeScript 编排**：负责 CLI 命令调用、基础调度、增量文件检查与 SARIF/JSON 输出转换；
- **Rust 原生算子实验（位于 `crates/`）**：
  - `ops-diff`：基于 SWAR 与 Bit-Parallel Myers 的文本差异比对实验；
  - `ops-graph`：支配树与环路探测算子；
  - `ops-mask`：基础文本与敏感词脱敏状态机；
  - `ops-clone`：基于 MinHash 的重复代码粗筛实验；
- **纯 TypeScript 回退实现**：提供纯 TS 回退代码，在无本地编译环境时保证可用。

> ℹ️ *注：本模块大多处于实验阶段，规则适用范围与分析深度仍在演变中。*

---

## 🎮 WebGames（Godot 4.7 原型探索）

### 🎯 简要说明 | Engine Prototype

基于 Godot 4.7 引擎搭建的游戏逻辑原型，主要目的是验证领域业务逻辑与表现层解耦的可行性。

*A gameplay prototype built on Godot 4.7, primarily exploring the feasibility of decoupled architecture between backend simulation logic and presentation views.*

### 🏛️ 实验方向 | Exploration Points

1. **逻辑解耦**：后端业务逻辑不依赖渲染节点，方便编写测试；表现层视图仅接收快照数据进行显示，不承担核心数值运算；
2. **配置驱动尝试**：尝试将参数与规则提取至外部 JSON 表（`config/` 目录），减少硬编码；
3. **对象复用**：高频使用的逻辑实体尝试接入对象池与状态重置，降低瞬态创建带来的开销；
4. **单元验证**：使用继承基础测试类的用例脚本来验证核心计算规则。

> ℹ️ *注：目前仅为原型骨架与基础机制验证，游戏内容与视觉表现仍在初步构建中。*

---

## 🛡️ 门禁与本地脚本 | Gates & Scripts

仓库配置了基础的本地脚本与检查机制，用于规范日常提交和维持基本代码整洁：

### 🧱 基本检查机制 | Baseline Checks

- **提交前检查 (`pre-commit`)**：检查是否有空文件、换行符格式（`ps1` 使用 CRLF，其余使用 LF）、敏感文件与基础语法；
- **提交说明检查 (`commit-msg`)**：要求提交说明保持结构清晰，标明原因与改动点；
- **自动化构建 (`CI`)**：通过 GitHub Actions 验证扩展能否正常打包并跑通已有用例。

### 🧰 常用脚本速查 | Script Reference

| 脚本文件 (Bash / PowerShell) | 用途说明 |
| :--- | :--- |
| `scripts/sh/audit-all.sh`<br/>`scripts/ps1/audit-all.ps1` | 执行全工作区基础自检与用例运行 |
| `scripts/sh/package.sh`<br/>`scripts/ps1/package.ps1` | 打包扩展为 `.vsix` 文件（支持 `-HotSync` 与 `-Install` 参数） |
| `scripts/sh/install-hooks.sh`<br/>`scripts/ps1/install-hooks.ps1` | 安装本地 Git 检查钩子 |

---

## 📁 目录结构 | Directory Layout

```
vscode-extensions/              ← 工作区根目录
├── .github/workflows/          ← CI 自动化构建配置
├── .githooks/                  ← 本地 Git 检查脚本
├── scripts/                    ← 共享辅助脚本（sh / ps1）
├── workspace-timing/           ← 【项目一】VS Code 编码计时扩展
│   ├── src/                    ← 扩展源码与分层实现
│   ├── tests/                  ← 单元测试
│   └── README.md               ← 扩展独立说明
├── auto-refactor/              ← 【项目二】静态分析与重构工具实验（Node CLI）
│   ├── crates/                 ← Rust 原生算子实验包
│   ├── src/                    ← TS 编排代码与分析器
│   └── scripts/                ← 验证与测试脚本
├── WebGames/                   ← 【项目三】Godot 4.7 原型工程
│   ├── backend/                ← 核心计算与领域模型
│   ├── frontend/               ← 视图表现层
│   └── config/                 ← 配置表文件
└── dist/                       ← 打包生成目录（已忽略）
```

---

## 🚀 本地开发 | Getting Started

### 1. 运行环境要求 | Requirements
- Node.js `>= 20`
- npm `>= 10`
- Git

### 2. 常用操作 | Common Commands

```bash
# 激活本地提交检查
bash scripts/sh/install-hooks.sh        # Linux / macOS
.\scripts\ps1\install-hooks.ps1         # Windows PowerShell

# 运行基础自检
bash scripts/sh/audit-all.sh            # Linux / macOS
.\scripts\ps1\audit-all.ps1             # Windows PowerShell
```

各子目录独立管理依赖，可进入对应目录使用常规的 `npm install` 与 `npm test` 进行开发。

---

## 🗺️ 现状与演进 | Current Status & Notes

- **Workspace Timing**：核心计时功能与本地报表基本成型，日常自用中，后续视需要增加云端多端同步与更多多维统计分析功能。
- **auto-refactor**：目前处于架构验证与算法探索阶段，部分算子与检查规则待进一步丰富与调优。
- **WebGames**：卡拉尔世界原型框架初步搭建，玩法与表现系统尚在早期试验，逐步补充中。

---

## 📄 许可证 | License

本项目采用 [MIT 许可证](./workspace-timing/LICENSE) 开源。  
Copyright (c) 2026 guilingzhouyi-creator
