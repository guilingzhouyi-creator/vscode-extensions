/**
 * Module: Core Codemod — Format & Indentation Preserver
 * File Path: src/core/codemod/format-preserver.ts
 * Architecture Role: Utility for maintaining indentation and line endings across codemod edits.
 * Dependencies & Triggers: Consumed by transform passes and TextEditApplier.
 * Responsibilities: Detect source line-ending styles and infer indentation levels from AST nodes.
 * Exit Semantics & Design Rationale: Deterministic string inspection with zero
 *   allocations on hot paths.
 */

/**
 * Line break style detected in source text.
 */
export type LineEndingStyle = '\n' | '\r\n';

/**
 * Utility class for inspecting and conforming textual formatting.
 */
export class FormatPreserver {
    /**
     * Detects the predominant newline convention of a text block.
     *
     * @param source - Original source code string.
     * @returns '\r\n' for CRLF or '\n' for LF.
     */
    public static detectLineEnding(source: string): LineEndingStyle {
        const crlfMatches = source.match(/\r\n/g);
        const crlfCount = crlfMatches ? crlfMatches.length : 0;
        const lfMatches = source.match(/[^\r]\n/g);
        const lfCount = lfMatches ? lfMatches.length : 0;
        return crlfCount > lfCount ? '\r\n' : '\n';
    }

    /**
     * Normalizes line breaks in generated text to target style.
     *
     * @param text - Text containing mixed or arbitrary line endings.
     * @param targetEnding - The target newline sequence to enforce.
     * @returns Text normalized with consistent line endings.
     */
    public static normalizeLineEndings(text: string, targetEnding: LineEndingStyle): string {
        return text.replace(/\r\n|\r|\n/g, targetEnding);
    }

    /**
     * Extracts the leading indentation string of a specific line.
     *
     * @param line - A single source code line.
     * @returns Leading whitespace prefix of the line.
     */
    public static getLineIndentation(line: string): string {
        const match = line.match(/^[\t ]*/);
        return match ? match[0] : '';
    }

    /**
     * Indents multi-line text to match a base indentation level.
     *
     * @param text - Multi-line string to indent.
     * @param baseIndent - Leading whitespace to prepend to every non-empty line.
     * @param targetEnding - Line ending style to apply.
     * @returns Uniformly indented text block.
     */
    public static indentBlock(
        text: string,
        baseIndent: string,
        targetEnding: LineEndingStyle = '\n',
    ): string {
        const lines = text.split(/\r\n|\r|\n/);
        return lines
            .map((line, index) => {
                if (line.trim().length === 0) {
                    return '';
                }
                return index === 0 ? line : baseIndent + line;
            })
            .join(targetEnding);
    }
}
