// fixture 12b: pure-type declaration file
export interface Shape {
  kind: string;
  size: number;
}
export type Id = string | number;
export declare function createShape(kind: string, size: number): Shape;
