# vscode-extensions 🛠

> 我的 VS Code 插件集合 | My VS Code extensions monorepo
> 轻量化 · 高可扩展 · 双语支持 · 崩溃安全

---

## 📌 仓库定位 | Scope

本仓库**仅收录 VS Code 插件**相关代码与文档。

> ⚠️ **Windows 工具链**（PowerShell 脚本、环境配置、桌面工具等）属于**另一条独立线**，不在本仓库内混放。请移步对应的 Windows 项目仓库。
>
> 两侧的**路线图**统一在下方 [🗺️ 路线图 Roadmap](#-路线图-roadmap) 中管理，便于整体规划，但**代码与文档**严格按板块区分存放。

---

## 📦 插件列表 | Extensions

| 插件 | 版本 | 状态 | 简介 |
|------|------|:--:|------|
| **[Workspace Timing](./workspace-timing)** | v0.1.0 | 🟢 已发布 | ⏱ 轻量化工作区时长追踪：自动计时、跨工作区聚合、周报图表、仪表板、日/累计分离；环形缓冲区 + Journal 双写入，崩溃保护 |

---

## 📁 目录结构 | Structure

```
vscode-extensions/              ← 本仓库（VS Code 插件专用）
├── workspace-timing/           ← 工作区时长追踪
│   ├── src/
│   │   ├── application/        ← 应用业务逻辑
│   │   ├── cache/              ← 缓存层（10 秒异步刷盘）
│   │   ├── domain/             ← 领域模型（RingBuffer、Timer、Journal）
│   │   ├── i18n/               ← 国际化（zh-CN / en）
│   │   ├── integration/        ← VS Code API 集成 + 命令注册
│   │   ├── persistence/        ← 持久化层（Journal + JSON + GlobalState）
│   │   └── presentation/       ← 表现层（Dashboard + StatusBar + Toast）
│   ├── package.json
│   ├── README.md
│   └── LICENSE
└── (future extensions...)      ← 更多插件即将加入
```

---

## 🗺️ 路线图 Roadmap

> 规划分**两条线**：`🧊 Windows 工具链` 与 `🧩 VS Code 插件`。两线互不混放，分别跟踪各自进度。

### 🧩 VS Code 插件线（本仓库）

| 阶段 | 目标 | 状态 |
|------|------|:--:|
| ✅ v0.1.0 | **Workspace Timing** 首个插件发布（计时 + 周报 + 崩溃保护） | 已完成 |
| 🚧 v0.2.0 | **Workspace Timing** 迭代：CSV 导出 ✅、云端同步占位 ✅、多工作区对比 ✅ | 功能完成 |
| 🎯 下一插件 | **待定选题**（见下方「下一步规划」） | 规划中 |

### 🧊 Windows 工具链线（独立仓库）

| 阶段 | 目标 | 状态 |
|------|------|:--:|
| 📝 规划 | PowerShell 脚本 / 环境配置 / 桌面工具整理，独立成仓 | 待启动 |

> 💡 Windows 与 VS Code 插件分线维护：**文档不混放、代码不混仓、进度各表**，但统一在本 README 的路线图中总览。

---

## 🚀 下一步规划 | Next Steps

**准备下一个 VS Code 插件的开发**。候选方向（按可复用性 & 与现有扩展协同性排序）：

1. **💾 文件同步助手** — 基于 `workspace-timing` 的 i18n / 持久化 / 五层架构模板快速起步。
2. **🔍 代码片段增强** — 复用现有 `RingBuffer` + Journal 设计经验。
3. **🧩 与 Windows 工具链联动的插件** — 在 VS Code 内调用 Windows 侧能力（需先落地 Windows 线）。

> 📐 新插件统一遵循本仓既有规范：**TypeScript · 五层分层 · zh-CN/en 双语 · 崩溃安全**。

---

## 🔧 技术栈 | Tech Stack

- **语言**：TypeScript
- **目标**：VS Code ≥ 1.85.0
- **架构**：五层分层（Domain → Cache → Persistence → Application → Presentation）
- **存储**：RingBuffer(1024) → Journal(NDJSON) → FullSave(JSON) 三级写入
- **国际化**：i18n 模块，zh-CN / en 双语
- **跨工作区**：ExtensionContext.globalState 全局聚合

---

## 📝 开发 | Development

```bash
# 克隆
git clone https://cnb.cool/OriginalTC/vscode-extensions.git
cd vscode-extensions/workspace-timing

# 安装依赖
npm install

# 编译
npm run compile

# 打包
vsce package
```

---

## 📄 许可证 | License

MIT © 2026 OriginalTC
