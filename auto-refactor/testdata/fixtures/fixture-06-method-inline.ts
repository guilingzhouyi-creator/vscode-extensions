// fixture 06: method inline (object literal methods + getter/setter)
const o = {
  m() {
    return 1;
  },
  get value(): number {
    return 10;
  },
  set value(v: number) {
    void v;
  },
};
class B {
  get size(): number {
    return 5;
  }
  set size(v: number) {
    void v;
  }
  async run(): Promise<number> {
    return o.m() + this.size;
  }
}
