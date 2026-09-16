---
name: css-modern-layouts
description: Modern CSS layout techniques covering CSS Grid, Subgrid, Flexbox, Container Queries, intrinsic sizing, and fluid responsive design.
---

# Modern CSS Layouts & Responsive Architecture Guide

## 1. Modern CSS Grid & Intrinsic Sizing
- **Autofill / Autofit Grid**: Create zero-media-query responsive grids:
  ```css
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  ```
- **CSS Subgrid**: Use `grid-template-rows: subgrid` on child cards to align headers, bodies, and footers across independent grid columns perfectly.

## 2. Container Queries (`@container`)
- **Component-Driven Responsiveness**: Style components based on their parent container's width rather than the global viewport width:
  ```css
  .card-container { container-type: inline-size; }
  @container (min-width: 480px) {
    .card { display: flex; flex-direction: row; }
  }
  ```

## 3. Flexbox & Alignment Utilities
- **Gap Everywhere**: Always use `gap` instead of margin hacks on flex child elements.
- **Flex Grow & Shrink Rules**: Use `flex: 1 1 0%` for equal distribution or `flex: 0 0 auto` for fixed-size sidebars/icons.

## 4. Fluid Typography & Spacing
- **CSS `clamp()`**: Use `clamp(min, preferred, max)` (e.g. `font-size: clamp(1rem, 0.8rem + 1vw, 2.5rem);`) for seamless scaling without sudden breakpoint jumps.
- **Logical Properties**: Embrace `margin-inline`, `padding-block`, `inset-inline-start` for future-proof internationalization and RTL layout support.
