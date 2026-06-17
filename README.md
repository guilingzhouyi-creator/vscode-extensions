# vscode-extensions 🛠

> 我的 VS Code 插件集合 | My VS Code extensions monorepo  
> 轻量化 · 高可扩展 · 双语支持 · 崩溃安全

---

## 📦 插件列表 | Extensions

| 插件 | 版本 | 状态 | 简介 |
|------|------|:--:|------|
| **[Workspace Timing](./workspace-timing)** | v0.1.0 | 🟢 已发布 | ⏱ 跨工作区时长追踪，环形缓冲区 + Journal 双写入，崩溃保护，周报图表 |

---

## 📁 目录结构 | Structure

```
vscode-extensions/
├── workspace-timing/          ← 工作区时长追踪
│   ├── src/
│   │   ├── application/       ← 应用业务逻辑
│   │   ├── cache/             ← 缓存层（10 秒异步刷盘）
│   │   ├── domain/            ← 领域模型（RingBuffer、Timer、Journal）
│   │   ├── i18n/              ← 国际化（zh-CN / en）
│   │   ├── integration/       ← VS Code API 集成 + 命令注册
│   │   ├── persistence/       ← 持久化层（Journal + JSON + GlobalState）
│   │   └── presentation/      ← 表现层（Dashboard + StatusBar + Toast）
│   ├── package.json
│   ├── README.md
│   └── LICENSE
└── (future extensions...)     ← 更多插件即将加入
```

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
git clone https://github.com/guilingzhouyi-creator/vscode-extensions.git
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

MIT © 2026 guilingzhouyi-creator
