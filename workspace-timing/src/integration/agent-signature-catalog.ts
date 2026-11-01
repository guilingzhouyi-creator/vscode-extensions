/**
 * Module: AgentSignatureCatalog — Ecosystem Agent Signatures & Path Matcher
 * File Path: src/integration/agent-signature-catalog.ts
 * Architecture Role: Integration layer catalog defining filesystem signatures for AI agents and build ignores
 * Dependencies & Triggers: Consumed by ActivityWatcher during file system and text document event filtering
 * Responsibilities: Detect agent-native directories, task transcripts, instruction files, and filter build artifacts
 * Exit Semantics & Design Rationale: Centralized regular expressions and helper predicates; zero I/O side effects
 * Contract Invariant & Boundary: Deterministic regex matching; agent patterns strictly override generic ignore patterns
 */

/** 排除的文件路径正则（忽略包依赖、Git 底层对象、编译产物与测试覆盖率） */
const IGNORED_PATH_REGEX =
    /[/\\](node_modules|\.git[/\\]objects|dist|out|build|\.vscode-test|coverage)($|[/\\])/i;

/**
 * 智能体与自动化工具特征路径正则（命中时属 100% 确认的 AI/Agent 协作信号）
 * 涵盖：Google Antigravity, Claude Code, Cursor, Cline, Roo Code, Aider, Continue, Copilot, Windsurf 等
 */
const AGENT_PATH_REGEX =
    /[/\\](\.agents|\.gemini|\.claude|\.cursor|\.cline|\.roomodes|\.continue|\.codeium|scratch|\.refactor-trajectory)($|[/\\])|(\.cursorrules|\.cursorignore|\.clinerules|CLAUDE\.md|transcript.*\.jsonl|\.aider.*|\.github[/\\]copilot-instructions\.md|\.(patch|diff))$/i;

/**
 * 判定指定的文件路径是否包含已知 AI Agent 签名或伴生痕迹
 * @param fsPath 文件绝对或相对路径
 * @returns 命中特征返回 true
 */
export function isAgentSignaturePath(fsPath: string): boolean {
    return !fsPath ? false : AGENT_PATH_REGEX.test(fsPath);
}

/**
 * 判定给定的文件路径是否属于应被忽略的目录
 * 不变量：只要命中 Agent 特征路径，强制放行，绝不忽略。
 * @param fsPath 文件绝对或相对路径
 * @returns 是否应被忽略
 */
export function isPathIgnored(fsPath: string): boolean {
    if (!fsPath) return false;
    return isAgentSignaturePath(fsPath) ? false : IGNORED_PATH_REGEX.test(fsPath);
}
