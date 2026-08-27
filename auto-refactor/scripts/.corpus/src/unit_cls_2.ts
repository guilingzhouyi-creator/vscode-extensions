export class Widget {
  private count = 0;
  inc(): void { this.count = this.count + 1; }
  dec(): void { this.count = this.count - 1; }
  get(): number { return this.count; }
  heavy(a: number, b: number, c: number): number {
    if (a > 0) { if (b > 0) { if (c > 0) return a + b + c; else return a + b; } else return a; }
    else if (a < 0) return -a;
    return 0;
  }
}
