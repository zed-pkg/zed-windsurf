'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { analyzeProject } = require('./core/analyzer');

const ACTIONS = {
  install: { label: 'Install dependencies', icon: 'cloud-download', mutating: true },
  frozenInstall: { label: 'Restore frozen lock', icon: 'lock', mutating: true },
  addDependency: { label: 'Add dependency', icon: 'add', mutating: true },
  removeDependency: { label: 'Remove dependency', icon: 'remove', mutating: true },
  storeStatus: { label: 'Show store status', icon: 'database', mutating: false },
  authStatus: { label: 'Show auth status', icon: 'account', mutating: false },
  releasePlan: { label: 'Show release plan', icon: 'list-tree', mutating: false },
  releasePreflight: { label: 'Run release preflight', icon: 'pass', mutating: false },
  selfUpdateCheck: { label: 'Check CLI update', icon: 'sync', mutating: false },
  openManifest: { label: 'Open manifest', icon: 'file-code', mutating: false },
  openLockfile: { label: 'Open lockfile', icon: 'file-binary', mutating: false }
};

class ProjectStore {
  constructor(output, diagnostics) {
    this.output = output;
    this.diagnostics = diagnostics;
    this.projects = [];
    this.cli = { available: false, version: null, binary: null, error: 'Not checked yet.' };
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
    this.refreshPromise = null;
    this.debounceTimer = null;
  }

  dispose() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.emitter.dispose();
  }

  scheduleRefresh(delay = 250) {
    if (!vscode.workspace.getConfiguration('zedPackage').get('autoRefresh', true)) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.refresh().catch((error) => this.output.appendLine(`[refresh] ${error.stack ?? error}`));
    }, delay);
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async performRefresh() {
    const maxProjects = vscode.workspace.getConfiguration('zedPackage').get('maxProjects', 100);
    const exclude = '**/{.git,node_modules,zed_modules,.zed,.zed-pack,target,dist,build}/**';
    const [manifestUris, lockUris] = await Promise.all([
      vscode.workspace.findFiles('**/.zpkg.toml', exclude, maxProjects),
      vscode.workspace.findFiles('**/.zpkg.lock', exclude, maxProjects)
    ]);

    const roots = new Map();
    for (const uri of manifestUris) roots.set(path.dirname(uri.fsPath), { manifestUri: uri, lockUri: null });
    for (const uri of lockUris) {
      const root = path.dirname(uri.fsPath);
      const current = roots.get(root) ?? { manifestUri: null, lockUri: null };
      current.lockUri = uri;
      roots.set(root, current);
    }

    this.cli = await detectCli(this.output);
    const projects = [];
    const boundedRoots = [...roots.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, maxProjects);
    for (const [root, files] of boundedRoots) {
      const rootUri = vscode.Uri.file(root);
      const [manifestText, lockText, hasModules] = await Promise.all([
        readOptional(files.manifestUri),
        readOptional(files.lockUri),
        exists(vscode.Uri.joinPath(rootUri, 'zed_modules'))
      ]);
      const model = analyzeProject({
        root,
        rootName: path.basename(root),
        manifestText,
        lockText,
        hasModules,
        cli: this.cli
      });
      projects.push({ ...model, rootUri, manifestUri: files.manifestUri, lockUri: files.lockUri, manifestText, lockText });
    }

    this.projects = projects;
    this.publishDiagnostics();
    this.emitter.fire();
    this.output.appendLine(`[refresh] ${new Date().toISOString()} inspected ${projects.length} zed-pkg project(s); CLI ${this.cli.available ? this.cli.version ?? 'available' : 'unavailable'}.`);
  }

  publishDiagnostics() {
    this.diagnostics.clear();
    const grouped = new Map();
    for (const project of this.projects) {
      for (const item of project.findings) {
        const uri = item.file === 'manifest' ? project.manifestUri : item.file === 'lock' ? project.lockUri : null;
        if (!uri) continue;
        const lines = item.file === 'manifest' ? project.manifestText?.split(/\r?\n/) : project.lockText?.split(/\r?\n/);
        const line = Math.max(0, Math.min(item.line, Math.max(0, (lines?.length ?? 1) - 1)));
        const length = Math.max(1, lines?.[line]?.length ?? 1);
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(line, 0, line, length),
          item.recommendation ? `${item.message} ${item.recommendation}` : item.message,
          diagnosticSeverity(item.severity)
        );
        diagnostic.source = 'zed-pkg';
        diagnostic.code = item.id;
        const key = uri.toString();
        const entry = grouped.get(key) ?? { uri, diagnostics: [] };
        entry.diagnostics.push(diagnostic);
        grouped.set(key, entry);
      }
    }
    for (const { uri, diagnostics } of grouped.values()) this.diagnostics.set(uri, diagnostics);
  }

  find(root) {
    return this.projects.find((project) => project.root === root) ?? null;
  }
}

