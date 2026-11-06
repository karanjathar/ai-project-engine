# AI Project Engine v2

Turn any software idea into a production-ready, tested and deployed project with an AI coding agent: **Claude Code, GitHub Copilot, Cursor or Cline**.
The engine is a single dependency-free script (`engine/engine.mjs`) plus templates. It drives the workflow and **enforces** quality instead of just asking for it.

- **Dynamic:** one config file (`engine.config.jsonc`) sets stack, gates, models, autonomy, checkpoints and deploy target. Profiles for Node/TS, Python, .NET, Go and Java.
- **Enforced:** tasks can't be marked done while gates fail. Phases need human approval. Secret files can't be edited or committed.
- **Token-efficient:** each task gets only the contract sections it references. Gate output is truncated to the failing tail. A compact `status` replaces re-reading docs after `/clear`.
- **Multi-tool:** `sync` generates `AGENTS.md`, `CLAUDE.md`, Copilot instructions and prompts, Cursor rules, Cline rules, Claude subagents (with model routing), slash commands, hooks, MCP config and CI.

## Quick start (new or existing project)
```bash
# 1. Copy the engine/ folder into your project root, then:
git init                                              # if not a repo yet
node engine/engine.mjs init --profile node-ts         # or python | dotnet | go | java-gradle
node engine/engine.mjs doctor                         # check tools
```
2. Open your AI tool in the folder:
   - **Claude Code:** type `/engine-start`
   - **VS Code Copilot (agent mode):** run the prompt `engine-start` (type `/engine-start` in chat)
   - **Cursor / Cline:** say "Follow AGENTS.md and run the engine-start step" (the prompt text is in `.claude/commands/engine-start.md`)
3. Answer the discovery questions, then run `/engine-plan`, review `docs/`, and approve:
   ```bash
   node engine/engine.mjs approve plan
   ```
4. Run `/engine-build`. It works phase by phase and stops at each checkpoint for `/engine-review` and your approval.
5. Run `/engine-audit`, then `node engine/engine.mjs approve deploy`, then `/engine-deploy`.

## Commands
| CLI (`node engine/engine.mjs …`) | Purpose |
|---|---|
| `init --profile <id>` · `profiles` · `sync` · `doctor` | Set up, regenerate, check |
| `next` · `gate` · `done <T#> "<summary>"` · `block <T#> "<reason>"` | Build loop |
| `add-task "<Phase>" "<spec>"` · `status` · `compact` | Planning and context |
| `approve plan` · `approve phase "<name>"` · `approve deploy` | **Human** checkpoints |

| AI command | Phase |
|---|---|
| `/engine-start` | Discovery → PRD and config |
| `/engine-plan` | Architecture, schemas, task graph (stops for approval) |
| `/engine-build` | TDD build loop |
| `/engine-review` | Read-only phase review |
| `/engine-resume` | Continue after `/clear` |
| `/engine-replan` | Scope change |
| `/engine-audit` | Security audit |
| `/engine-deploy` | Containers, IaC, CI/CD |

Full specification: **[ENGINE.md](ENGINE.md)**. Engine self-test: `node --test engine/selftest.mjs`.

## Layout
```
engine/
  engine.mjs            the CLI (no dependencies, Node 18+)
  selftest.mjs          engine tests (named so project test runners ignore it)
  profiles/*.jsonc      stack profiles
  templates/            AGENTS.md, pointer, agents/, commands/, docs/, ci.yml, engine.config.jsonc
ENGINE.md               specification
```
After `init`, your project also has `engine.config.jsonc`, `docs/1–8`, `AGENTS.md` and the generated tool files.
