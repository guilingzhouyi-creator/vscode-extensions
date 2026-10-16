/**
 * Module: ThinkingAccordionLock — 分析过程手风琴互斥状态机与引用文本导出器
 * File Path: src/presentation/thinking-accordion-lock.ts
 * Architecture Role: Presentation layer collapsible section mutex state machine and quoted text exporter
 * Dependencies & Triggers: Consumed by analytical report views, AI thinking inspection panels, and session summary components
 * Responsibilities: Enforce isAnalyzing mutex lock (force expanded while analyzing, revoke collapse authority to prevent viewport height collapse); instantly relinquish folding control upon completion; export formatted Markdown blockquote text with bilingual headers
 * Exit Semantics & Design Rationale: Strict finite state machine guaranteeing viewport layout stability during active streaming while preserving user folding autonomy post-analysis
 */

import zhCN from '../i18n/zh-CN';
import en from '../i18n/en';

export interface ThinkingAccordionState {
    readonly isAnalyzing: boolean;
    readonly isExpanded: boolean;
    readonly isLocked: boolean;
    readonly content: string;
    readonly title: string;
}

export interface ThinkingAccordionOptions {
    /** 初始手风琴标题 */
    title?: string;
    /** 初始内容文本 */
    initialContent?: string;
    /** 初始是否处于分析进行中态（默认 false） */
    isAnalyzing?: boolean;
    /** 初始展开状态（若 isAnalyzing=true 则强制为 true） */
    initiallyExpanded?: boolean;
    /** 状态变更观察回调 */
    onStateChange?: (state: ThinkingAccordionState) => void;
}

export interface ExportQuoteOptions {
    /** 是否包含标题头部行（默认 true） */
    includeHeader?: boolean;
    /** 自定义头部前缀（若不指定则根据语言自动匹配） */
    customHeaderPrefix?: string;
    /** 语言字典代码（'zh-CN' | 'en'，默认 'zh-CN'） */
    locale?: 'zh-CN' | 'en';
    /** 是否清洗行尾多余连续空白行（默认 true） */
    cleanBlankLines?: boolean;
}

export class ThinkingAccordionLock {
    private isAnalyzingState: boolean = false;
    private isExpandedState: boolean = false;
    private contentState: string = '';
    private titleState: string = '';
    private readonly onStateChange?: (state: ThinkingAccordionState) => void;

    constructor(options?: ThinkingAccordionOptions) {
        this.titleState = options?.title ?? '';
        this.contentState = options?.initialContent ?? '';
        this.onStateChange = options?.onStateChange;

        const analyzing = Boolean(options?.isAnalyzing);
        if (analyzing) {
            this.isAnalyzingState = true;
            this.isExpandedState = true;
        } else {
            this.isAnalyzingState = false;
            this.isExpandedState = Boolean(options?.initiallyExpanded);
        }
    }

    /** 当前是否正在分析计算中 */
    public get isAnalyzing(): boolean {
        return this.isAnalyzingState;
    }

    /** 当前手风琴是否处于展开显示态 */
    public get isExpanded(): boolean {
        return this.isExpandedState;
    }

    /** 当前手风琴折叠权限是否被锁定（分析进行中强制锁定） */
    public get isLocked(): boolean {
        return this.isAnalyzingState;
    }

    /** 当前存储的分析文本内容 */
    public get content(): string {
        return this.contentState;
    }

    /** 手风琴标题 */
    public get title(): string {
        return this.titleState;
    }

    /** 获取当前状态机快照 */
    public getState(): ThinkingAccordionState {
        return {
            isAnalyzing: this.isAnalyzingState,
            isExpanded: this.isExpandedState,
            isLocked: this.isAnalyzingState,
            content: this.contentState,
            title: this.titleState,
        };
    }

    /**
     * 进入分析计算状态：强制锁定展开，物理剥夺折叠权限。
     *
     * @param initialContent 可选的初始分析内容
     */
    public startAnalyzing(initialContent?: string): void {
        this.isAnalyzingState = true;
        this.isExpandedState = true;
        if (initialContent !== undefined) {
            this.contentState = initialContent;
        }
        this.notifyState();
    }

