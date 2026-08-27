// fixture 05: static block
class A {
  static x: number = 0;
  static {
    this.x = 5;
    if (this.x > 2) {
      this.x = this.x * 2 - 1;
    }
  }
  static {
    const y = 100;
    this.x = y + 3;
  }
  m(): void {
    void 0;
  }
}
