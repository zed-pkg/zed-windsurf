# zed-windsurf

`zed-windsurf` is the Windsurf/Open VSX extension for [zed-pkg](https://zpkg.tech). It reads the actual workspace state and exposes package health, dependency state, diagnostics, and safe CLI-backed resolutions inside the IDE.

Windsurf is a VS Code OSS fork and installs extensions through Open VSX, so the host integration is implemented with the VS Code extension API. C, C++, or Rust would add an unnecessary native boundary for the IDE layer. The analysis modules are deliberately isolated under `src/core/` so a shared Rust/WASM engine can replace them later without changing the Windsurf UI contract.

## Real data sources

The extension does not generate demo or mock package state. It uses:

- workspace `.zpkg.toml` manifests;
- workspace `.zpkg.lock` files;
- the presence of the materialized `zed_modules/` directory;
- the configured local `zed` executable and its real command output.

The `zed` CLI remains authoritative. The extension reports parser uncertainty rather than treating an unfamiliar future lock representation as corruption.

## Features

- Zed Package activity-bar container with Overview, Dependencies, Problems, and Recommended Actions views.
- Diagnostics in `.zpkg.toml` and `.zpkg.lock` for missing package identity, malformed assignments, missing locks, unmaterialized dependencies, lock-only restoration, and unavailable CLI state.
- Workspace status bar and a read-only package report.
- Safe fixed-argument actions for:
  - `zed install`
  - `zed install --frozen`
  - manifestless `zed install --frozen --do-not-write-new-manifest`
  - `zed add` / `zed remove`
  - `zed store status`
  - `zed auth status`
  - `zed release plan --json`
  - `zed release preflight`
  - `zed self-update --check`
- Confirmation before every mutating action.
- Workspace Trust requirement for every CLI execution; mutating actions also require modal confirmation.
- No shell-string execution; the CLI is spawned with `shell: false`.
- Automatic refresh when `.zpkg.toml` or `.zpkg.lock` changes.

## Development

Node.js 22 or newer is recommended.

```sh
npm run check
```

The core parser and analyzer use only Node built-ins, so tests run without installing third-party runtime dependencies.

To build a VSIX:

```sh
npm run package
```

Install the resulting VSIX in Windsurf through the Extensions panel's **Install from VSIX** action.

## Open VSX publication

The extension manifest uses the `zed-pkg` publisher namespace. Before the first release, create or claim that namespace in Open VSX and add an `OVSX_PAT` repository or environment secret. Publishing is handled by `.github/workflows/open-vsx.yml`.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `zedPackage.binaryPath` | `zed` | Machine-scoped command name or absolute path for the zed-pkg CLI. |
| `zedPackage.autoRefresh` | `true` | Refresh after manifest or lock changes. |
| `zedPackage.commandTimeoutSeconds` | `120` | Kill a CLI action that exceeds the configured duration. |
| `zedPackage.maxProjects` | `100` | Bound workspace discovery in large monorepos. |

## Security model

- No credentials are read or persisted by the extension.
- Auth status is displayed only through the user's local `zed auth status` output channel.
- User-provided package specs are validated and passed as one process argument.
- Webview scripts are disabled and the report uses a restrictive Content Security Policy.
- All CLI execution is disabled in untrusted workspaces. Mutating commands additionally require an explicit modal confirmation.

## Branching

`dev` is the integration branch. Feature and fix branches target `dev`; release promotion flows from `dev` to `main` after the organization checks and confidence gates pass.
