# AI Project Engine v2 — Master Specification

A **dynamic, tool-agnostic engine** that takes any software requirement from idea to production with an AI coding agent:
Claude Code, GitHub Copilot (VS Code agent mode / coding agent), Cursor or Cline.

v1 was a set of instructions the AI was *asked* to follow. v2 adds a small CLI, **`engine/engine.mjs`**, which *enforces* the workflow:
- a task can't be completed while quality gates fail;
- a phase can't start until a human approves the previous one;
- secret files can't be committed;
- the AI's working context stays small.

Everything project-specific lives in one file, **`engine.config.jsonc`**.

---

## 1. Goals (your original 4 pillars, made real)

| v1 pillar | Problem in v1 | v2 mechanism |
|---|---|---|
| Adaptive model routing | An instruction file can't switch models. Model names hard-coded and outdated. | `models` tiers in config → generated **subagents** (Claude Code) and **prompt files** (Copilot) each carry their model. Tasks can carry `model:` hints. |
| Disk-based SDLC state | Summary grew forever. "Token saver" contradicted itself (Prompt 2 read 4 full docs). | `engine next` writes a **focused task file with only the referenced contract sections**. `engine status` replaces reading the docs after `/clear`. `engine compact` archives old log entries. |
| Deterministic quality gates | Only asked for, never enforced. Unit tests only. | Gates come from config (any stack). **`engine done` re-runs them and refuses on failure.** The Stop hook keeps the agent working while gates fail. CI runs the same gates. Optional E2E / secret-scan gates. |
| Zero-trust secrets | Relied on `.gitignore` and `git add .`. | Secret-file globs in config. Pre-edit/pre-bash **hooks** block touching or staging secrets. `engine done` **refuses to commit** them. `.gitignore` is managed. OIDC for deployments. |

Plus what v1 lacked: **human checkpoints**, a **blocked protocol**, **re-planning**, **reviews**, a **decision log**, **multi-stack profiles**, **brownfield support**, and correct **tool integration files**.

---

## 2. Lifecycle

```
/engine-start ──► /engine-plan ──► [approve plan] ──► /engine-build ⟲ ──► /engine-review ──► [approve phase] ──► … ──► /engine-audit ──► [approve deploy] ──► /engine-deploy
 Phase 0           Phase 1          HUMAN               Phase 2 per phase    read-only           HUMAN                     Phase 3             HUMAN                Phase 4
```

| Phase | Command | Model tier | Output | Gate / checkpoint |
|---|---|---|---|---|
| 0 Discovery | `/engine-start` | planning | config filled, `1_PRD.md` | Questions answered in one batch |
| 1 Plan | `/engine-plan` | planning | `2_ARCHITECTURE`, `3_SCHEMAS`, `4_TASKS`, `8_DECISIONS`, `.env.example` | **`engine approve plan`** (human) |
| 2 Build | `/engine-build` | coding | code + tests, one commit per task | Gates on every `done`; stops per `autonomy.mode` |
| 2b Review | `/engine-review` | review | findings → new fix tasks | **`engine approve phase "<name>"`** (human) |
| 3 Audit | `/engine-audit` | planning | `7_SECURITY_AUDIT.md`, fixes | All gates green |
| 4 Deploy | `/engine-deploy` | planning | Dockerfile, compose, IaC, CI/CD, `DEPLOYMENT_GUIDE.md` | **`engine approve deploy`** (human) |
| any | `/engine-resume` | fast | state recovered from `engine status` | — |
| any | `/engine-replan` | planning | updated docs and tasks, decision recorded | Large changes stop for approval |

### The build loop (enforced)
```
engine next ──► 5_CURRENT_TASK.md (criteria + extracted contracts + files)
   └─► failing test ──► minimal code ──► engine gate ──► fix (≤ maxFixAttempts) ──► engine done T# "summary"
                                                         └─► engine block T# "reason" → STOP
engine done = re-run gates → refuse on failure → secret check → mark [x] → log → commit "feat(T#): …" → phase/checkpoint check
```

---

## 3. Dynamic configuration (`engine.config.jsonc`)

| Key | What it controls |
|---|---|
| `project.name/goal/type` | Rendered into every rules file and prompt |
| `stack.profile/description/conventions` | Coding rules in `AGENTS.md`; `.gitignore` entries; CI toolchain setup |
| `commands.install/dev/gates[]` | **The quality gates** (`name`, `run`, `required`). Any stack, any tool, e.g. add `npx playwright test` or `gitleaks detect` |
| `autonomy.mode` | `task` (stop after each) · `phase` (stop per phase) · `all` (run to completion) |
| `autonomy.maxFixAttempts` | Fix attempts before `block` |
| `checkpoints[]` | `after-plan`, `after-phase`, `before-deploy`. Enforced by `engine next` |
| `context.*` | Log entries kept, gate output lines shown, when to suggest `/clear` |
| `models.claude/copilot` | Model per tier: `planning`, `coding`, `review`, `fast` |
| `git.commitPerTask/commitTrailer` | Commit behaviour |
| `deploy.target/environments` | Used by `/engine-deploy` and the devops agent |
| `security.secretFiles/allowSecretFiles` | Globs guarded by hooks and by `done` |
| `hooks.guardSecrets/gateOnStop` | Which Claude Code hooks `sync` installs |
| `mcp.servers` | Written once to `.mcp.json` and `.vscode/mcp.json` |
| `projectRules[]` | Project-specific rules learned along the way, rendered into `AGENTS.md` |

