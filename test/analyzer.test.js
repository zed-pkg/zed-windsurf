'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeProject } = require('../src/core/analyzer');

const CLI = { available: true, version: 'zed 0.1.0', binary: 'zed', reason: null, error: null };
const MANIFEST = `[package]
org = "acme"
name = "widget"
version = "1.0.0"

[dependencies]
"acme/http-kit" = "^1"
`;
const LOCK = `version = 1

[[package]]
org = "acme"
name = "http-kit"
version = "1.4.0"
`;

test('healthy project produces no findings', () => {
  const project = analyzeProject({
    root: '/tmp/widget', rootName: 'widget', manifestText: MANIFEST, lockText: LOCK, hasModules: true, cli: CLI
  });
  assert.equal(project.label, 'acme/widget');
  assert.deepEqual(project.findings, []);
  assert.equal(project.counts.error, 0);
  assert.equal(project.counts.warning, 0);
});

test('missing lock and modules produce actionable findings', () => {
  const project = analyzeProject({
    root: '/tmp/widget', rootName: 'widget', manifestText: MANIFEST, lockText: null, hasModules: false, cli: CLI
  });
  assert.ok(project.findings.some((item) => item.id === 'lock-missing' && item.action === 'install'));
  assert.ok(project.findings.some((item) => item.id === 'modules-missing' && item.action === 'install'));
  assert.deepEqual(project.recommendedActions, ['install']);
});

test('lock-only project recommends the explicit manifestless frozen restore', () => {
  const project = analyzeProject({
    root: '/tmp/widget', rootName: 'widget', manifestText: null, lockText: LOCK, hasModules: false, cli: CLI
  });
  assert.ok(project.findings.some((item) => item.id === 'lock-only' && item.action === 'frozenInstall'));
  assert.deepEqual(project.recommendedActions, ['frozenInstall']);
});

test('missing CLI is reported without inventing package state', () => {
  const project = analyzeProject({
    root: '/tmp/widget', rootName: 'widget', manifestText: MANIFEST, lockText: LOCK, hasModules: true,
    cli: { available: false, version: null, binary: 'zed', reason: 'detection-failed', error: 'ENOENT' }
  });
  const finding = project.findings.find((item) => item.id === 'cli-unavailable');
  assert.equal(finding.severity, 'warning');
  assert.match(finding.detail, /ENOENT/);
});

test('untrusted workspace reports Restricted Mode without claiming the CLI is missing', () => {
  const project = analyzeProject({
    root: '/tmp/widget', rootName: 'widget', manifestText: MANIFEST, lockText: LOCK, hasModules: true,
    cli: {
      available: false,
      version: null,
      binary: 'zed',
      reason: 'workspace-untrusted',
      error: 'Workspace Trust is required before executing the zed-pkg CLI.'
    }
  });
  assert.ok(project.findings.some((item) => item.id === 'cli-untrusted' && item.severity === 'information'));
  assert.ok(!project.findings.some((item) => item.id === 'cli-unavailable'));
});