class ZedTreeProvider {
  constructor(store, kind) {
    this.store = store;
    this.kind = kind;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.subscription = store.onDidChange(() => this.emitter.fire());
  }

  dispose() {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      if (this.store.projects.length === 0) {
        const empty = new vscode.TreeItem('No .zpkg.toml or .zpkg.lock found');
        empty.description = 'Open a zed-pkg workspace and refresh';
        empty.iconPath = new vscode.ThemeIcon('info');
        return [empty];
      }
      return this.store.projects.map((project) => projectNode(project, this.kind));
    }
    if (!element.projectRoot) return [];
    const project = this.store.find(element.projectRoot);
    if (!project) return [];
    switch (this.kind) {
      case 'overview': return overviewChildren(project);
      case 'dependencies': return dependencyChildren(project);
      case 'problems': return problemChildren(project);
      case 'actions': return actionChildren(project);
      default: return [];
    }
  }
}

function projectNode(project, kind) {
  const item = new vscode.TreeItem(project.label, vscode.TreeItemCollapsibleState.Expanded);
  item.projectRoot = project.root;
  item.contextValue = `zedProject.${kind}`;
  item.description = project.manifest?.package?.version ? `v${project.manifest.package.version}` : path.basename(project.root);
  item.tooltip = `${project.root}\n${project.counts.error} errors, ${project.counts.warning} warnings`;
  item.iconPath = new vscode.ThemeIcon(project.counts.error > 0 ? 'error' : project.counts.warning > 0 ? 'warning' : 'package');
  return item;
}

function leaf(label, description, icon, command = null, tooltip = null) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = description ?? undefined;
  item.iconPath = new vscode.ThemeIcon(icon);
  item.tooltip = tooltip ?? undefined;
  item.command = command ?? undefined;
  return item;
}

function overviewChildren(project) {
  const status = project.counts.error > 0
    ? `${project.counts.error} error(s)`
    : project.counts.warning > 0
      ? `${project.counts.warning} warning(s)`
      : 'healthy';
  return [
    leaf('Status', status, project.counts.error > 0 ? 'error' : project.counts.warning > 0 ? 'warning' : 'pass'),
    leaf('Manifest', project.hasManifest ? '.zpkg.toml' : 'missing', project.hasManifest ? 'file-code' : 'circle-slash', project.manifestUri ? command('zedPackage.openManifest', project.root) : null),
    leaf('Lockfile', project.hasLock ? '.zpkg.lock' : 'missing', project.hasLock ? 'lock' : 'unlock', project.lockUri ? command('zedPackage.openLockfile', project.root) : null),
    leaf('Materialized', project.hasModules ? 'zed_modules present' : 'zed_modules missing', project.hasModules ? 'folder-active' : 'folder'),
    leaf('CLI', project.cli.available ? project.cli.version ?? 'available' : 'unavailable', project.cli.available ? 'terminal' : 'warning'),
    leaf('Package report', 'open details', 'preview', command('zedPackage.showReport', project.root))
  ];
}

function dependencyChildren(project) {
  if (!project.manifest || project.manifest.dependencies.length === 0) {
    return [leaf('No direct dependencies detected', null, 'info')];
  }
  const lockedByName = new Map((project.lock?.packages ?? []).map((entry) => [entry.name, entry.version]));
  return project.manifest.dependencies.map((dependency) => {
    const locked = lockedByName.get(dependency.name);
    const description = locked ? `${dependency.requirement} → ${locked}` : dependency.requirement;
    return leaf(dependency.name, description, dependency.kind === 'dev' ? 'beaker' : 'package', null, `${dependency.kind} dependency`);
  });
}

