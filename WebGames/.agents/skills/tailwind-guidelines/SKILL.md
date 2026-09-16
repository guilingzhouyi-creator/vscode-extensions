---
name: tailwind-guidelines
description: Tailwind CSS engineering standards, design token management, class grouping, responsive breakpoints, dynamic styling rules, and avoid arbitrary values.
---

# Tailwind CSS Engineering Standards & UI Styling Guide

## 1. Class Organization & Formatting
- **Consistent Ordering**: Order utility classes systematically: Layout $\rightarrow$ Box Model (Spacing/Sizing) $\rightarrow$ Typography $\rightarrow$ Visuals (Colors/Borders/Shadows) $\rightarrow$ Interactive / States (Hover/Focus/Active) $\rightarrow$ Responsive.
- **Use `clsx` & `tailwind-merge` (`cn` helper)**: Always merge conditional classes with `cn(...)` to eliminate class collision issues.

## 2. Design Tokens & Theme Extension
- **Avoid Arbitrary Magic Values**: Favor semantic theme tokens (`bg-primary`, `text-muted-foreground`, `p-4`) over one-off arbitrary brackets (`p-[13px]`, `text-[#123456]`).
- **CSS Variables for Dynamic Themes**: Map Tailwind colors to semantic HSL CSS variables (`bg-[hsl(var(--background))]`) to enable seamless dark/light theme switching.

## 3. Responsive & State Variants
- **Mobile-First Breakpoints**: Always write base styles for mobile, then layer `sm:`, `md:`, `lg:`, `xl:` modifiers progressively.
- **Modern States**: Utilize `group-hover:`, `peer-checked:`, `focus-visible:`, and `aria-expanded:` for rich, accessible interactive states.

## 4. Component Encapsulation
- **Avoid `@apply` Overuse**: Keep utility classes inline in JSX/HTML for inspectability and tree-shaking efficiency. Only use `@apply` for global typography resets or third-party override sheets.
