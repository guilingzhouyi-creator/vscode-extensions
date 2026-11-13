# UI Interaction Physics: 1-Border Rule, Damped Springs, Power-Law Masks & IME Guard

Deep UI engineering constraints covering container hierarchy, motion physics, scroll feathering, fixed-point zoom, and CJK IME safety.

---

## 1. The 1-Border Rule & Retina Hairline Highlights

Any sightline from canvas background into a component crosses **at most 1 closed rectangular border**: outer cards/dialogs hold containers, inner secondary actions step down via surface lightness/Ghost fills, inputs strip native outlines (`border-0 outline-none`), and internal dividers use single-axis `1px` hairlines (`0.5px` at `2dppx`, `calc(1px / 3)` at `3dppx`). Dark-mode floating surfaces add subtle top/inset highlights (`rgba(255, 255, 255, 0.10)`) + deep ambient shadows.

---

## 2. Second-Order Damped Harmonic Oscillator

For $m\ddot{x} + c\dot{x} + k(x - x_{\text{target}}) = 0$, natural frequency $\omega_0 = \sqrt{k/m}$ and damping ratio $\zeta = \frac{c}{2\sqrt{mk}}$:
- **Underdamped ($\zeta < 1$)**: Oscillatory overshoot $\exp(-\pi\zeta / \sqrt{1-\zeta^2})$ (`Snappy` $\zeta=0.612$, `Gentle` $\zeta=0.783$, `Bouncy` $\zeta=0.462`).
- **Critically damped ($\zeta = 1$)**: Fastest zero-overshoot settle $1 - e^{-\omega_0 t}(1 + \omega_0 t)$.
- **Overdamped ($\zeta > 1$)**: Monotonic dual-exponential snap (`HeavySnap` $\zeta=3.65$).

---

## 3. 7-Stop Power-Law Fade Mask ($y \approx x^{1.5}$) & Cursor Fixed-Point Zoom

- **Scroll masks**: Sample alpha along $28\text{px}$: `0% (0.000) -> 15% (0.051) -> 30% (0.149) -> 45% (0.302) -> 60% (0.502) -> 75% (0.702) -> 87% (0.851) -> 100% (1.000)` to prevent linear Mach bands; collapse mask height to `0` at scroll boundaries.
- **Cursor-anchored affine zoom** ($r = S_{\text{target}} / S_{\text{current}}$):
  $$\text{idealTx} = O_x - (O_x - \text{tx}) \cdot r, \quad \text{idealTy} = O_y - (O_y - \text{ty}) \cdot r$$
  Clamp pan bounds with `0.7` overscroll damping and `<= 4px` pointer micro-jitter deadzone.

---

## 4. CJK IME Composition Interlock

Commit/submit only when all four hold: `(key === 'Enter') && !shiftKey && !isComposing && keyCode !== 229` (since browsers may clear `isComposing` before `keyCode === 229`). Intercept `Escape` with `stopPropagation()` during composition, and keep mobile inputs `font-size >= 16px` with `field-sizing: content`.
