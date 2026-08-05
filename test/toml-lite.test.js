'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractLock, extractManifest, parseToml } = require('../src/core/toml-lite');

const MANIFEST = `[package]
org = "acme"
name = "widget"
version = "1.2.3"

[package.repository]
url = "https://github.com/acme/widget"

[dependencies]
"acme/http-kit" = "^1"
acme-utils = { version = ">=2 <3", optional = true }

[dev-dependencies]
"acme/test-kit" = "0.4.0"
`;

test('parses package identity and dependency sections', () => {
  const parsed = parseToml(MANIFEST);
  assert.deepEqual(parsed.errors, []);
  const manifest = extractManifest(parsed);
  assert.equal(manifest.package.org, 'acme');
  assert.equal(manifest.package.name, 'widget');
  assert.equal(manifest.package.repository.url, 'https://github.com/acme/widget');
  assert.deepEqual(
    manifest.dependencies.map(({ name, requirement, kind }) => ({ name, requirement, kind })),
    [
      { name: 'acme/http-kit', requirement: '^1', kind: 'runtime' },
      { name: 'acme-utils', requirement: '>=2 <3', kind: 'runtime' },
      { name: 'acme/test-kit', requirement: '0.4.0', kind: 'dev' }
    ]
  );
});

test('parses array-table lock entries', () => {
  const parsed = parseToml(`version = 1

[[package]]
org = "acme"
name = "http-kit"
version = "1.7.2"

[[package]]
name = "acme/test-kit"
version = "0.4.0"
`);
  const lock = extractLock(parsed);
  assert.equal(lock.formatVersion, '1');
  assert.deepEqual(lock.packages.map(({ name, version }) => ({ name, version })), [
    { name: 'acme/http-kit', version: '1.7.2' },
    { name: 'acme/test-kit', version: '0.4.0' }
  ]);
});

test('parses multiline arrays and ignores comments within them', () => {
  const parsed = parseToml(`[package]
org = "zed-pkg"
name = "zed-cli"
version = "0.1.0"

[publish]
exclude = [
  ".env", # local secrets
  "target/**",
  "value#inside-string",
]

[dependencies]
"zed-pkg/zed-interfaces" = "^0.1"
`);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.data.publish.exclude, ['.env', 'target/**', 'value#inside-string']);
  assert.equal(extractManifest(parsed).dependencies[0].name, 'zed-pkg/zed-interfaces');
});

test('reports unterminated multiline collections once at the assignment line', () => {
  const parsed = parseToml('[publish]\nexclude = [\n  "target/**",');
  assert.deepEqual(parsed.errors, [{ line: 1, message: 'Unterminated array or inline table value.' }]);
});

test('records malformed assignments instead of throwing', () => {
  const parsed = parseToml('[package]\nnot-an-assignment');
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /key\/value/);
});
