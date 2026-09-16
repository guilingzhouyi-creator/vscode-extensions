---
name: vue-best-practices
description: Vue 3 & Composition API development guide with script setup, reactivity rules, provide/inject architecture, custom composables, and Pinia stores.
---

# Vue 3 & Composition API Architecture Guide

## 1. Script Setup & Reactivity Foundations
- **Use `<script setup lang="ts">`**: Leverage compiler-macro `defineProps<{ ... }>()` and `defineEmits<{ ... }>()` for zero-overhead typed contracts.
- **Reactivity Rules**: Prefer `ref()` over `reactive()` for primitives and predictable object reassignment. Use `toRefs()` when destructuring reactive objects.
- **Readonly Protection**: Expose state wrapped in `readonly()` from composables or stores to prevent direct external mutation.

## 2. Custom Composables Pattern
- **Idiomatic Naming & Structure**: Prefix custom composables with `use*`. Accept flexible arguments (`MaybeRef<T>`) using `toValue()` for dynamic reactivity.
- **Lifecycle Cleanup**: Always pair side-effects inside composables with `onUnmounted` or `onScopeDispose` (clear timers, remove window listeners).

## 3. Dependency Injection & State Management
- **Typed Provide / Inject**: Use `InjectionKey<T>` symbols to guarantee type safety across deeply nested component hierarchies.
- **Pinia Stores**: Keep Pinia stores modular and action-driven. Use Setup Stores (`defineStore('id', () => { ... })`) for Composition API consistency.

## 4. Performance & Template Optimization
- **`v-once` & `v-memo`**: Use `v-once` for static unchanging subtrees and `v-memo="[dep]"` for large lists with infrequent updates.
- **Async Components**: Split heavy UI panels with `defineAsyncComponent` and `<Suspense>`.
