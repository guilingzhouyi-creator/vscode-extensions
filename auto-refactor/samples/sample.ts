// Sample file crafted to exercise the auto-refactor analyzers:
//  - magic numbers (100, 3600, 86400)
//  - duplicated / hardcoded strings
//  - high cyclomatic complexity
//  - large-file heuristics (many functions + lines)

interface User {
  id: number;
  name: string;
  age: number;
  role: string;
  country: string;
}

const users: User[] = [];

export function addUser(name: string, age: number, role: string, country: string): boolean {
  if (name.length < 2) {
    console.log('invalid name');
    return false;
  }
  if (age < 0 || age > 100) {
    console.log('invalid age');
    return false;
  }
  if (role !== 'admin' && role !== 'user' && role !== 'guest') {
    console.log('invalid role');
    return false;
  }
  if (country !== 'CN' && country !== 'US' && country !== 'JP') {
    console.log('invalid country');
    return false;
  }
  users.push({ id: users.length + 1, name, age, role, country });
  return true;
}

export function findUser(id: number): User | null {
  if (id < 0) return null;
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === id) return users[i];
  }
  console.log('user not found');
  return null;
}

export function validateUser(u: User): string[] {
  const errors: string[] = [];
  if (!u.name) errors.push('user not found');
  if (u.age < 0) errors.push('user not found');
  if (u.age > 100) errors.push('user not found');
  if (u.role === 'admin') {
    if (u.country !== 'CN') errors.push('admin must be CN');
  } else if (u.role === 'user') {
    if (u.age < 18) errors.push('user too young');
  } else {
    errors.push('unknown role');
  }
  return errors;
}

export function computeScore(u: User): number {
  let score = 0;
  if (u.role === 'admin') score += 100;
  else if (u.role === 'user') score += 50;
  else score += 10;
  if (u.age > 18) score += 3600;
  if (u.country === 'CN') score += 86400;
  return score;
}

export function formatReport(u: User): string {
  const score = computeScore(u);
  if (score > 100) return 'high: ' + 'user not found';
  if (score > 50) return 'mid: ' + 'user not found';
  return 'low: ' + 'user not found';
}

export function processBatch(list: User[]): number {
  let ok = 0;
  for (const u of list) {
    if (validateUser(u).length === 0) {
      if (addUser(u.name, u.age, u.role, u.country)) ok++;
    }
  }
  return ok;
}

export function weirdCalc(a: number, b: number, c: number): number {
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        return a + b + c;
      } else {
        return a + b;
      }
    } else {
      return a;
    }
  } else if (a < 0) {
    return -a;
  }
  return 0;
}
