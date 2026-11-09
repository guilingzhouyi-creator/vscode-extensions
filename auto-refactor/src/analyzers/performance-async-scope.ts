/**
 * Module: Performance — Lexical Async Scope Tracking
 * File Path: src/analyzers/performance-async-scope.ts
 * Architecture Role: Per-file lexical scope state used by the content performance analyzer.
 * Dependencies & Triggers: Position-preserving masked source; one scan per non-comment line.
 * Responsibilities: Track nested async bodies, pending signatures and indentation boundaries.
 * Exit Semantics & Design Rationale: Linear scanning without a second AST parse; this remains
 *     a lexical heuristic, not proof of language-level function execution or reachability.
 */
import { calculateIndent } from './performance-helpers';

const ASYNC_SIGNATURE_RE = /(?<![\w$])async\s+(?=function\b|def\b|func\b|\w+\s*(?:\(|=>)|\()/y;
const INDENT_ASYNC_RE = /\basync\s+(?:def|func)\b/;

/** Owns one file's scope stack and reuses transition storage between lines. */
export class PerformanceAsyncScope {
    private braceDepth = 0;
    private readonly asyncDepths: number[] = [];
    private readonly asyncIndents: number[] = [];
    private pendingSignature = false;
    private signatureParens = 0;
    private initiallyAsync = false;
    private readonly transitions: number[] = [];

    /** Scan masked syntax once; transitions preserve the context at each call column. */
    scanLine(masked: string, isIndentBased: boolean): void {
        this.transitions.length = 0;
        if (isIndentBased) {
            this.scanIndentLine(masked);
            return;
        }
        this.initiallyAsync = this.asyncDepths.length > 0;
        for (let column = 0; column < masked.length; column++) {
            const wasAsync = this.asyncDepths.length > 0;
            this.scanCharacter(masked, column);
            if (wasAsync !== (this.asyncDepths.length > 0)) {
                this.transitions.push(column + 1);
            }
        }
    }

    /** Query only after scanLine; columns refer to the same position-preserving masked line. */
    isAsyncAt(column: number): boolean {
        let active = this.initiallyAsync;
        for (const transition of this.transitions) {
            if (transition > column) break;
            active = !active;
        }
        return active;
    }

    private scanIndentLine(masked: string): void {
        if (masked.trim().length > 0) {
            const indent = calculateIndent(masked);
            while (
                this.asyncIndents.length > 0 &&
                this.asyncIndents[this.asyncIndents.length - 1] >= indent
            ) {
                this.asyncIndents.pop();
            }
            if (INDENT_ASYNC_RE.test(masked)) this.asyncIndents.push(indent);
        }
        this.initiallyAsync = this.asyncIndents.length > 0;
    }

    private scanCharacter(masked: string, column: number): void {
        const char = masked[column];
        if (char === 'a') {
            this.beginSignature(masked, column);
            return;
        }
        switch (char) {
            case '(':
                if (this.pendingSignature) this.signatureParens++;
                break;
            case ')':
                if (this.pendingSignature) this.signatureParens--;
                break;
            case ';':
                if (this.signatureParens === 0) this.pendingSignature = false;
                break;
            case '{':
                this.openBrace();
                break;
            case '}':
                this.closeBrace();
                break;
        }
    }

    private beginSignature(masked: string, column: number): void {
        ASYNC_SIGNATURE_RE.lastIndex = column;
        if (!ASYNC_SIGNATURE_RE.test(masked)) return;
        this.pendingSignature = true;
        this.signatureParens = 0;
    }

    private openBrace(): void {
        this.braceDepth++;
        if (!this.pendingSignature || this.signatureParens !== 0) return;
        this.asyncDepths.push(this.braceDepth);
        this.pendingSignature = false;
    }

    private closeBrace(): void {
        if (this.asyncDepths[this.asyncDepths.length - 1] === this.braceDepth) {
            this.asyncDepths.pop();
        }
        this.braceDepth = Math.max(0, this.braceDepth - 1);
    }
}