    /**
     * 追加流式分析文本增量。
     *
     * @param chunk 追加的内容文本块
     */
    public appendContent(chunk: string): void {
        if (!chunk) return;
        this.contentState += chunk;
        this.notifyState();
    }

    /**
     * 完整替换分析文本内容。
     *
     * @param content 完整内容
     */
    public setContent(content: string): void {
        this.contentState = content;
        this.notifyState();
    }

    /**
     * 设置手风琴标题。
     *
     * @param title 标题文本
     */
    public setTitle(title: string): void {
        this.titleState = title;
        this.notifyState();
    }

    /**
     * 完成分析过程：瞬时交还折叠控制权，保持当前展开态供人类检阅。
     *
     * @param finalContent 可选的最终完整内容覆盖
     */
    public finishAnalyzing(finalContent?: string): void {
        this.isAnalyzingState = false;
        if (finalContent !== undefined) {
            this.contentState = finalContent;
        }
        this.notifyState();
    }

    /**
     * 切换展开/折叠状态。
     * 若处于分析锁定中（isAnalyzing=true），强制拦截操作并拒绝折叠，防止视口剧烈坍缩。
     *
     * @returns 是否成功执行了状态切换（若被锁定拦截则返回 false）
     */
    public toggle(): boolean {
        if (this.isAnalyzingState) {
            return false;
        }
        this.isExpandedState = !this.isExpandedState;
        this.notifyState();
        return true;
    }

    /**
     * 尝试展开手风琴。
     *
     * @returns 展开后的状态（始终为 true）
     */
    public expand(): boolean {
        if (this.isExpandedState) return true;
        this.isExpandedState = true;
        this.notifyState();
        return true;
    }

    /**
     * 尝试折叠手风琴。
     * 若分析进行中则拒绝折叠。
     *
     * @returns 是否成功折叠
     */
    public collapse(): boolean {
        if (this.isAnalyzingState) {
            return false;
        }
        if (!this.isExpandedState) return true;
        this.isExpandedState = false;
        this.notifyState();
        return true;
    }

    /**
     * 导出格式化 Markdown 引用文本。
     * 为每一行文本注入标准 Markdown blockquote 前缀 `> `，支持双语规范头部与多余空白行清洗。
     *
     * @param options 引用导出参数配置
     * @returns 格式化后的引用文本字符串
     */
    public exportQuotedText(options?: ExportQuoteOptions): string {
        const includeHeader = options?.includeHeader ?? true;
        const locale = options?.locale ?? 'zh-CN';
        const cleanBlank = options?.cleanBlankLines ?? true;

        const headerLine = this.buildHeaderLine(includeHeader, locale, options?.customHeaderPrefix);
        const bodyLines = this.buildQuotedBody(this.contentState, cleanBlank);

        if (!headerLine) {
            return bodyLines;
        }
        if (!bodyLines) {
            return headerLine;
        }
        return `${headerLine}\n${bodyLines}`;
    }

    private buildHeaderLine(
        includeHeader: boolean,
        locale: 'zh-CN' | 'en',
        customPrefix?: string
    ): string {
        if (!includeHeader) return '';
        if (customPrefix) {
            return `> ${customPrefix}${this.titleState ? ` — ${this.titleState}` : ''}`;
        }
        const dict = locale === 'zh-CN' ? zhCN : en;
        const defaultPrefix = dict['accordion.thinking.header'];
        return `> ${defaultPrefix}${this.titleState ? ` — ${this.titleState}` : ''}`;
    }

    private buildQuotedBody(rawContent: string, cleanBlank: boolean): string {
        if (!rawContent) return '';
        const rawLines = rawContent.split(/\r?\n/);
        const result: string[] = [];
        let consecutiveBlank = 0;

        for (let i = 0; i < rawLines.length; i++) {
            const trimmed = rawLines[i].trim();
            if (trimmed.length === 0) {
                consecutiveBlank++;
                if (cleanBlank && consecutiveBlank > 1) {
                    continue;
                }
                result.push('>');
            } else {
                consecutiveBlank = 0;
                result.push(`> ${rawLines[i]}`);
            }
        }

        return result.join('\n');
    }

    private notifyState(): void {
        this.onStateChange?.(this.getState());
    }
}
