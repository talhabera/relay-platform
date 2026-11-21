#!/usr/bin/env bash
# Rebuild origin/preview from origin/main + open same-repo PRs (oldest first).
# Spec: docs/superpowers/specs/2026-08-31-preview-stack-design.md
set -euo pipefail

MARKER='<!-- relay-preview-stack -->'
SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

REBASED=()
MERGED=()
SKIPPED_REBASE=()
SKIPPED_MERGE=()
SKIPPED_FORK=()

log() { printf '%s\n' "$*" >&2; }

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

ensure_clean() {
  git reset --hard HEAD >/dev/null
  git clean -fd >/dev/null
}

upsert_pr_comment() {
  local pr="$1"
  local body="$2"
  local full_body
  full_body=$(printf '%s\n\n%s\n' "$MARKER" "$body")

  local existing
  existing=$(
    gh api "repos/${REPO}/issues/${pr}/comments" --paginate \
      --jq ".[] | select(.body | contains(\"${MARKER}\")) | .id" \
      | head -n1 || true
  )

  if [[ -n "${existing}" ]]; then
    gh api "repos/${REPO}/issues/comments/${existing}" \
      -X PATCH \
      -f body="$full_body" >/dev/null
  else
    gh api "repos/${REPO}/issues/${pr}/comments" \
      -X POST \
      -f body="$full_body" >/dev/null
  fi
}

comment_skip() {
  local pr="$1"
  local reason="$2"
  upsert_pr_comment "$pr" "Preview stack skipped this PR: ${reason}

Resolve locally if needed (\`git fetch origin && git rebase origin/main\`), push, and the stack will retry on the next run."
}

log "Fetching origin/main (and preview if present)..."
git fetch origin main
git fetch origin preview:refs/remotes/origin/preview 2>/dev/null || true

log "Listing open non-draft PRs targeting main..."
mapfile -t PR_JSON < <(
  gh pr list --repo "$REPO" --base main --state open --limit 100 \
    --json number,title,headRefName,headRepository,headRepositoryOwner,isDraft,createdAt,isCrossRepository \
    --jq 'sort_by(.createdAt, .number) | .[] | select(.isDraft == false) | @json'
)

if [[ ${#PR_JSON[@]} -eq 0 ]]; then
  log "No open PRs; resetting preview to main."
  git checkout -B preview origin/main
  git push --force-with-lease origin preview
  {
    echo "## Preview stack"
    echo
    echo "No open non-draft PRs targeting \`main\`. \`preview\` == \`main\`."
  } >>"$SUMMARY_FILE"
  exit 0
fi

declare -a ACTIVE_NUMS=()
declare -a ACTIVE_TITLES=()
declare -a ACTIVE_BRANCHES=()

for pr_json in "${PR_JSON[@]}"; do
  num=$(jq -r '.number' <<<"$pr_json")
  title=$(jq -r '.title' <<<"$pr_json")
  branch=$(jq -r '.headRefName' <<<"$pr_json")
  head_repo=$(jq -r '"\(.headRepositoryOwner.login)/\(.headRepository.name)"' <<<"$pr_json")
  is_cross=$(jq -r '.isCrossRepository | tostring' <<<"$pr_json")
  log "Consider PR #${num} (${branch})"

  if [[ "$is_cross" == "true" ]] || [[ "$head_repo" != "$REPO" ]]; then
    log "  skip fork (${head_repo})"
    comment_skip "$num" "fork / cross-repository heads are not supported in v1 (head: \`${head_repo:-unknown}\`)."
    SKIPPED_FORK+=("#${num}")
    continue
  fi

  ensure_clean
  git fetch origin "refs/heads/${branch}:refs/remotes/origin/${branch}"
  git checkout -B "$branch" "origin/${branch}"

  if git rebase origin/main; then
    if git push --force-with-lease origin "HEAD:refs/heads/${branch}"; then
      log "  rebased and pushed"
      REBASED+=("#${num}")
      ACTIVE_NUMS+=("$num")
      ACTIVE_TITLES+=("$title")
      ACTIVE_BRANCHES+=("$branch")
    else
      log "  rebase ok but push failed"
      ensure_clean
      comment_skip "$num" "rebase succeeded locally but \`git push --force-with-lease\` failed (branch protection?)."
      SKIPPED_REBASE+=("#${num}")
    fi
  else
    log "  rebase conflict"
    git rebase --abort 2>/dev/null || true
    ensure_clean
    comment_skip "$num" "rebase onto \`main\` failed with conflicts."
    SKIPPED_REBASE+=("#${num}")
  fi
done

ensure_clean
git checkout -B preview origin/main

for i in "${!ACTIVE_NUMS[@]}"; do
  num="${ACTIVE_NUMS[$i]}"
  title="${ACTIVE_TITLES[$i]}"
  branch="${ACTIVE_BRANCHES[$i]}"
  log "Merging PR #${num} (${branch}) into preview..."

  # Use updated origin tip after rebase push
  git fetch origin "refs/heads/${branch}:refs/remotes/origin/${branch}"
  if git merge --no-ff -m "preview: merge PR #${num}" "origin/${branch}"; then
    MERGED+=("#${num}")
  else
    log "  merge conflict"
    git merge --abort 2>/dev/null || true
    ensure_clean
    git checkout preview >/dev/null 2>&1 || true
    comment_skip "$num" "merge into \`preview\` failed with conflicts (after rebase onto \`main\`)."
    SKIPPED_MERGE+=("#${num}")
  fi
done

log "Pushing preview..."
git push --force-with-lease origin preview

{
  echo "## Preview stack"
  echo
  echo "| Result | PRs |"
  echo "| --- | --- |"
  echo "| Rebased | ${REBASED[*]:-(none)} |"
  echo "| Merged into preview | ${MERGED[*]:-(none)} |"
  echo "| Skipped (rebase) | ${SKIPPED_REBASE[*]:-(none)} |"
  echo "| Skipped (merge) | ${SKIPPED_MERGE[*]:-(none)} |"
  echo "| Skipped (fork) | ${SKIPPED_FORK[*]:-(none)} |"
} >>"$SUMMARY_FILE"

log "Done."