function problemChildren(project) {
  if (project.findings.length === 0) return [leaf('No problems detected', null, 'pass')];
  return project.findings.map((problem) => {
    const icon = problem.severity === 'error' ? 'error' : problem.severity === 'warning' ? 'warning' : 'info';
    const action = problem.action ? command(commandForAction(problem.action), project.root) : null;
    return leaf(problem.message, problem.recommendation, icon, action, problem.detail ?? problem.recommendation);
  });
}

function actionChildren(project) {
  const names = new Set(project.recommendedActions);
  names.add('addDependency');
  if (project.manifest?.dependencies?.length) names.add('removeDependency');
  names.add('storeStatus');
  names.add('authStatus');
  names.add('releasePlan');
  names.add('releasePreflight');
  names.add('selfUpdateCheck');
  if (project.manifestUri) names.add('openManifest');
  if (project.lockUri) names.add('openLockfile');
  return [...names].map((name) => {
    const metadata = ACTIONS[name];
    return leaf(metadata.label, metadata.mutating ? 'requires confirmation' : null, metadata.icon, command(commandForAction(name), project.root));
  });
}

function command(id, root) {
  return { command: id, title: id, arguments: [root] };
}

function commandForAction(action) {
  return `zedPackage.${action}`;
}

async function readOptional(uri) {
  if (!uri) return null;
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return null;
  }
}

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function diagnosticSeverity(severity) {
  switch (severity) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'hint': return vscode.DiagnosticSeverity.Hint;
    default: return vscode.DiagnosticSeverity.Information;
  }
}

function binaryPath() {
  return vscode.workspace.getConfiguration('zedPackage').get('binaryPath', 'zed').trim() || 'zed';
}

async function detectCli(output) {
  const binary = binaryPath();
  if (!vscode.workspace.isTrusted) {
    return {
      available: false,
      version: null,
      binary,
      reason: 'workspace-untrusted',
      error: 'Workspace Trust is required before executing the zed-pkg CLI.'
    };
  }
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  try {
    const result = await runProcess(binary, ['--version'], cwd, 5000, output, false);
    return { available: true, version: result.stdout.trim().split(/\r?\n/)[0] || 'available', binary, error: null };
  } catch (error) {
    return { available: false, version: null, binary, error: error instanceof Error ? error.message : String(error) };
  }
}

function runProcess(binary, args, cwd, timeoutMs, output, streamOutput = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (streamOutput) output.append(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (streamOutput) output.append(text);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ code, stdout, stderr });
      else reject(new Error(`${binary} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

async function selectProject(store, root) {
  if (root) {
    const exact = store.find(root);
    if (exact) return exact;
  }
  if (store.projects.length === 1) return store.projects[0];
  if (store.projects.length === 0) {
    vscode.window.showInformationMessage('No zed-pkg project was detected in this workspace.');
    return null;
  }
  const selected = await vscode.window.showQuickPick(
    store.projects.map((project) => ({ label: project.label, description: project.root, project })),
    { title: 'Choose a zed-pkg project' }
  );
  return selected?.project ?? null;
}

async function openFile(store, root, kind) {
  const project = await selectProject(store, root);
  if (!project) return;
  const uri = kind === 'manifest' ? project.manifestUri : project.lockUri;
  if (!uri) {
    vscode.window.showInformationMessage(`${kind === 'manifest' ? '.zpkg.toml' : '.zpkg.lock'} does not exist in ${project.root}.`);
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

async function executeAction(store, output, actionName, root) {
  const project = await selectProject(store, root);
  if (!project) return;
  if (actionName === 'openManifest') return openFile(store, project.root, 'manifest');
  if (actionName === 'openLockfile') return openFile(store, project.root, 'lock');

  const action = ACTIONS[actionName];
  if (!action) throw new Error(`Unknown action: ${actionName}`);
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('Trust this workspace before running zed-pkg CLI commands. Read-only manifest and lockfile insights remain available.');
    return;
  }
  if (!store.cli.available) {
    const choice = await vscode.window.showWarningMessage('The zed-pkg CLI was not detected. Configure zedPackage.binaryPath and refresh.', 'Open Settings');
    if (choice === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'zedPackage.binaryPath');
    return;
  }
  const args = await actionArguments(actionName, project);
  if (!args) return;
  if (action.mutating) {
    const choice = await vscode.window.showWarningMessage(
      `Run ${store.cli.binary} ${args.join(' ')} in ${project.root}?`,
      { modal: true, detail: 'The extension passes arguments directly to the CLI without a shell.' },
      'Run'
    );
    if (choice !== 'Run') return;
  }

  const timeoutSeconds = vscode.workspace.getConfiguration('zedPackage').get('commandTimeoutSeconds', 120);
  output.show(true);
  output.appendLine(`\n$ ${store.cli.binary} ${args.join(' ')}`);
  output.appendLine(`[cwd] ${project.root}`);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Zed Package: ${action.label}`, cancellable: false },
      () => runProcess(store.cli.binary, args, project.root, timeoutSeconds * 1000, output, true)
    );
    vscode.window.showInformationMessage(`${action.label} completed.`);
    await store.refresh();
  } catch (error) {
    output.appendLine(`\n[error] ${error.stack ?? error}`);
    vscode.window.showErrorMessage(`${action.label} failed. See “Zed Package” output for details.`);
  }
}

