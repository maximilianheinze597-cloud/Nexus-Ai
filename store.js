import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('data');
fs.mkdirSync(dir, { recursive: true });
const file = (n) => path.join(dir, n + '.json');

export const load = (n, fallback) => {
  try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return fallback; }
};
export const save = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));
