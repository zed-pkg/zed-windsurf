#!/usr/bin/env bash
set -euo pipefail

owner="${1:-zed-pkg}"
repository="${2:-zed-windsurf}"
visibility="${VISIBILITY:-public}"
full_name="${owner}/${repository}"

case "${visibility}" in
  public|private|internal) ;;
  *) echo "VISIBILITY must be public, private, or internal" >&2; exit 2 ;;
esac

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required." >&2
  exit 1
}
gh auth status

git rev-parse --is-inside-work-tree >/dev/null
if gh repo view "${full_name}" >/dev/null 2>&1; then
  echo "Repository ${full_name} already exists; refusing to overwrite it." >&2
  exit 1
fi

if ! git show-ref --verify --quiet refs/heads/main; then
  echo "Local main branch is required." >&2
  exit 1
fi
if ! git show-ref --verify --quiet refs/heads/dev; then
  git branch dev main
fi

gh repo create "${full_name}" "--${visibility}" \
  --description "Windsurf/Open VSX insights and resolutions for zed-pkg projects" \
  --homepage "https://zpkg.tech" \
  --source . \
  --remote origin

git push --set-upstream origin main
git push --set-upstream origin dev
gh repo edit "${full_name}" --add-topic windsurf --add-topic open-vsx --add-topic zed-pkg --add-topic package-manager

echo "Created and pushed ${full_name} with main and dev branches."
