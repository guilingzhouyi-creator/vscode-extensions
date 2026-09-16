---
name: react-best-practices
description: Golden rules of React development covering modern Hooks usage, state management, re-render optimization, custom hooks, and concurrent features.
---

# React Best Practices & Architecture Guide

## 1. Modern Hooks & State Architecture
- **Single Source of Truth**: Avoid duplicating state derived from existing props or state. Compute derived values during render.
- **Lifting State & Composition**: Lift state only as high as necessary. Favor component composition over deep prop drilling or redundant global state.
- **Reducer for Complex State**: Use `useReducer` or state machines for complex transitions involving multiple related state variables.

## 2. Re-render Optimization
- **Stable References**: Use `useCallback` and `useMemo` intentionally when passing callbacks or heavy computed objects to memoized children (`React.memo`).
- **Granular Subscriptions**: When using global state managers (Zustand, Redux), select minimal state slices (`useStore(state => state.user.name)`) to prevent full-tree re-renders.
- **Avoid Object Literals in JSX Props**: Do not pass inline new objects/arrays to memoized components unless wrapped in `useMemo`.

## 3. Custom Hooks Design
- **Single Responsibility**: Encapsulate reusable stateful logic into focused custom hooks (`useDebounce`, `useLocalStorage`, `useIntersectionObserver`).
- **Predictable API Return**: Return tuples `[value, setter]` for primary state-like hooks or named objects `{ data, isLoading, error, refetch }` for async workflows.

## 4. Concurrency & Suspense
- **Transitions for Non-Urgent Updates**: Use `useTransition` / `startTransition` to mark CPU-heavy state updates as interruptible, keeping user inputs responsive.
- **Declarative Loading**: Wrap asynchronous data components in `<Suspense fallback={<Skeleton />}>` and handle errors with `<ErrorBoundary>`.
