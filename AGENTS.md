# Agents

## Releasing

Always release locally from this Mac. Never use the GitHub Actions `Release`
workflow, because it's too slow.

From a clean `main` that matches `origin/main`, in the primary checkout rather
than a worktree:

```bash
cd stream
pnpm release patch
```

The script builds, signs and notarizes the app, then publishes it. Use
`pnpm release patch --dry-run` to do everything except commit, tag and publish.
