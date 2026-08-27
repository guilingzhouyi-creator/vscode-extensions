// fixture 07: topLevel / exported edge cases
export default function main(): void {
  void 0;
}
const x = 1;
export { x };
export * from './other';
declare function external(): void;
export enum Color {
  Red = 1,
  Green = 2,
  Blue = 3,
}
export = moduleThing;
declare const moduleThing: { run(): void };
