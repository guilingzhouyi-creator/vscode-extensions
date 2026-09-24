/**
 * Module: Core Engine — Tree-Sitter Type Contracts
 * File Path: src/core/ast/tree-sitter-types.ts
 * Architecture Role: Minimal type declarations for tree-sitter CST nodes and parser bindings.
 * Dependencies & Triggers: Consumed by python-adapter, rust-adapter, and other CST bridges.
 * Responsibilities: Declare TreeSitterPoint, TreeSitterNode, TreeSitterTree, and TreeSitterParser.
 * Exit Semantics & Design Rationale: Type-only module with zero runtime overhead; avoids naked any
 *     in tree-sitter based language adapters without requiring external native type packages.
 */

/**
 * 0-based point coordinate reported by tree-sitter native positions.
 */
export interface TreeSitterPoint {
    /** 0-based line row number. */
    row: number;
    /** 0-based column index. */
    column: number;
}

/**
 * Concrete CST node shape emitted by tree-sitter parsers.
 */
export interface TreeSitterNode {
    /** Grammar node type name (e.g. 'function_definition', 'identifier'). */
    type: string;
    /** Raw source slice text spanned by this CST node. */
    text?: string;
    /** 0-based start byte index. */
    startIndex?: number;
    /** 0-based end byte index. */
    endIndex?: number;
    /** Start coordinate of the node. */
    startPosition: TreeSitterPoint;
    /** End coordinate of the node. */
    endPosition: TreeSitterPoint;
    /** Direct parent CST node in the hierarchy. */
    parent?: TreeSitterNode | null;
    /** All child CST nodes including unnamed syntax tokens. */
    children?: TreeSitterNode[];
    /** Named grammar children in lexical order. */
    namedChildren?: TreeSitterNode[];
    /**
     * Resolves a named syntax field child.
     *
     * @param fieldName - Field identifier defined in grammar.
     * @returns Matching child node or null when absent.
     */
    childForFieldName?(fieldName: string): TreeSitterNode | null;
}

/**
 * Parsed tree-sitter CST container.
 */
export interface TreeSitterTree {
    /** Top-level root node of the parsed CST. */
    rootNode: TreeSitterNode;
}

/**
 * Minimal interface of the native tree-sitter parser runtime.
 */
export interface TreeSitterParser {
    /**
     * Sets the active language grammar binding.
     *
     * @param lang - Native language module reference.
     */
    setLanguage(lang: unknown): void;

    /**
     * Parses the given source string into a CST tree.
     *
     * @param input - Source code content.
     * @returns Materialized tree-sitter tree.
     */
    parse(input: string): TreeSitterTree;
}
