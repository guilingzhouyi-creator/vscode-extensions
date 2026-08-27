// fixture 08: deep nesting > 10 + function inner deep expressions
export function deep(a: number): number {
  let v = 0;
  if (a > 0) {
    if (a > 1) {
      if (a > 2) {
        if (a > 3) {
          if (a > 4) {
            if (a > 5) {
              if (a > 6) {
                if (a > 7) {
                  if (a > 8) {
                    if (a > 9) {
                      if (a > 10) {
                        v = a * 100 + 5 - 5;
                      } else {
                        v = a + 1;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return v;
}
export function inner(): number {
  const f = (x: number) => x * 2 + 1 - 1;
  return f(f(f(f(f(f(f(f(1))))))));
}
