# Contributing

## Getting Started

Kanban Crew is a solo project. External contributions are welcome but not guaranteed to be merged. If you want to contribute, open an issue first to discuss the change.

## Development Setup

- **Rust**: Format with `rustfmt`. Use `snake_case` for modules/functions, `PascalCase` for types.
- **TypeScript/React**: Must pass ESLint and Prettier (2 spaces, single quotes). Use `PascalCase` for components, `camelCase` for variables, `kebab-case` for filenames.
- Run `pnpm run format` before submitting a pull request.
- Run `pnpm run lint` to verify no linting errors.

## Code Quality

- Keep functions small and focused.
- Write self-documenting code. Add comments only where logic isn't obvious.
- Don't introduce unnecessary abstractions.
- Don't manually edit generated files (e.g., `shared/types.ts`).

## Testing

- **Rust**: Add unit tests using `#[cfg(test)]`. Run `cargo test --workspace`.
- **TypeScript**: Ensure `pnpm run check` and `pnpm run lint` pass.

## Security

- Never commit secrets, credentials, or API keys. Use `.env` for local config.
- Report security issues privately via the responsible disclosure process rather than opening a public issue.

## Commit Messages

- Use clear, descriptive commit messages explaining the _why_.
- Use conventional prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Keep subject line under 72 characters.
