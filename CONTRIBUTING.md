# Contributing to Orbicheck

Thank you for your interest in contributing to Orbicheck! We welcome contributions that improve the codebase, documentation, or features. This guide outlines how to get started, submit changes, and best practices.

## Code of Conduct

We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to abide by its terms.

## Development Setup

Follow the [Quick Start](README.md#quick-start) in the root README.md to set up the project locally.

- Install dependencies: `pnpm install` (from root).
- Run migrations and seed: `cd apps/api && pnpm run migrate && pnpm run seed`.
- Start dev stack: `pnpm run infra` (from root) or `docker compose -f infra/compose/dev.compose.yml up -d`.
- Run API: `cd apps/api && pnpm run dev`.

## How to Contribute

1. **Fork the Repository:** Create a fork on GitHub.
2. **Create a Branch:** Use a descriptive name, e.g., `feature/add-new-validator` or `fix/issue-123`.
3. **Make Changes:** 
   - Ensure changes are focused on a single feature or bug.
   - Add or update tests (Jest for unit, k6 for load).
   - Update documentation (README.md, apps/api/README.md).
   - Follow TypeScript best practices: Use strict typing, add JSDoc for functions.
4. **Commit Messages:** Use conventional commits, e.g., `feat(validators): add new email check` or `fix: resolve dedupe query performance`.
5. **Push and PR:** Push to your fork and open a Pull Request (PR) to `main`. Reference any issues.

## AI-Assisted Contributions

If using an AI tool (e.g., in VS Code with Code mode):
- **Exploration:** Start with root README.md and apps/api/README.md for setup. Use `list_files` on `.` for structure, `list_code_definition_names` on `apps/api/src/` for functions/routes (e.g., validateEmail in validators/email.ts).
- **File Handling:** Always `read_file` before edits (e.g., multiple: server.ts, web.ts, routes/rules.ts). Paths relative to /home/bastiat/Repositories/orbicheck.

- **Planning:** Use Architect mode to design changes before coding.
- **Code Changes:** Read files with `read_file` first. Use `apply_diff` for targeted edits (e.g., updating a route in `apps/api/src/routes/rules.ts`). Add JSDoc comments like:
  ```typescript
  /**
   * Validates email format and MX records.
   * @param email - The email address to validate.
   * @returns Promise resolving to validation result.
   */
  async function validateEmail(email: string): Promise<ValidationResult> { ... }
  ```
- **Testing:** Unit: `cd apps/api && pnpm run test` (59+ tests; mocks DB/Redis). Load: `./bin/k6 run tests/k6/email.js` (hits 8081 proxy—may 502; edit to 8080 direct). Integration: Use Swagger or curl with seeded API key.
  **AI Tip:** If tests fail (404/401), verify /v1/ prefix in web.ts; add --coverage. For k6, add auth headers with seeded key.
- **Linting:** `pnpm lint` (ESLint/Prettier); fix via `pnpm lint --fix`.
- **Database:** Add migrations: `touch apps/api/migrations/$(date +%s)_name.sql`, edit SQL, run `pnpm run migrate`. Seed: `pnpm exec ts-node --require dotenv/config src/seed.ts` (dotenv essential).
- **Dependencies:** `cd apps/api && pnpm add <pkg>` (e.g., new validator lib); updates package.json automatically in workspace.
- **Verification:** `search_files` for patterns (e.g., regex `reason_codes.*email` in src/); `execute_command` for verification commands.

**AI-Specific Troubleshooting:**
- **Podman Compose:** Use `podman compose` (native); if "command not found", install podman-compose or use docker compose. No sudo; enable user namespaces.
- **Proxy 502:** Caddy proxies to api:8080; fails if API binds only 127.0.0.1 (logs show it, but 0.0.0.0 actual). Test direct localhost:8080; verify with `podman logs compose-api-1` and `podman exec ... curl localhost:8080/health`.
- **BullMQ/Valkey Error:** `{ maxRetriesPerRequest: null }` in IORedis (src/server.ts:81); required for container Valkey.
- **GeoNames 404:** Script URL outdated; download zips manually (http://download.geonames.org/export/zip/), unzip to data/, update importer.ts to process multiple. Or skip—use Nominatim for geo.
- **Seed SASL/Password:** Ensure dotenv/config in command; DATABASE_URL correct (service names in container).
- **Tests:** Jest: 404/401 if /v1/ mismatch or no API_KEY env. k6: Edit URL to 8080, add Bearer auth.
- **Compose YAML:** Indentation strict; read_file to check services: level.
- **ts-node:** Always `pnpm exec ts-node --require dotenv/config` for scripts.
- **pnpm Warnings:** Approve build scripts if needed (`pnpm approve-builds`).

AI contributions should follow the same review process as human ones. Use todo lists (`update_todo_list`) for multi-step tasks; confirm tool results before proceeding.

## Testing

- **Unit Tests:** Add to `apps/api/src/__tests__/`. Run with `pnpm test`.
- **Load Tests:** Update or add k6 scripts in `tests/k6/`. Run with `./bin/k6 run tests/k6/email.js`.
- **Integration:** Test API endpoints with Swagger UI (localhost:8080/documentation) or Supertest.

Aim for 80%+ coverage on new code.

## Documentation

- Update inline comments and JSDoc for new functions.
- Enhance README.md sections for new features.
- Add examples to apps/api/README.md for API endpoints.

## Pull Request Guidelines

- **Title:** Clear and concise, e.g., "Add phone OTP validation".
- **Description:** Explain what/why, reference issues, include screenshots if UI-related.
- **Checklist:**
  - [ ] Tests pass.
  - [ ] Linting passes.
  - [ ] Documentation updated.
  - [ ] No breaking changes (or changelog updated).

PRs are reviewed for quality, security, and alignment with project goals. Expect feedback and iterations.

## Security Issues

Report vulnerabilities privately to support@orbitcheck.io. Do not open public issues.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

For questions, reach out via PR comments or email.