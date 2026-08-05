'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('extension process execution does not enable a shell', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8');
  assert.match(source, /shell:\s*false/);
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /\bexec\s*\(/);
});

test('CLI detection and every CLI command require Workspace Trust', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8');
  assert.match(source, /async function detectCli[\s\S]*if \(!vscode\.workspace\.isTrusted\)/);
  assert.match(source, /async function executeAction[\s\S]*if \(!vscode\.workspace\.isTrusted\)/);
});

test('report webview disables scripts and declares a restrictive CSP', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8');
  assert.match(source, /enableScripts:\s*false/);
  assert.match(source, /localResourceRoots:\s*\[\]/);
  assert.match(source, /default-src 'none'/);
});
