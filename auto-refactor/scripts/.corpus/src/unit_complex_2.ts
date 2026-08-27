export function decide(x: number, y: number, z: number): string {
  let out = '';
  if (x === 1) out += 'a'; else if (x === 2) out += 'b'; else if (x === 3) out += 'c'; else out += 'd';
  if (y === 1) out += 'A'; else if (y === 2) out += 'B'; else if (y === 3) out += 'C'; else out += 'D';
  if (z === 1) out += '1'; else if (z === 2) out += '2'; else if (z === 3) out += '3'; else out += '4';
  switch (out.length) {
    case 1: return out + 'x';
    case 2: return out + 'y';
    case 3: return out + 'z';
    default: return out;
  }
}