async function actionArguments(actionName, project) {
  switch (actionName) {
    case 'install': return ['install'];
    case 'frozenInstall': return project.hasManifest
      ? ['install', '--frozen']
      : ['install', '--frozen', '--do-not-write-new-manifest'];
    case 'addDependency': {
      const value = await vscode.window.showInputBox({
        title: 'Add a zed-pkg dependency',
        prompt: 'Package spec, for example acme/http-kit@^1',
        validateInput: (input) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@\S+)?$/.test(input.trim())
          ? null
          : 'Use <org>/<name> or <org>/<name>@<requirement> without whitespace.'
      });
      return value ? ['add', value.trim()] : null;
    }
    case 'removeDependency': {
      const dependencies = project.manifest?.dependencies ?? [];
      if (dependencies.length === 0) {
        vscode.window.showInformationMessage('This manifest has no direct dependency entries.');
        return null;
      }
      const selected = await vscode.window.showQuickPick(
        dependencies.map((dependency) => ({ label: dependency.name, description: dependency.requirement })),
        { title: 'Remove a direct zed-pkg dependency' }
      );
      return selected ? ['remove', selected.label] : null;
    }
    case 'storeStatus': return ['store', 'status'];
    case 'authStatus': return ['auth', 'status'];
    case 'releasePlan': return ['release', 'plan', '--json'];
    case 'releasePreflight': return ['release', 'preflight'];
    case 'selfUpdateCheck': return ['self-update', '--check'];
    default: return null;
  }
}

