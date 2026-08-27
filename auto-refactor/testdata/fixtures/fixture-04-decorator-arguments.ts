// fixture 04: decorator arguments
function factory(n: number) {
  return function (target: any) {
    void target;
  };
}
function dec(s: string) {
  return function (target: any) {
    void target;
  };
}
@factory(42)
@dec('x')
class Service {
  @factory(100)
  prop = 1;
  @dec('hello')
  method(): void {
    void 0;
  }
}
