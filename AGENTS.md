# Agent instructions

- Treat `zed-cli` and `zed-interfaces` as the canonical command and schema sources.
- Keep the Windsurf host integration compatible with the VS Code API supported by Windsurf and publish through Open VSX.
- Never add mock package state to production code.
- Invoke the zed CLI with an executable plus argument array and `shell: false`; validate any user-controlled argument.
- Require Workspace Trust before every CLI execution and explicit confirmation before mutations.
- Keep credentials, private data, and command output out of commits and fixtures.
- Add or update parser/analyzer/security tests with every behavior change.
- `dev` is the integration branch; production releases promote from `dev` to `main`.

## Repository-local Git worktrees

- Create or use a Git worktree only when the human operator explicitly authorizes it for the current task. Concurrency or a dirty checkout is not permission by itself.
- Put every authorized worktree at `<repository-root>/tmp/worktrees/<name>`; from the repository root, use `./tmp/worktrees/<name>`. Never place worktrees beside repositories or organization directories.
- Keep `tmp`, `temp`, `tmp/worktrees`, and `temp/worktrees` ignored in the repository-root `.gitignore`. Do not commit files from those directories.
- Relocate or remove a worktree only when the operator explicitly requests it. Before removal, preserve and publish intended changes, verify its commit is represented on the target branch, and confirm there are no tracked, untracked, ignored-sensitive, or in-use files that must survive. Remove it with `git worktree remove <path>` without `--force`; never delete a worktree directory with `rm`.
