<!--<p align="center">
  <a href="https://kanbancrew.com">
    <picture>
      <source srcset="packages/public/kanban-crew-logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/public/kanban-crew-logo.svg" media="(prefers-color-scheme: light)">
      <img src="packages/public/kanban-crew-logo.svg" alt="Kanban Crew Logo">
    </picture>
  </a>
</p>-->

<p align="center">A local-first kanban board for solo developers running AI agent crews</p>
<p align="center"><strong>⚠️ Work in progress — not ready for general use yet.</strong></p>
<p align="center">
  <a href="https://www.npmjs.com/package/kanban-crew"><img alt="npm" src="https://img.shields.io/npm/v/kanban-crew?style=flat-square" /></a>
  <a href="https://github.com/srcarr1515/kanban-crew/blob/main/.github/workflows/pre-release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/srcarr1515/kanban-crew/.github%2Fworkflows%2Fpre-release.yml" /></a>
</p>

## Overview

Kanban Crew is a local-first task manager built for developers who run AI agent crews. Instead of context-switching between your terminal, editor, and a browser tab full of sticky notes, Kanban Crew gives your agents a proper home: a board where you plan the work, assign it to agents, watch them execute, and review the output — all without leaving your machine.

No account required. No data leaves your computer. Your board lives in a local SQLite database.

- **Plan with a kanban board** — create, prioritize, and organize tasks across columns
- **Assign tasks to AI agents** — designate which agent owns each ticket and track execution
- **Run agents in workspaces** — each workspace gives an agent its own branch, terminal, and dev server
- **Review diffs and leave inline comments** — send feedback directly back to the agent
- **Preview your app** — built-in browser with devtools, inspect mode, and device emulation
<!--- **10+ coding agents supported** — Claude Code, Codex, Gemini CLI, GitHub Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen Code-->
- **MCP server included** — expose your board to agents via the Model Context Protocol
<!--- **Create pull requests and merge** — open PRs with AI-generated descriptions, review, and merge-->

One command to start:

```bash
npx kanban-crew
```

## Installation

Make sure you have authenticated with your coding agent of choice. Then run:

```bash
npx kanban-crew
```

The first run downloads a pre-compiled binary (~30MB) and caches it at `~/.kanban-crew/`. Subsequent runs start instantly.

### Desktop app (optional)

```bash
npx kanban-crew --desktop
```

Launches the native desktop app instead of opening a browser tab.

## MCP Integration

Kanban Crew ships an MCP server so your agents can read and update your board directly.

```bash
npx kanban-crew mcp
```

Add it to your Claude Code, Cursor, or other MCP-compatible client to give agents full board access.

## Support

Open an issue or start a discussion on [GitHub](https://github.com/srcarr1515/kanban-crew/discussions).

## Contributing

This is a solo project — feel free to open issues or PRs. For larger changes, open a discussion first so we can align before you invest the time.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (>=20)
- [pnpm](https://pnpm.io/) (>=8)

Additional tools:
```bash
cargo install cargo-watch
cargo install sqlx-cli
```

Install dependencies:
```bash
pnpm i
```

### Running the dev server

```bash
pnpm run dev
```

Starts the backend and web app. A blank DB is copied from `dev_assets_seed/` on first run.

### Building the web app

```bash
cd packages/local-web
pnpm run build
```

### Build from source

```bash
./local-build.sh
# Test with:
cd npx-cli && node bin/cli.js
```

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | Runtime | Auto | Server port (prod). Frontend port in dev (backend uses PORT+1) |
| `BACKEND_PORT` | Runtime | `0` (auto) | Backend port in dev mode |
| `FRONTEND_PORT` | Runtime | `3000` | Frontend dev server port |
| `HOST` | Runtime | `127.0.0.1` | Backend server host |
| `MCP_HOST` | Runtime | Value of `HOST` | MCP connection host |
| `MCP_PORT` | Runtime | Value of `BACKEND_PORT` | MCP connection port |
| `KANBAN_CREW_DEBUG` | Runtime | Not set | Enable verbose debug logging |
| `KANBAN_CREW_LOCAL` | Runtime | Not set | Force local dev mode (use binaries from `npx-cli/dist/`) |
| `DISABLE_WORKTREE_CLEANUP` | Runtime | Not set | Disable git worktree cleanup (for debugging) |
| `KC_ALLOWED_ORIGINS` | Runtime | Not set | Comma-separated allowed origins for API requests (required when running behind a reverse proxy) |

### Running behind a reverse proxy

Set `KC_ALLOWED_ORIGINS` to the full origin URL where your frontend is accessible:

```bash
# Single origin
KC_ALLOWED_ORIGINS=https://kanban.example.com

# Multiple origins
KC_ALLOWED_ORIGINS=https://kanban.example.com,https://kanban-staging.example.com
```

Without this, the browser's `Origin` header won't match and API requests will return `403 Forbidden`.

## Disclaimer

This software is provided "as is", without warranty of any kind. Kanban Crew creates git branches, worktrees, and runs shell commands on your machine as part of normal operation. **You are responsible for reviewing any changes before merging them.** The authors are not liable for any data loss, corrupted repositories, or other damages. See the [LICENSE](./LICENSE) for full terms.

## Attribution

Kanban Crew is a fork of [vibe-kanban](https://github.com/BloopAI/vibe-kanban) by Bloop AI Ltd, used under the Apache 2.0 License. See [NOTICE](./NOTICE) for details.