function reportHtml(projects) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const projectSections = projects.map((project) => {
    const findings = project.findings.length === 0
      ? '<p class="ok">No problems detected.</p>'
      : `<ul>${project.findings.map((item) => `<li class="${escapeHtml(item.severity)}"><strong>${escapeHtml(item.severity.toUpperCase())}</strong> ${escapeHtml(item.message)}${item.recommendation ? `<br><span>${escapeHtml(item.recommendation)}</span>` : ''}</li>`).join('')}</ul>`;
    const dependencies = project.manifest?.dependencies?.length
      ? `<table><thead><tr><th>Dependency</th><th>Requirement</th><th>Kind</th></tr></thead><tbody>${project.manifest.dependencies.map((dependency) => `<tr><td>${escapeHtml(dependency.name)}</td><td>${escapeHtml(dependency.requirement)}</td><td>${escapeHtml(dependency.kind)}</td></tr>`).join('')}</tbody></table>`
      : '<p>No direct dependencies detected.</p>';
    return `<section>
      <h2>${escapeHtml(project.label)}</h2>
      <p class="path">${escapeHtml(project.root)}</p>
      <div class="grid">
        <div><strong>Manifest</strong><br>${project.hasManifest ? 'present' : 'missing'}</div>
        <div><strong>Lockfile</strong><br>${project.hasLock ? 'present' : 'missing'}</div>
        <div><strong>zed_modules</strong><br>${project.hasModules ? 'present' : 'missing'}</div>
        <div><strong>CLI</strong><br>${escapeHtml(project.cli.available ? project.cli.version ?? 'available' : 'unavailable')}</div>
      </div>
      <h3>Problems and resolutions</h3>${findings}
      <h3>Direct dependencies</h3>${dependencies}
    </section>`;
  }).join('');

  return `<!doctype html><html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style nonce="${nonce}">
      body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;line-height:1.45}
      h1{margin-top:0}section{border-top:1px solid var(--vscode-panel-border);padding:20px 0}.path{opacity:.75;word-break:break-all}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.grid>div{padding:12px;background:var(--vscode-editor-inactiveSelectionBackground);border-radius:6px}
      table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--vscode-panel-border)}
      li{margin:10px 0}.error strong{color:var(--vscode-errorForeground)}.warning strong{color:var(--vscode-editorWarning-foreground)}.information strong{color:var(--vscode-editorInfo-foreground)}.ok{color:var(--vscode-testing-iconPassed)}
    </style></head><body><h1>Zed Package Report</h1>${projectSections || '<p>No zed-pkg projects were detected.</p>'}</body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function showReport(store, root) {
  const selected = root ? await selectProject(store, root) : null;
  const projects = selected ? [selected] : store.projects;
  const panel = vscode.window.createWebviewPanel('zedPackage.report', 'Zed Package Report', vscode.ViewColumn.Active, {
    enableScripts: false,
    retainContextWhenHidden: false,
    localResourceRoots: []
  });
  panel.webview.html = reportHtml(projects);
}

function updateStatusBar(statusBar, store) {
  const errors = store.projects.reduce((sum, project) => sum + project.counts.error, 0);
  const warnings = store.projects.reduce((sum, project) => sum + project.counts.warning, 0);
  statusBar.text = errors > 0
    ? `$(error) Zed: ${errors} error${errors === 1 ? '' : 's'}`
    : warnings > 0
      ? `$(warning) Zed: ${warnings} warning${warnings === 1 ? '' : 's'}`
      : store.projects.length > 0
        ? '$(package) Zed: healthy'
        : '$(package) Zed';
  statusBar.tooltip = `${store.projects.length} zed-pkg project(s); click to open the report.`;
  statusBar.command = 'zedPackage.showReport';
  statusBar.show();
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Zed Package');
  const diagnostics = vscode.languages.createDiagnosticCollection('zedPackage');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 45);
  const store = new ProjectStore(output, diagnostics);
  const providers = [
    ['zedPackage.overview', 'overview'],
    ['zedPackage.dependencies', 'dependencies'],
    ['zedPackage.problems', 'problems'],
    ['zedPackage.actions', 'actions']
  ].map(([view, kind]) => {
    const provider = new ZedTreeProvider(store, kind);
    context.subscriptions.push(vscode.window.registerTreeDataProvider(view, provider), provider);
    return provider;
  });
  void providers;

  context.subscriptions.push(output, diagnostics, statusBar, store);
  context.subscriptions.push(store.onDidChange(() => updateStatusBar(statusBar, store)));
  context.subscriptions.push(vscode.commands.registerCommand('zedPackage.refresh', () => store.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('zedPackage.showReport', (root) => showReport(store, root)));
  context.subscriptions.push(vscode.commands.registerCommand('zedPackage.openManifest', (root) => openFile(store, root, 'manifest')));
  context.subscriptions.push(vscode.commands.registerCommand('zedPackage.openLockfile', (root) => openFile(store, root, 'lock')));

  for (const actionName of Object.keys(ACTIONS)) {
    if (actionName === 'openManifest' || actionName === 'openLockfile') continue;
    context.subscriptions.push(vscode.commands.registerCommand(commandForAction(actionName), (root) => executeAction(store, output, actionName, root)));
  }

  const watcher = vscode.workspace.createFileSystemWatcher('**/.zpkg.{toml,lock}');
  watcher.onDidCreate(() => store.scheduleRefresh());
  watcher.onDidChange(() => store.scheduleRefresh());
  watcher.onDidDelete(() => store.scheduleRefresh());
  context.subscriptions.push(watcher);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('zedPackage')) store.scheduleRefresh(0);
  }));
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => store.scheduleRefresh(0)));

  await store.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
