# AUTONOMOUS ENGINE OPERATIONAL DIRECTIVES

## 1. CORE OPERATIONAL LAWS
- Act as a Senior Principal Software Architect and Engineer.
- Operating Mode: Autonomous TDD (Test-Driven Development). Write unit tests BEFORE feature code.
- NEVER invent third-party package methods or non-existent API endpoints. Verify syntax against `docs/3_SCHEMAS.md` or official SDK type definitions.
- Implement modifications using SURGICAL DIFFS ONLY. Do not rewrite full files if modifying under 20 lines.

## 2. ADAPTIVE MODEL ROUTING & TOKEN EFFICIENCY
- Match task complexity to the most token-efficient model tier: use fast/balanced models for routine code implementation and frontier reasoning models strictly for architectural planning and security audits.
- Keep prompt contexts lean by reading ONLY the files specified in `docs/5_CURRENT_TASK.md`.

## 3. DETERMINISTIC QUALITY GATES
- No task is complete until it passes terminal quality checks:
  1. Type-Check / Build: `npx tsc --noEmit` (or stack equivalent, e.g., `dotnet build`).
  2. Test Suite: `npm test` (or stack equivalent, e.g., `dotnet test`).
- When terminal errors occur, analyze the exact stack trace line. Fixing errors by using `any` types or suppressing linter rules is strictly prohibited.

## 4. ENVIRONMENT VARIABLE & SECRETS POLICY
- NEVER hardcode secrets, passwords, or connection strings in code. Reference `process.env.KEY` (or stack equivalent).
- Whenever a new environment variable is introduced, immediately append it with a dummy value to `.env.example`.
- Ensure `.env` is listed inside `.gitignore`.

## 5. TOKEN & CONTEXT CONSERVATION
- After every successful test-gate pass:
  1. Run: `git add . && git commit -m "feat: completed task X"`.
  2. Append a 2-sentence summary of built code to `docs/6_STATE_SUMMARY.md`.
  3. Mark task completed `[x]` in `docs/4_TASKS.md`.
  4. Wipe `docs/5_CURRENT_TASK.md`.
