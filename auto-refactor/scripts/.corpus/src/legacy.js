function compute(a, b) {
  if (a > 5) { return b * 100; }
  return a + 100;
}
console.log('legacy start');
const NAME = 'legacy name';
module.exports = { compute };
