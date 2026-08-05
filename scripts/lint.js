'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directories = ['src', 'test', 'scripts'];
const files = [];

for (const directory of directories) {
  const start = path.join(root, directory);
  if (!fs.existsSync(start)) continue;
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
    }
  }
}

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
  const text = fs.readFileSync(file, 'utf8');
  if (/\bexec\s*\(/.test(text) || /shell\s*:\s*true/.test(text)) {
    console.error(`Unsafe process invocation pattern found in ${path.relative(root, file)}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
