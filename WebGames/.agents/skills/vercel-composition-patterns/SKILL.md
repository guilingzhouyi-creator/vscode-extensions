---
name: vercel-composition-patterns
description: Vercel-recommended component composition patterns including compound components, slot patterns, render props, and headless UI architectures.
---

# Vercel Component Composition Patterns

## 1. Compound Component Pattern
- **Shared Context Isolation**: Group related UI elements (e.g. `Tabs`, `Tabs.List`, `Tabs.Trigger`, `Tabs.Content`) using React Context to manage internal coordination seamlessly.
- **Example**:
  ```tsx
  <Select value={val} onValueChange={setVal}>
    <Select.Trigger />
    <Select.Content>
      <Select.Item value="1">Option 1</Select.Item>
    </Select.Content>
  </Select>
  ```

## 2. Slot & `asChild` Delegation (Radix Pattern)
- **Polymorphism via Slotted Elements**: Use Radix-style `Slot` or `asChild` props to merge behaviors, event listeners, and accessibility attributes into user-provided custom DOM elements without wrapping divs.

## 3. Headless UI Architecture
- **Separation of Behavior and Presentation**: Separate state machine logic (keyboard navigation, ARIA attributes, focus trapping) into headless hooks (`useMenu`, `useDisclosure`), letting consuming components define styling.

## 4. Controlled vs Uncontrolled Flexibility
- **Hybrid Value Management**: Support both `value` (controlled) and `defaultValue` (uncontrolled) in interactive components with an internal state sync hook.
