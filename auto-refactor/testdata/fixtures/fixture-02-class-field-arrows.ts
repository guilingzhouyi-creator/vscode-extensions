// fixture 02: class-field arrows / binding sources
class A {
  handler = () => 42;
  other = () => 7;
  private fn = function () {
    return 3;
  };
}
const obj = {
  m: () => 100,
  n: function () {
    return 200;
  },
};
exports.foo = function () {
  return 9;
};
obj.m = () => 5;
