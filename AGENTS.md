# AGENTS.md

## Project

JSR Explorer is an Electron + Vite + Vue 3 + TypeScript application.

Use `pnpm` for all package management and scripts.

## Commands

- Install dependencies: `pnpm install`
- Start development: `pnpm dev`
- Type-check: `pnpm typecheck`
- Build: `pnpm build`

The Vite renderer development server must use port `24357` with `strictPort`.
If the port is already in use, the dev server should fail instead of choosing another port.

## Development Rules

- Keep the initial renderer blank unless the user asks for UI or behavior.
- Prefer small, focused changes.
- Do not introduce a new framework, package manager, or build tool unless the user asks for it.
- Keep Electron main/preload code minimal and scoped to application startup until product requirements are defined.

## Verification

Before committing code changes, run the relevant checks. For general project changes, run:

```bash
pnpm typecheck
pnpm build
```

## Git

Use Conventional Commits for commit messages, for example:

- `feat: add package explorer shell`
- `fix: use fixed vite dev port`
- `chore: update project instructions`

After completing requested changes and verification, commit and push the branch unless the user explicitly asks not to.
