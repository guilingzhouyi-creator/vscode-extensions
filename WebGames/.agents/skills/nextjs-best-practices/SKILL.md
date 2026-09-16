---
name: nextjs-best-practices
description: Comprehensive Next.js best practices guide covering App Router, React Server Components (RSC), server actions, caching strategies, and performance optimization.
---

# Next.js Best Practices & Architecture Guide

## 1. App Router & Server Components (RSC)
- **Default to Server Components**: Keep components as Server Components by default. Only add `'use client'` when interactivity (e.g. `useState`, `useEffect`, event listeners) or browser APIs are required.
- **Leaf-Level Client Components**: Push client boundaries down the component tree to maximize the benefits of server rendering and minimize client JS bundle size.
- **Pass Server Components as Children**: Pass RSCs as `children` or props to Client Components to avoid converting the entire subtree to client execution.

## 2. Data Fetching & Caching
- **Colocate Data Fetching**: Fetch data directly within the Server Components that need it. Next.js automatically dedupes duplicate `fetch` requests in the same render pass.
- **Granular Revalidation**: Use `revalidatePath` and `revalidateTag` with targeted cache tags (`fetch(url, { next: { tags: ['posts'] } })`) for cache invalidation.
- **Parallel Data Fetching**: Use `Promise.all` or independent async server components with `<Suspense>` boundaries to avoid sequential network waterfalls.

## 3. Server Actions & Mutations
- **Input Validation**: Always validate input arguments using Zod or equivalent schemas inside server actions.
- **Optimistic Updates**: Pair server actions with `useOptimistic` for instantaneous UI feedback while awaiting network confirmation.
- **Security & Authorization**: Verify authentication and user permissions inside every server action before performing state mutations.

## 4. Performance & Assets
- **Image Optimization**: Always use `next/image` with explicit dimensions, `sizes`, and `priority` for above-the-fold Hero images.
- **Font Optimization**: Use `next/font/google` or `next/font/local` to eliminate layout shift and external network requests.
- **Dynamic Imports**: Use `next/dynamic` for heavy client-side libraries (charts, 3D engines, rich text editors) that are not needed immediately on initial render.
