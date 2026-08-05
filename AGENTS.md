# Agent instructions

- Treat `zed-cli` and `zed-interfaces` as the canonical command and schema sources.
- Keep the Windsurf host integration compatible with the VS Code API supported by Windsurf and publish through Open VSX.
- Never add mock package state to production code.
- Invoke the zed CLI with an executable plus argument array and `shell: false`; validate any user-controlled argument.
- Require Workspace Trust before every CLI execution and explicit confirmation before mutations.
- Keep credentials, private data, and command output out of commits and fixtures.
- Add or update parser/analyzer/security tests with every behavior change.
- `dev` is the integration branch; production releases promote from `dev` to `main`.
