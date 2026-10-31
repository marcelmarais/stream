# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Releasing

Releases are built on this Mac and published straight to GitHub.

```bash
pnpm release --check      # Check credentials and repo state
pnpm release patch --dry-run   # Build, sign and notarize without publishing
pnpm release patch        # Publish (or minor, major, x.y.z)
```

Copy `scripts/release.env.example` to `~/.config/stream/release.env`, fill it in and `chmod 600` it. If this Mac can't release, `gh workflow run release.yml --ref <tag>` runs the same build on GitHub.
