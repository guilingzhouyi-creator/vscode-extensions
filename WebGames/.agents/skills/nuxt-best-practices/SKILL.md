---
name: nuxt-best-practices
description: Nuxt 3 engineering guide covering universal rendering, Nitro server engine, auto-imports, composables architecture, state management, and SEO metadata.",
---

# Nuxt 3 Full-Stack & Universal Rendering Guide

## 1. Universal Data Fetching (`useAsyncData` / `useFetch`)
- **SSR-Safe Keying**: Always provide unique cache keys for `useAsyncData('key', () => fetcher())` to prevent duplicate client-side re-fetching on hydration.
- **Lazy Loading**: Use `useLazyFetch` or `{ lazy: true }` for non-critical, below-the-fold content to unblock initial page navigation.

## 2. State & Composables Architecture
- **SSR-Safe Global State**: Use `useState('state_key', () => initialValue)` instead of reactive refs in the module scope to avoid cross-request state pollution in Node.js server runtimes.
- **Auto-Imports Directory Structure**: Structure business logic in `composables/` and `utils/` with clear exported names for automatic tree-shakeable resolution.

## 3. Nitro Server Engine & API Routes
- **Typed Server Handlers**: Define server endpoints in `server/api/*.ts` using `defineEventHandler` with input validation via `readBody` / `getQuery`.
- **Server Middleware**: Implement authentication and logging middleware in `server/middleware/` without blocking static assets.

## 4. SEO & Head Management
- **Declarative Metadata**: Use `useSeoMeta` and `useHead` with dynamic reactive properties to inject canonical links, OpenGraph cards, and schema JSON-LD.
