---
name: typescript-guidelines
description: Strict TypeScript standards, advanced type modeling, generics, disciminated unions, narrowing, and zero-any type safety.
---

# TypeScript Development Standards & Type Safety Guide

## 1. Strict Type Safety & Zero Any Policy
- **No Implicit Any**: Enable `strict: true`, `noImplicitAny: true`, and `strictNullChecks: true` in `tsconfig.json`.
- **Prefer `unknown` over `any`**: Use `unknown` for unchecked external inputs, forcing explicit type narrowing or schema validation before usage.
- **Use `never` for Exhaustiveness**: Employ `never` type assertions in `switch` default cases to ensure complete pattern matching of unions.

## 2. Discriminated Unions & Algebraic Data Types
- **Tagged Enums / Types**: Structure polymorphic state using a common discriminant literal (e.g. `type State = { status: 'idle' } | { status: 'loading' } | { status: 'success', data: T }`).
- **Narrowing Guards**: Implement custom type guards (`function isError(val: unknown): val is Error`) for robust runtime type checking.

## 3. Generics & Utility Types
- **Constrain Generics**: Always use `extends` constraints on generic parameters (`<T extends Record<string, unknown>>`).
- **Built-in Utility Types**: Maximize usage of `Pick`, `Omit`, `Partial`, `Readonly`, `ReturnType`, and `Parameters` over duplicate interface declarations.
- **Template Literal Types**: Leverage template literal types (e.g. ``type Event = `${'user' | 'admin'}:${'login' | 'logout'}` ``) for expressive API contracts.

## 4. Code Organization & Declarations
- **Prefer `type` for Unions / Primitives, `interface` for Extensible Objects**: Use `interface` for declaration merging and public class contracts.
- **Readonly by Default**: Mark immutability with `readonly` properties and `as const` assertions to prevent accidental side effects.
