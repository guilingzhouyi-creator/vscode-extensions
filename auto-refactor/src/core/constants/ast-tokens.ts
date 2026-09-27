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

/** Canonical Typescript language identifier. */
export const LANG_TYPESCRIPT = 'typescript';
/** Canonical Javascript language identifier. */
export const LANG_JAVASCRIPT = 'javascript';
/** Canonical Python language identifier. */
export const LANG_PYTHON = 'python';
/** Canonical Rust language identifier. */
export const LANG_RUST = 'rust';
/** Canonical Gdscript language identifier. */
export const LANG_GDSCRIPT = 'gdscript';
/** Canonical Go language identifier. */
export const LANG_GO = 'go';
/** Canonical Shell language identifier. */
export const LANG_SHELL = 'shell';
/** Canonical Powershell language identifier. */
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

/** AST syntax node identifier for IDENTIFIER. */
export const AST_IDENTIFIER = 'Identifier';
/** AST syntax node identifier for CALL_EXPRESSION. */
export const AST_CALL_EXPRESSION = 'CallExpression';
/** AST syntax node identifier for NEW_EXPRESSION. */
export const AST_NEW_EXPRESSION = 'NewExpression';
/** AST syntax node identifier for MEMBER_EXPRESSION. */
export const AST_MEMBER_EXPRESSION = 'MemberExpression';
/** AST syntax node identifier for PROPERTY_ACCESS_EXPRESSION. */
export const AST_PROPERTY_ACCESS_EXPRESSION = 'PropertyAccessExpression';
/** AST syntax node identifier for PROPERTY. */
export const AST_PROPERTY = 'Property';

/** AST syntax node identifier for FUNCTION_DECLARATION. */
export const AST_FUNCTION_DECLARATION = 'FunctionDeclaration';
/** AST syntax node identifier for FUNCTION_EXPRESSION. */
export const AST_FUNCTION_EXPRESSION = 'FunctionExpression';
/** AST syntax node identifier for ARROW_FUNCTION. */
export const AST_ARROW_FUNCTION = 'ArrowFunctionExpression';
/** AST syntax node identifier for METHOD_DEFINITION. */
export const AST_METHOD_DEFINITION = 'MethodDefinition';

/** AST syntax node identifier for VARIABLE_DECLARATION. */
export const AST_VARIABLE_DECLARATION = 'VariableDeclaration';
/** AST syntax node identifier for VARIABLE_DECLARATOR. */
export const AST_VARIABLE_DECLARATOR = 'VariableDeclarator';

/** AST syntax node identifier for CLASS_DECLARATION. */
export const AST_CLASS_DECLARATION = 'ClassDeclaration';
/** AST syntax node identifier for CLASS_EXPRESSION. */
export const AST_CLASS_EXPRESSION = 'ClassExpression';
/** AST syntax node identifier for STRUCT_DECLARATION. */
export const AST_STRUCT_DECLARATION = 'StructDeclaration';
/** AST syntax node identifier for INTERFACE_DECLARATION. */
export const AST_INTERFACE_DECLARATION = 'InterfaceDeclaration';

/** AST syntax node identifier for IMPORT_DECLARATION. */
export const AST_IMPORT_DECLARATION = 'ImportDeclaration';
/** AST syntax node identifier for EXPORT_NAMED_DECLARATION. */
export const AST_EXPORT_NAMED_DECLARATION = 'ExportNamedDeclaration';
/** AST syntax node identifier for EXPORT_DEFAULT_DECLARATION. */
export const AST_EXPORT_DEFAULT_DECLARATION = 'ExportDefaultDeclaration';

/** AST syntax node identifier for IF_STATEMENT. */
export const AST_IF_STATEMENT = 'IfStatement';
/** AST syntax node identifier for BLOCK_STATEMENT. */
export const AST_BLOCK_STATEMENT = 'BlockStatement';
/** AST syntax node identifier for RETURN_STATEMENT. */
export const AST_RETURN_STATEMENT = 'ReturnStatement';
/** AST syntax node identifier for THROW_STATEMENT. */
export const AST_THROW_STATEMENT = 'ThrowStatement';
/** AST syntax node identifier for TRY_STATEMENT. */
export const AST_TRY_STATEMENT = 'TryStatement';
/** AST syntax node identifier for CATCH_CLAUSE. */
export const AST_CATCH_CLAUSE = 'CatchClause';

