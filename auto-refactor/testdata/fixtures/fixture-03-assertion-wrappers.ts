// fixture 03: as / assertion wrappers
export const a1 = 100 as any;
export const a2 = <number>50;
export const a3 = x!;
export const a4 = value satisfies T;
export function generic<T>(): void {
  const v = f<T>();
  void v;
}
export const a5 = (3 as unknown as number) + 1;
