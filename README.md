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

### Claude Code (full version)

Requires [bun](https://bun.sh) for session persistence.

```bash
# Install bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Clone into your project's skills directory
git clone https://github.com/boxabirds/spec-coach.git
cp -r spec-coach/.claude/skills/spec-coach your-project/.claude/skills/
```

Or install as a Claude Code plugin:
```bash
# Add the marketplace catalog, then install
claude /plugin marketplace add https://raw.githubusercontent.com/boxabirds/spec-coach/main/marketplace/.claude-plugin/marketplace.json
claude /plugin install spec-coach
```

Note: plugin installation copies files only — bun must be installed separately for persistence to work.

### Other Coding Agents (lite version)

Copy the appropriate rules file into your project root:

| Agent | File to copy |
|-------|-------------|
| Generic / AGENTS.md | `lite/AGENTS.md` |
| Cursor | `lite/.cursorrules` |
| Windsurf | `lite/.windsurfrules` |
| GitHub Copilot | `lite/.github/copilot-instructions.md` |

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
  AGENTS.md             # Generic rules file
  .cursorrules          # Cursor rules file
  .windsurfrules        # Windsurf rules file
  .github/
    copilot-instructions.md  # GitHub Copilot instructions

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
