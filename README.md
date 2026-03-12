# Spec Coach

A specification quality coaching skill for Claude Code and other coding agents. Coaches humans on specification quality using a six-dimension rubric — intervening at the point of authoring, before vague specs get handed to coding agents.

## The Six Dimensions

| Dimension | What it checks |
|-----------|---------------|
| **Testability** | Does each requirement have a measurable threshold and failure case? |
| **Edge Cases** | What happens at boundaries — empty, maximum, concurrent, malformed? |
| **Failure Modes** | What does the system do when things go wrong? |
| **Constraints** | Security, performance, data handling, accessibility, regulatory? |
| **Decomposition** | Is the spec broken into independently verifiable increments? |
| **Autonomy Calibration** | Is the spec adapted for who/what will implement it? |

## Installation

### Via Skills CLI (recommended)

Works with Claude Code, Cursor, Windsurf, Copilot, and any agent supporting the [skills.sh](https://skills.sh/) ecosystem:

```bash
npx skills add boxabirds/spec-coach
```

This installs the full skill including persistence. Requires [bun](https://bun.sh) for session history:

```bash
curl -fsSL https://bun.sh/install | bash
```

To update to the latest version, re-run `npx skills add boxabirds/spec-coach`. There is no auto-update — installed skills are static snapshots.

### Manual install (Claude Code)

```bash
git clone https://github.com/boxabirds/spec-coach.git
cp -r spec-coach/.claude/skills/spec-coach your-project/.claude/skills/
```

### AGENTS.md (lite version)

For agents that don't support Skills 2.0, copy `lite/AGENTS.md` into your project root. [AGENTS.md](https://agents.md/) is the universal standard supported by Cursor, Windsurf, GitHub Copilot, Codex, Gemini CLI, Aider, Zed, Warp, and others.

```bash
cp lite/AGENTS.md your-project/AGENTS.md
```

The lite version has the same rubric and Socratic coaching style but no persistence, no evaluation mode, and no tool-context detection.

## Usage

### Auto-trigger (recommended)

Just start discussing requirements or ask to build something without a spec. The skill activates automatically when it detects you're writing or editing specifications, acceptance criteria, or user stories.

It will **not** activate for bug fixes, refactoring, documentation, or tasks where requirements are already clearly defined.

### Explicit invocation

```
/spec-coach                          # Coach on whatever's in the conversation
/spec-coach path/to/spec.md          # Coach on a specific file
/spec-coach --evaluate path/to/spec.md  # Scored evaluation (1-10 per dimension)
```

### Coaching mode (default)

The skill asks Socratic questions to help you find gaps — it does not rewrite your spec or prescribe solutions. It focuses on the 3 weakest dimensions, one at a time.

### Evaluation mode

Scores all six dimensions (1-10 each) with a metacognitive checkpoint: before showing results, it asks you to predict which dimension is weakest and how confident you are. This builds calibration awareness over time.

### Session persistence

The skill remembers your coaching history across sessions (requires bun). It tracks which dimensions you're strong/weak on and follows up on commitments from prior sessions.

```
# These are natural language — just ask the skill:
"Show me my coaching data"              # runs inspect
"Reset my coaching data"                # walks you through options
"Export my coaching data"               # exports to JSON
```

Data is stored locally in `.spec-coach/data.db` (gitignored by default). No data leaves your machine.

## Project Structure

```
.claude/skills/spec-coach/
  SKILL.md              # The skill definition (prompt + rubric + protocols)
  store.ts              # Persistence layer (bun:sqlite, zero npm deps)
  schema.sql            # Database schema
  store.test.ts         # Unit tests (24 tests)
  store.integration.test.ts  # Integration tests (9 tests)

.claude-plugin/
  plugin.json           # Plugin manifest for marketplace discovery

lite/
  AGENTS.md             # Universal agent instructions (AGENTS.md standard)

marketplace/
  .claude-plugin/
    marketplace.json    # Marketplace catalog entry
```

## Running Tests

```bash
bun test ./.claude/skills/spec-coach/
```

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

Built with [Ceetrix](https://ceetrix.com) for specification management. One-line install: `npx ceetrix`
