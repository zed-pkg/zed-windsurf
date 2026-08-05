'use strict';

const { extractLock, extractManifest, parseToml } = require('./toml-lite');

const SEVERITY_ORDER = { error: 0, warning: 1, information: 2, hint: 3 };

function finding(id, severity, message, options = {}) {
  return {
    id,
    severity,
    message,
    detail: options.detail ?? null,
    recommendation: options.recommendation ?? null,
    action: options.action ?? null,
    file: options.file ?? null,
    line: Number.isInteger(options.line) ? options.line : 0
  };
}

function packageLabel(manifest, rootName) {
  const org = manifest?.package?.org;
  const name = manifest?.package?.name;
  if (org && name) return `${org}/${name}`;
  return name || rootName;
}

function analyzeProject(input) {
  const manifestParsed = input.manifestText === null || input.manifestText === undefined
    ? null
    : parseToml(input.manifestText);
  const lockParsed = input.lockText === null || input.lockText === undefined
    ? null
    : parseToml(input.lockText);
  const manifest = manifestParsed ? extractManifest(manifestParsed) : null;
  const lock = lockParsed ? extractLock(lockParsed) : null;
  const findings = [];

  for (const error of manifestParsed?.errors ?? []) {
    findings.push(finding('manifest-parse', 'error', error.message, {
      file: 'manifest', line: error.line,
      recommendation: 'Correct the TOML syntax before running a mutating zed command.'
    }));
  }
  for (const error of lockParsed?.errors ?? []) {
    findings.push(finding('lock-parse', 'error', error.message, {
      file: 'lock', line: error.line,
      recommendation: 'Regenerate the lock with zed install after reviewing any local changes.'
    }));
  }

  if (!manifest && lock) {
    findings.push(finding('lock-only', 'warning', 'This project has a lockfile but no manifest.', {
      file: 'lock',
      detail: 'A lockfile does not preserve which dependencies were direct versus transitive.',
      recommendation: 'Restore it explicitly with a frozen, manifestless install or create a reviewed .zpkg.toml.',
      action: 'frozenInstall'
    }));
  }

  if (manifest) {
    if (!manifest.package.org) {
      findings.push(finding('package-org-missing', 'error', '[package].org is missing.', {
        file: 'manifest',
        recommendation: 'Set the package namespace or run zed init in a new package.'
      }));
    }
    if (!manifest.package.name) {
      findings.push(finding('package-name-missing', 'error', '[package].name is missing.', {
        file: 'manifest',
        recommendation: 'Set the package name or run zed init in a new package.'
      }));
    }
    if (!manifest.package.version) {
      findings.push(finding('package-version-missing', 'error', '[package].version is missing.', {
        file: 'manifest',
        recommendation: 'Set a version that matches the package version scheme.'
      }));
    }
    if (manifest.generatedConsumer) {
      findings.push(finding('generated-consumer', 'information', 'This is a generated consumer manifest.', {
        file: 'manifest',
        detail: 'Publishing stays blocked until package identity and repository metadata are reviewed.',
        recommendation: 'Review the generated identity before treating this repository as a publishable package.',
        action: 'openManifest'
      }));
    }
    if (manifest.dependencies.length > 0 && !lock) {
      findings.push(finding('lock-missing', 'warning', 'Direct dependencies exist but .zpkg.lock is missing.', {
        file: 'manifest',
        recommendation: 'Resolve dependencies and create the lockfile with zed install.',
        action: 'install'
      }));
    }
  }

  if (lock && lock.formatVersion !== null && lock.formatVersion !== '1') {
    findings.push(finding('lock-version-unknown', 'warning', `Lockfile format version ${lock.formatVersion} is not recognized by this extension.`, {
      file: 'lock',
      recommendation: 'Use the installed zed CLI as the source of truth and update the extension before editing the lockfile.'
    }));
  }

  if ((manifest || lock) && !input.hasModules) {
    findings.push(finding('modules-missing', 'warning', 'zed_modules is not materialized for this project.', {
      file: lock ? 'lock' : 'manifest',
      recommendation: lock ? 'Restore exactly from the lockfile.' : 'Resolve and install declared dependencies.',
      action: lock ? 'frozenInstall' : 'install'
    }));
  }

  if (manifest && lock && manifest.dependencies.length > 0 && lock.packages.length > 0) {
    const lockedNames = new Set(lock.packages.map((entry) => entry.name));
    for (const dependency of manifest.dependencies) {
      if (!lockedNames.has(dependency.name)) {
        findings.push(finding('dependency-not-locked', 'warning', `${dependency.name} is declared but not visible in the parsed lock entries.`, {
          file: 'manifest', line: dependency.line,
          detail: 'The CLI remains authoritative if the lock uses a newer representation than this extension understands.',
          recommendation: 'Run a frozen install to validate the lock, or a normal install to refresh it intentionally.',
          action: 'frozenInstall'
        }));
      }
    }
  }

  if (!input.cli?.available) {
    if (input.cli?.reason === 'workspace-untrusted') {
      findings.push(finding('cli-untrusted', 'information', 'CLI inspection is disabled in Restricted Mode.', {
        detail: input.cli.error ?? null,
        recommendation: 'Trust the workspace to enable zed-pkg CLI detection and commands.'
      }));
    } else {
      findings.push(finding('cli-unavailable', 'warning', 'The zed-pkg CLI is not available.', {
        detail: input.cli?.error ?? null,
        recommendation: 'Install zed or configure zedPackage.binaryPath. CLI actions stay disabled until detection succeeds.'
      }));
    }
  }

  findings.sort((left, right) => {
    const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    return severity || left.message.localeCompare(right.message);
  });

  const counts = { error: 0, warning: 0, information: 0, hint: 0 };
  for (const item of findings) counts[item.severity] += 1;

  const actionOrder = ['openManifest', 'install', 'frozenInstall', 'addDependency', 'removeDependency', 'releasePlan', 'releasePreflight', 'storeStatus', 'authStatus', 'selfUpdateCheck'];
  const recommended = new Set(findings.map((item) => item.action).filter(Boolean));
  const recommendedActions = actionOrder.filter((action) => recommended.has(action));

  return {
    root: input.root,
    rootName: input.rootName,
    label: packageLabel(manifest, input.rootName),
    manifest,
    lock,
    cli: input.cli,
    hasManifest: Boolean(manifest),
    hasLock: Boolean(lock),
    hasModules: Boolean(input.hasModules),
    findings,
    counts,
    recommendedActions
  };
}

module.exports = { analyzeProject, finding };