/** AST syntax node identifier for FOR_STATEMENT. */
export const AST_FOR_STATEMENT = 'ForStatement';
/** AST syntax node identifier for FOR_IN_STATEMENT. */
export const AST_FOR_IN_STATEMENT = 'ForInStatement';
/** AST syntax node identifier for FOR_OF_STATEMENT. */
export const AST_FOR_OF_STATEMENT = 'ForOfStatement';
/** AST syntax node identifier for WHILE_STATEMENT. */
export const AST_WHILE_STATEMENT = 'WhileStatement';
/** AST syntax node identifier for DO_WHILE_STATEMENT. */
export const AST_DO_WHILE_STATEMENT = 'DoWhileStatement';
/** AST syntax node identifier for SWITCH_STATEMENT. */
export const AST_SWITCH_STATEMENT = 'SwitchStatement';

/** AST syntax node identifier for BINARY_EXPRESSION. */
export const AST_BINARY_EXPRESSION = 'BinaryExpression';
/** AST syntax node identifier for LOGICAL_EXPRESSION. */
export const AST_LOGICAL_EXPRESSION = 'LogicalExpression';
/** AST syntax node identifier for UNARY_EXPRESSION. */
export const AST_UNARY_EXPRESSION = 'UnaryExpression';
/** AST syntax node identifier for CONDITIONAL_EXPRESSION. */
export const AST_CONDITIONAL_EXPRESSION = 'ConditionalExpression';
/** AST syntax node identifier for ASSIGNMENT_EXPRESSION. */
export const AST_ASSIGNMENT_EXPRESSION = 'AssignmentExpression';

/** AST syntax node identifier for LITERAL. */
export const AST_LITERAL = 'Literal';
/** AST syntax node identifier for STRING_LITERAL. */
export const AST_STRING_LITERAL = 'StringLiteral';
/** AST syntax node identifier for NUMERIC_LITERAL. */
export const AST_NUMERIC_LITERAL = 'NumericLiteral';
/** AST syntax node identifier for BOOLEAN_LITERAL. */
export const AST_BOOLEAN_LITERAL = 'BooleanLiteral';
/** AST syntax node identifier for TEMPLATE_LITERAL. */
export const AST_TEMPLATE_LITERAL = 'TemplateLiteral';
/** AST syntax node identifier for ARRAY_EXPRESSION. */
export const AST_ARRAY_EXPRESSION = 'ArrayExpression';
/** AST syntax node identifier for OBJECT_EXPRESSION. */
export const AST_OBJECT_EXPRESSION = 'ObjectExpression';

// ============================================================================
// Universal Primitive Types
// ============================================================================

/** Canonical constant token for PRIMITIVE_STRING. */
export const PRIMITIVE_STRING = 'string';
/** Canonical constant token for PRIMITIVE_NUMBER. */
export const PRIMITIVE_NUMBER = 'number';
/** Canonical constant token for PRIMITIVE_BOOLEAN. */
export const PRIMITIVE_BOOLEAN = 'boolean';
/** Canonical constant token for PRIMITIVE_VOID. */
export const PRIMITIVE_VOID = 'void';
/** Canonical constant token for PRIMITIVE_ANY. */
export const PRIMITIVE_ANY = 'any';
/** Canonical constant token for PRIMITIVE_UNKNOWN. */
export const PRIMITIVE_UNKNOWN = 'unknown';
/** Canonical constant token for PRIMITIVE_OBJECT. */
export const PRIMITIVE_OBJECT = 'object';
/** Canonical constant token for PRIMITIVE_SYMBOL. */
export const PRIMITIVE_SYMBOL = 'symbol';
/** Canonical constant token for PRIMITIVE_UNDEFINED. */
export const PRIMITIVE_UNDEFINED = 'undefined';