**Profiles** (`engine/profiles/*.jsonc`): `node-ts`, `python`, `dotnet`, `go`, `java-gradle`. Add your own by copying one. `engine init --profile <id>` seeds the config from a profile; after that the config is the source of truth.

**Change anything → `node engine/engine.mjs sync`** regenerates:

| Generated file | Tool | Notes |
|---|---|---|
| `AGENTS.md` | All (canonical rules) | Commands, gates, conventions and rules rendered from config |
| `CLAUDE.md` | Claude Code | `@AGENTS.md` import |
| `.github/copilot-instructions.md` | GitHub Copilot | Pointer + summary |
| `.cursor/rules/engine.mdc` | Cursor | `alwaysApply: true` |
| `.clinerules` | Cline | Pointer |
| `.claude/agents/*.md` | Claude Code | architect, implementer, reviewer, security-auditor, devops; **each with its model** |
| `.claude/commands/engine-*.md` | Claude Code | `/engine-start` … `/engine-deploy` |
| `.github/prompts/engine-*.prompt.md` | Copilot (VS Code) | Same commands; model per tier if set |
| `.claude/settings.json` | Claude Code | Hooks **merged** into existing settings |
| `.mcp.json`, `.vscode/mcp.json` | Claude Code / Copilot | Created once (context7 for current library docs, Playwright for UI checks) |
| `.github/workflows/engine-ci.yml` | GitHub Actions | Created once; runs `engine gate --ci` |

Files marked "created once" are yours afterwards; `sync --force` regenerates them.

---

## 4. Token & context strategy (honest version)

What actually reduces tokens and keeps quality high, in order of impact:

1. **Focused task context.** Tasks carry `refs: 3_SCHEMAS.md#Orders`. `engine next` copies only those sections into `5_CURRENT_TASK.md`, and the agent is told to read only that file and the files it lists.
2. **Compressed gate output.** Passing gates print one line. Failing gates print only the last `context.gateOutputLines` lines, with colour codes stripped.
3. **Cheap resume.** After `/clear`, `engine status` (about 15 lines) replaces re-reading the docs.
4. **Bounded memory.** `6_STATE_SUMMARY.md` keeps the newest N log entries. Older ones move to `docs/archive/` (read only on demand).
5. **Clear at phase boundaries, not every task.** Clearing after every task forces re-reading. The engine suggests `/clear` per `context.clearAfter`.
6. **Model tiers.** Planning, audit and deploy use the strong tier. Implementation uses the coding tier. Resume uses the fast tier.
7. **Short replies.** `AGENTS.md` asks for brief status reports.

No fixed "x % saving" is claimed. The saving depends on project size, the tool and the model. Measure with your tool's usage view.

---

## 5. Model routing by tool

| Tool | How routing works with v2 |
|---|---|
| **Claude Code** | Subagents in `.claude/agents/` have `model:` from `models.claude`. Commands set `model:` per phase. `/engine-build` delegates each task to the `implementer` subagent. |
| **Copilot (VS Code)** | Prompt files set `model:` from `models.copilot` (use the exact picker name). Empty means you choose it in the picker. |
| **Copilot coding agent (github.com)** | Uses `AGENTS.md` + `.github/copilot-instructions.md`. Assign it a task issue; gates run in CI. |
| **Cursor / Cline** | Read the pointer rules. Pick the model per chat manually (planning tier for /engine-plan, coding tier for builds). |

---

## 6. Enforcement layers

| Layer | Works in | What it guarantees |
|---|---|---|
| `engine done` / `engine next` | Every tool (it's a CLI) | No completion with failing gates. Checkpoints respected. No secret commits. |
| Claude Code hooks | Claude Code | Agent can't stop mid-task with red gates. Can't edit or stage `.env*`. No force-push or `--no-verify`. |
| CI (`engine gate --ci`) | GitHub | The same gates on every push and PR, independent of any AI. |
| Branch protection (recommended) | GitHub | Require the CI check plus a human review before merging to `main`. |

---

## 7. Daily cheat-sheet

```bash
node engine/engine.mjs init --profile node-ts   # once per project (also for existing repos)
/engine-start  →  /engine-plan                  # in your AI tool
node engine/engine.mjs approve plan             # YOU, after reading docs/1–4
/engine-build                                   # AI builds until the phase ends
/engine-review                                  # AI reviews; fix tasks get added
node engine/engine.mjs approve phase "Phase 1: Foundation"
/clear  →  /engine-resume                       # fresh context, continues
/engine-audit  →  node engine/engine.mjs approve deploy  →  /engine-deploy
node engine/engine.mjs status | doctor | gate   # any time
```

---

## 8. Known limits
- The engine needs **Node 18+** on the machine (even for Python, .NET, Go or Java projects) and **git**.
- Hooks are Claude Code–specific. Other tools rely on `engine done` and CI for enforcement.
- Copilot prompt-file frontmatter keys can change between VS Code releases. If a key is rejected, adjust `frontmatter()` in `engine.mjs`.
- Third-party integrations still can't be truly verified without real credentials. The engine makes the AI say so instead of pretending.
- Human checkpoints rely on humans running `approve`. The AI is instructed never to, but discipline matters.
