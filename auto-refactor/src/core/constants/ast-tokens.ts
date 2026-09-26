/**
 * Module: Core Constants — AST and Language Grammar Tokens
 * File Path: src/core/constants/ast-tokens.ts
 * Architecture Role: Single source of truth for AST syntax kinds, parser grammar literals,
 *     and language identifiers across all language adapters and projectors.
 * Dependencies & Triggers: Zero external dependencies; imported by AST projectors,
 *     multilang adapters, symbol indexers, and analyzers.
 * Responsibilities: Centralize canonical string tokens for AST node types (ESTree / TypeScript
 *     / Oxc / Tree-sitter), primitive types, and canonical language identifiers.
 * Exit Semantics & Design Rationale: Pure string constants with zero runtime overhead;
 *     erased at compile-time when inlined by optimizer, preventing string drift and allocations.
 */

// ============================================================================
// Canonical Language Identifiers
// ============================================================================

export const LANG_TYPESCRIPT = 'typescript';
export const LANG_JAVASCRIPT = 'javascript';
export const LANG_PYTHON = 'python';
export const LANG_RUST = 'rust';
export const LANG_GDSCRIPT = 'gdscript';
export const LANG_GO = 'go';
export const LANG_SHELL = 'shell';
export const LANG_POWERSHELL = 'powershell';

/** Array of all officially supported language identifiers in the core engine. */
export const SUPPORTED_LANGUAGES = [
    LANG_TYPESCRIPT,
    LANG_JAVASCRIPT,
    LANG_PYTHON,
    LANG_RUST,
    LANG_GDSCRIPT,
    LANG_GO,
    LANG_SHELL,
    LANG_POWERSHELL,
] as const;

// ============================================================================
// Common AST Syntax Node Types (ESTree / TypeScript / Oxc / Universal)
// ============================================================================

export const AST_IDENTIFIER = 'Identifier';
export const AST_CALL_EXPRESSION = 'CallExpression';
export const AST_NEW_EXPRESSION = 'NewExpression';
export const AST_MEMBER_EXPRESSION = 'MemberExpression';
export const AST_PROPERTY_ACCESS_EXPRESSION = 'PropertyAccessExpression';
export const AST_PROPERTY = 'Property';

export const AST_FUNCTION_DECLARATION = 'FunctionDeclaration';
export const AST_FUNCTION_EXPRESSION = 'FunctionExpression';
export const AST_ARROW_FUNCTION = 'ArrowFunctionExpression';
export const AST_METHOD_DEFINITION = 'MethodDefinition';

export const AST_VARIABLE_DECLARATION = 'VariableDeclaration';
export const AST_VARIABLE_DECLARATOR = 'VariableDeclarator';

export const AST_CLASS_DECLARATION = 'ClassDeclaration';
export const AST_CLASS_EXPRESSION = 'ClassExpression';
export const AST_STRUCT_DECLARATION = 'StructDeclaration';
export const AST_INTERFACE_DECLARATION = 'InterfaceDeclaration';

export const AST_IMPORT_DECLARATION = 'ImportDeclaration';
export const AST_EXPORT_NAMED_DECLARATION = 'ExportNamedDeclaration';
export const AST_EXPORT_DEFAULT_DECLARATION = 'ExportDefaultDeclaration';

export const AST_IF_STATEMENT = 'IfStatement';
export const AST_BLOCK_STATEMENT = 'BlockStatement';
export const AST_RETURN_STATEMENT = 'ReturnStatement';
export const AST_THROW_STATEMENT = 'ThrowStatement';
export const AST_TRY_STATEMENT = 'TryStatement';
export const AST_CATCH_CLAUSE = 'CatchClause';

export const AST_FOR_STATEMENT = 'ForStatement';
export const AST_FOR_IN_STATEMENT = 'ForInStatement';
export const AST_FOR_OF_STATEMENT = 'ForOfStatement';
export const AST_WHILE_STATEMENT = 'WhileStatement';
export const AST_DO_WHILE_STATEMENT = 'DoWhileStatement';
export const AST_SWITCH_STATEMENT = 'SwitchStatement';

export const AST_BINARY_EXPRESSION = 'BinaryExpression';
export const AST_LOGICAL_EXPRESSION = 'LogicalExpression';
export const AST_UNARY_EXPRESSION = 'UnaryExpression';
export const AST_CONDITIONAL_EXPRESSION = 'ConditionalExpression';
export const AST_ASSIGNMENT_EXPRESSION = 'AssignmentExpression';

export const AST_LITERAL = 'Literal';
export const AST_STRING_LITERAL = 'StringLiteral';
export const AST_NUMERIC_LITERAL = 'NumericLiteral';
export const AST_BOOLEAN_LITERAL = 'BooleanLiteral';
export const AST_TEMPLATE_LITERAL = 'TemplateLiteral';
export const AST_ARRAY_EXPRESSION = 'ArrayExpression';
export const AST_OBJECT_EXPRESSION = 'ObjectExpression';

// ============================================================================
// Universal Primitive Types
// ============================================================================

export const PRIMITIVE_STRING = 'string';
export const PRIMITIVE_NUMBER = 'number';
export const PRIMITIVE_BOOLEAN = 'boolean';
export const PRIMITIVE_VOID = 'void';
export const PRIMITIVE_ANY = 'any';
export const PRIMITIVE_UNKNOWN = 'unknown';
export const PRIMITIVE_OBJECT = 'object';
export const PRIMITIVE_SYMBOL = 'symbol';
export const PRIMITIVE_UNDEFINED = 'undefined';
