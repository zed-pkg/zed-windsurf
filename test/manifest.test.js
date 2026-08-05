'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src', 'extension.js'), 'utf8');

test('extension manifest is aligned with Windsurf Open VSX compatibility', () => {
  assert.equal(manifest.publisher, 'zed-pkg');
  assert.equal(manifest.engines.vscode, '^1.89.0');
  assert.equal(manifest.main, './src/extension.js');
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'limited');
  assert.ok(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations.includes('zedPackage.binaryPath'));
  assert.equal(manifest.contributes.configuration.properties['zedPackage.binaryPath'].scope, 'machine');
  assert.ok(manifest.contributes.views.zedPackage.length >= 4);
});

test('every contributed command is represented in the extension implementation', () => {
  const ids = manifest.contributes.commands.map((entry) => entry.command);
  assert.equal(new Set(ids).size, ids.length, 'command IDs must be unique');

  const dynamicCommands = new Set([
    'zedPackage.install',
    'zedPackage.frozenInstall',
    'zedPackage.addDependency',
    'zedPackage.removeDependency',
    'zedPackage.storeStatus',
    'zedPackage.authStatus',
    'zedPackage.releasePlan',
    'zedPackage.releasePreflight',
    'zedPackage.selfUpdateCheck'
  ]);

  for (const id of ids) {
    if (!dynamicCommands.has(id)) assert.ok(source.includes(id), `${id} must appear in extension implementation`);
  }
  assert.match(source, /for \(const actionName of Object\.keys\(ACTIONS\)\)/);
  assert.match(source, /registerCommand\(commandForAction\(actionName\)/);
});

test('every CLI-backed command is disabled until Workspace Trust is granted', () => {
  const nonCli = new Set([
    'zedPackage.refresh',
    'zedPackage.showReport',
    'zedPackage.openManifest',
    'zedPackage.openLockfile'
  ]);
  for (const entry of manifest.contributes.commands) {
    if (!nonCli.has(entry.command)) assert.equal(entry.enablement, 'isWorkspaceTrusted', entry.command);
  }
});

test('all packaged files exist', () => {
  for (const relative of ['src/extension.js', 'resources/zed-package.svg', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must exist`);
  }
});
