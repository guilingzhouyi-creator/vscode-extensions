/**
 * Module: EditDynamics — Text Document Edit Dynamics & Mutation Velocity Analyzer
 * File Path: src/integration/edit-dynamics.ts
 * Architecture Role: Integration layer heuristic classifier differentiating manual keystrokes from AI/Agent bursts
 * Dependencies & Triggers: Consumed by ActivityWatcher during vscode.workspace.onDidChangeTextDocument
 * Responsibilities: Classify document change events based on mutation velocity, newline topology, dirty state, and burst windows
 * Exit Semantics & Design Rationale: Pure functional evaluator with zero VS Code host dependencies; supports 100% headless unit testing
 * Contract Invariant & Boundary: Deterministic classification into manual_keystroke, ai_burst, undo_redo, or empty; non-negative thresholds
 */

import {
    BURST_CHAR_COUNT_THRESHOLD,
    BURST_LINE_COUNT_THRESHOLD,
    SHORT_MULTILINE_CHAR_THRESHOLD,
    DEFAULT_AI_BURST_WINDOW_MS,
} from '../domain/models';

/** 抽象的文本变更切片（解耦 vscode.TextDocumentContentChangeEvent） */
export interface TextContentChangeLike {
    readonly text: string;
    readonly rangeLength: number;
}

/** 抽象的文档变更事件（解耦 vscode.TextDocumentChangeEvent） */
export interface DocumentChangeEventLike {
    readonly contentChanges: readonly TextContentChangeLike[];
    readonly isDocumentDirty?: boolean;
    readonly isForeground: boolean;
    readonly reason?: number;
}

/** 分类常量与联合类型（消除重复字面量） */
export const CLASSIFY_EMPTY = 'empty';
export const CLASSIFY_UNDO_REDO = 'undo_redo';
export const CLASSIFY_AI_BURST = 'ai_burst';
export const CLASSIFY_MANUAL = 'manual_keystroke';

export type EditClassification =
    | typeof CLASSIFY_EMPTY
    | typeof CLASSIFY_UNDO_REDO
    | typeof CLASSIFY_AI_BURST
    | typeof CLASSIFY_MANUAL;

/** 单键输入判定门限常数 */
const SINGLE_KEY_TEXT_MAX_LEN = 3;
const SINGLE_KEY_RANGE_MAX_LEN = 1;
const REASON_UNDO = 1;
const REASON_REDO = 2;

function isUndoRedo(reason?: number): boolean {
    return reason === REASON_UNDO || reason === REASON_REDO;
}

function isSingleKey(textLen: number, hasNewline: boolean, rangeLen: number): boolean {
    return (
        textLen <= SINGLE_KEY_TEXT_MAX_LEN &&
        !hasNewline &&
        rangeLen <= SINGLE_KEY_RANGE_MAX_LEN
    );
}

function hasBurstDimensions(textLen: number, rangeLen: number, hasNewline: boolean, text: string): boolean {
    if (textLen >= BURST_CHAR_COUNT_THRESHOLD || rangeLen >= BURST_CHAR_COUNT_THRESHOLD) {
        return true;
    }
    const lineCount = hasNewline ? text.split('\n').length : 1;
    if (lineCount >= BURST_LINE_COUNT_THRESHOLD) {
        return true;
    }
    return hasNewline && textLen >= SHORT_MULTILINE_CHAR_THRESHOLD;
}

/**
 * 契约算法：文本编辑动力学启发式分类器 (classifyTextDocumentChange)
 * 纯函数设计，无宿主副作用，确定性映射编辑事件到模式分类。
 *
 * @param event 待分类的文档编辑事件结构
 * @param lastExternalSignalGapMs 距离最近一次外部文件系统或 Agent 信号的时间差 (ms)
 * @returns 确定的分类标识
 */
export function classifyTextDocumentChange(
    event: DocumentChangeEventLike,
    lastExternalSignalGapMs: number,
): EditClassification {
    const changes = event.contentChanges;
    if (!changes || changes.length === 0) {
        return CLASSIFY_EMPTY;
    }

    if (isUndoRedo(event.reason)) {
        return CLASSIFY_UNDO_REDO;
    }

    if (changes.length > 1 || !event.isForeground || event.isDocumentDirty === false) {
        return CLASSIFY_AI_BURST;
    }

    const change = changes[0];
    const text = change.text ?? '';
    const textLen = text.length;
    const hasNewline = text.includes('\n');
    const rangeLen = change.rangeLength ?? 0;

    if (hasBurstDimensions(textLen, rangeLen, hasNewline, text)) {
        return CLASSIFY_AI_BURST;
    }

    if (!isSingleKey(textLen, hasNewline, rangeLen) && lastExternalSignalGapMs < DEFAULT_AI_BURST_WINDOW_MS) {
        return CLASSIFY_AI_BURST;
    }

    return CLASSIFY_MANUAL;
}
