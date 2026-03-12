# Spec Coaching Skill — Design Research

Draft — March 2026
Julian Harris, Great Creations London Ltd

## What This Is

Research and design notes for a Claude Code skill that coaches humans on specification quality. The skill uses the Claude Code Skills 2.0 architecture. It helps teams embed a six-dimension specification rubric into daily practice — intervening at the point of authoring, before vague specs get handed to coding agents.

## The Problem It Solves

Leaders understand why specification rigour matters. Their teams continue writing vague specs because nothing in their workflow intervenes at the point of authoring. The gap between "leader understands the framework" and "team changes its practice" is where most training dies.

The spec coaching skill closes this gap by providing real-time, conversational coaching when someone is writing or editing a specification — before the spec is handed to a coding agent.

## How Skills 2.0 Actually Works

Understanding the execution model is essential because it constrains what the skill can and cannot do.

A skill is a `SKILL.md` file with YAML frontmatter and a markdown body, stored in `.claude/skills/<skill-name>/`. The frontmatter declares metadata (name, description, allowed tools, model, context mode). The body contains the instructions Claude follows when the skill is active.

### The execution model

1. **Skill descriptions are loaded into Claude's system prompt** every turn. Claude sees a list of available skills and their descriptions.
2. **There is a single `Skill` tool** in Claude's tool spec. When the user types `/spec-coach` or Claude decides a skill is relevant, it calls `Skill(name="spec-coach", args="...")`.
3. **The skill body is injected as prompt content.** `$ARGUMENTS` are substituted, `` !`shell commands` `` are executed and their output spliced in. Claude then follows the instructions using whatever tools `allowed-tools` grants.
4. **`context: fork` spawns an isolated subagent** — a separate Claude API call with its own context window. The skill body becomes the subagent's task prompt. The subagent works, returns a result, and the parent continues. Without `context: fork`, the skill runs inline in the main conversation.
5. **Skills are stateless.** They run, produce output, and the context is gone. There is no built-in persistence, no session memory, no inter-invocation state. Any persistence must be handled externally — via the filesystem, a helper script, or an MCP server.

### What skills can do

- Read, search, and edit files in the repo (via `allowed-tools`)
- Run shell commands (via Bash tool access)
- Inspect project structure, git history, test suites
- Spawn as isolated subagents with their own context windows
- Inject dynamic context at load time via `` !`command` `` syntax

### What skills cannot do

- Provide real-time feedback during authoring (they activate once per invocation, not continuously)
- Persist data between invocations (stateless by design)
- Switch models mid-execution (a single `model` field applies to the whole invocation)
- Reliably auto-trigger on semantic content (the `description` field is a hint to Claude, not a pattern-matching engine)
- Trigger dependency installations when distributed as plugins (plugins are file-copy only — no install hooks, no post-install scripts, no prerequisite declarations)

### Plugin distribution

Skills can be packaged as plugins and distributed via marketplace catalogs. A marketplace is a `marketplace.json` pointing to GitHub repos, npm packages, or git URLs. Users install with `/plugin install`. Plugin skills are namespaced: `/softwarepilots:spec-coach`. Installation copies files only — any runtime prerequisites (like bun) must be documented and pre-installed by the user.

## Why a Claude Code Skill (Not an MCP Server or Standalone Product)

Skills 2.0 properties that make this viable:

- **Zero deployment friction.** Skills live in the repo (`.claude/skills/` directory). Anyone who clones the repo gets the skills. Alternatively, distribute as a plugin via a marketplace catalog.
- **Tool access.** The skill can read the existing test suite, check the codebase for related specs, run shell commands, and pull context from the project — all via `allowed-tools` in the frontmatter.
- **Context isolation.** With `context: fork`, the coaching conversation runs as an isolated subagent with its own context window. The main coding session is unaffected.
- **Dynamic context injection.** The `` !`command` `` syntax in the skill body executes shell commands at load time and splices their output into the prompt. The skill can pre-load project structure, author history, and spec tool detection without consuming tool-call round trips.
- **Workflow/Preference category.** Skills are informally categorised as "Capability Uplift" (temporary, expires as models improve) or "Workflow/Preference" (permanent, encodes team practices). The spec coaching skill is firmly in the second category — it encodes a team's specification standards, not a model capability gap. It doesn't expire when models get better.

Comparison to alternatives:

- **MCP server:** Requires deployment, auth, infrastructure maintenance. Higher capability ceiling (could serve multiple tools, persist data across sessions) but much higher adoption friction. Better suited for process enforcement tools than for coaching.
- **Standalone product:** Maximum capability but maximum friction. Requires users to leave their workflow. Not viable as a first deployment.
- **Cursor rules / .cursorrules:** Static instructions, no tool calling, no feedback loop, no eval. Insufficient for coaching.

## Trigger Design

The trigger question is critical. Tying activation to a specific folder path (e.g. `**/specs/**`) is brittle and assumes a project structure most teams don't have.

### Layered trigger strategy

**Layer 1: Detect existing tool structures.** If the repo contains `.speckit/`, `.kiro/specs/`, or Ceetrix configuration, the skill knows the team's spec format and activates when files in those directories are created or edited. The skill can then coach within the format the team already uses — EARS notation for Kiro teams, Spec Kit's four-phase structure for Spec Kit teams, Ceetrix's story/PRD/tech-design flow for Ceetrix teams.

**Layer 2: Detect requirements-like content regardless of location.** The skill activates when Claude is working with a document containing requirements-like language — acceptance criteria, user stories, WHEN/SHALL patterns, GIVEN/WHEN/THEN, or structured requirement headings. Pattern-matching on intent, not location. Catches specs in READMEs, GitHub issue templates, DESIGN.md files, Notion exports, anywhere.

**Layer 3: Detect the absence of specification.** The highest-value trigger. When someone asks Claude to build something and there's no spec file anywhere in the repo (or no spec for this specific feature), the skill intervenes: "Before we build, let's get the requirements clear." This catches the moment most people skip — the jump from idea to prompt without specifying what success looks like.

### Discoverability is the product

If the skill only works when someone remembers to type `/spec-coach`, it fails. The whole point is to intervene *before* people skip the spec — at the moment they're most likely to jump straight to prompting. The skill must be discoverable by default. Explicit invocation is the fallback, not the primary path.

The mechanism is the `description` field. Claude reads it every turn and decides whether to call the `Skill` tool. This is Claude making a judgment call, not a pattern-matching engine — it will sometimes misfire. But the description can be crafted to be specific enough to catch the two critical moments:

**Moment 1: The user is talking about requirements.** The `description` should trigger when the conversation involves acceptance criteria, user stories, WHEN/SHALL patterns, GIVEN/WHEN/THEN, feature requirements, or any structured specification language. This is Layer 2.

**Moment 2: The user is about to build without a spec.** When someone says "build me a login page" or "add a feature that does X" and there's no spec in the conversation or the repo, the skill should intervene: "Before we build, let's get the requirements clear." This is Layer 3 — the highest-value trigger.

### Draft description field

The `description` is the entire auto-trigger mechanism. It must be precise enough to catch both moments without being so aggressive it fires on every conversation. Draft:

```yaml
description: >
  Activate when the user is writing, editing, or discussing software requirements,
  specifications, acceptance criteria, user stories, or feature definitions.
  Also activate when the user asks to build, implement, or create a feature
  and no specification or requirements document has been referenced or exists
  in the conversation. Do NOT activate for bug fixes, refactoring, documentation,
  or tasks where requirements are already clearly defined in the conversation.
```

The negative constraints ("Do NOT activate for...") are as important as the positive triggers. Without them, the skill fires on every "build me X" request, which is most requests, which makes it annoying.

### How each layer maps to Skills 2.0 mechanics

**Layer 1 is reliable.** The skill uses dynamic context injection (`` !`ls .speckit/ .kiro/specs/ 2>/dev/null` ``) or Glob/Bash tool calls during execution to detect existing spec structures. This is deterministic — either the directory exists or it doesn't. When detected, the skill adapts its coaching to the team's existing format.

**Layer 2 depends on the description field.** Claude reads the description, notices the user is discussing requirements, and calls the `Skill` tool. The quality of this trigger depends entirely on how well the `description` is written and how well Claude interprets it. It will sometimes fire when it shouldn't (user mentions "requirements" in passing) and miss when it should (user writes a spec without using standard terminology). This needs iteration — track which sessions were auto-triggered vs. explicitly invoked, and tune the description based on false positive/negative rates.

**Layer 3 is the hardest and most valuable.** Absence detection ("user wants to build but hasn't specified") requires Claude to notice that no spec exists for what's being requested. The `description` field covers the conversational case ("user asks to build X and no spec has been referenced"). For the repo case ("no spec file exists for this feature"), dynamic context injection can check: `` !`find . -name "*.spec.md" -o -path "*/.speckit/*" -o -path "*/.kiro/specs/*" | head -5` ``. If nothing is found, the skill's prompt can include "No specification files detected in this repository" as context.

**Explicit invocation (`/spec-coach`) remains the guaranteed path.** Auto-triggering is the primary discovery mechanism, but when it doesn't fire (or when the user wants to coach on a specific existing spec), `/spec-coach path/to/spec.md` always works.

### Tuning the trigger

The persistence layer records `trigger_layer` for each session. Over time this shows:
- How often is the skill auto-triggered vs. explicitly invoked?
- Do auto-triggered sessions have higher or lower engagement?
- Which trigger layer (2 or 3) produces more valuable coaching sessions?

If auto-triggering produces annoyance (users dismiss the skill), the description needs tightening. If it's never triggering, the description needs broadening. There's no built-in eval for this — it's manual analysis of the SQLite data.

## Coaching Model

### Core principle: Socratic, not evaluative

The primary interface is conversational, not a report card. The skill asks questions the author isn't asking themselves. It doesn't rewrite the spec — it helps the author make it better.

### Question curriculum

The skill scores internally against six rubric dimensions but surfaces them as coaching questions, not scores. Each dimension has a question bank graduated by gap severity — the skill doesn't ask all questions, it selects the ones that matter for *this* spec (see "Context-relevant question selection" below).

**1. Testability.** Does each requirement have a measurable threshold and a failure case?

- *Missing entirely:* "I can't find any measurable acceptance criteria. How will you know this feature works? What would you check?"
- *Vague thresholds:* "You've said the system should be 'fast.' What's the target in milliseconds? On what connection speed? What latency is unacceptable?"
- *No failure definition:* "You've defined what success looks like. What does failure look like? What's the threshold where this is broken?"
- *Untestable language:* "The phrase 'user-friendly' appears three times. Can you replace each with something a test could verify?"

**2. Edge case coverage.** What happens at the boundaries — empty, maximum, concurrent, malformed?

- *No edge cases mentioned:* "What happens when the user submits an empty form? What about a 10MB file when the limit is 5MB?"
- *Missing concurrency:* "What happens when two users edit the same record at the same time? Who wins?"
- *Missing data boundaries:* "What's the maximum number of items this list can hold? What happens at that limit?"
- *No external failure:* "This calls a third-party API. What happens when that API is down? When it responds in 30 seconds instead of 2?"

**3. Failure mode specification.** What does the system do when things go wrong?

- *Happy path only:* "You've specified what happens when login succeeds. What happens after five consecutive failures? What error does the user see?"
- *No error messages:* "When this validation fails, what exact message does the user see? Is it actionable?"
- *No recovery path:* "If this process fails halfway through, what state is the data in? Can the user retry safely?"
- *No degradation strategy:* "If the recommendation engine is unavailable, does the page show nothing, a fallback, or an error? Who decides?"

**4. Constraint completeness.** Security, performance, data handling, accessibility, regulatory.

- *No security constraints:* "Where are API keys stored? Who can access this endpoint? Is data encrypted at rest and in transit?"
- *No performance constraints:* "How many concurrent users must this handle? What's the p95 response time target?"
- *No data handling:* "How long is user data retained? Can users delete their data? What's the backup strategy?"
- *No accessibility:* "Does this need to meet WCAG standards? What's the minimum contrast ratio? Can this be navigated by keyboard?"
- *No regulatory:* "Does this handle PII? Is there a GDPR/CCPA compliance requirement?"

**5. Decomposition quality.** Is the spec broken into independently verifiable increments?

- *Monolithic spec:* "This spec covers authentication, profile management, and notifications. Could you verify authentication works before building the other two?"
- *Hidden dependencies:* "Step 3 depends on step 1, but could someone build step 2 independently? Where are the real dependency boundaries?"
- *No verification points:* "At what point can you check that the first increment works before committing to the rest?"
- *Too granular:* "These 15 tasks could be 4 verifiable increments. Which ones must be verified together to mean anything?"

**6. Autonomy calibration.** Is the spec adapted for the autonomy level of the consuming agent?

- *No negative constraints:* "You're using Claude Code in autonomous mode. You've specified what the agent should do. What must it NOT do?"
- *Over-specified implementation:* "You've prescribed React with useState for this component. Is that a hard requirement, or should the agent choose the implementation?"
- *Under-specified guardrails:* "The agent will have write access to the database. What tables is it allowed to modify? What's off-limits?"
- *No autonomy context:* "Who reviews the agent's output? Is this fully autonomous, human-in-the-loop, or pair-programming? The spec should say."

### Context-relevant question selection

The skill doesn't dump all questions on the author. It selects based on what's actually missing from *this* spec. The selection logic is part of the SKILL.md prompt — Claude reads the spec, assesses each dimension, and picks the highest-value questions.

The prompt instructs Claude to:

1. **Read the spec** and identify which dimensions are adequately covered vs. which have gaps.
2. **Prioritise by severity** — a spec with no testability criteria at all gets the "missing entirely" questions, not the "vague thresholds" refinement questions.
3. **Limit to three dimensions per session** — coaching is most effective when focused. Asking about all six dimensions in one session overwhelms. The skill picks the three weakest and saves the rest for next time.
4. **Use persistent history if available** — if `context-brief` reports that this author consistently misses edge cases, the skill weights edge case questions higher even if this particular spec seems adequate. The pattern matters more than the instance.
5. **Adapt to tool context** — if the repo uses Kiro, frame questions in EARS notation ("Does this WHEN/SHALL statement have a measurable threshold?"). If Ceetrix, frame around PRD requirements and design capabilities.

This selection logic is encoded in the SKILL.md prompt, not in code. Claude does the reasoning. The question bank gives it the ammunition. The persistent history gives it the targeting data.

### Conversation memory

The skill is stateless per invocation, but coaching is a relationship, not a transaction. The skill needs to remember what's been discussed so conversations can be picked up intelligently.

**Two levels of memory, both stored via `store.ts`:**

**Level 1: Aggregate scoring history (already designed).** The `context-brief` output tells the skill "this author is weak on edge cases, improving on testability." This shapes question selection across all specs.

**Level 2: Per-spec session notes.** At the end of each coaching session, the skill generates a brief summary (~100 tokens) of what was discussed and what the author committed to. This is stored in a `session_notes` column on the `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN session_notes TEXT;
-- e.g. "Discussed auth-flow spec. Author missing failure modes for
-- login and token refresh. Committed to adding 5xx handling and
-- retry logic. Edge case coverage not addressed — defer to next session."
```

When the skill is invoked for a spec it has seen before, `store.ts` returns the most recent session notes for that spec alongside the aggregate brief:

```bash
bun run .claude/skills/spec-coach/store.ts context-brief --spec-name "auth-flow-v2"
```

Output:

> **Author history:** Julian — 14 sessions, weak on edge cases (avg 4.1), strong on decomposition (avg 8.2). Calibration improving.
>
> **Last session on this spec (3 days ago):** Discussed auth-flow spec. Author missing failure modes for login and token refresh. Committed to adding 5xx handling and retry logic. Edge case coverage not addressed — defer to next session.

This gives the skill conversational continuity without storing full transcripts. The session notes are generated by Claude at the end of the coaching conversation and persisted via `store.ts save-session --session-notes "..."`.

**What this enables:** The skill can open with "Last time we looked at this spec, you were going to add failure modes for login and token refresh. Did you?" — a follow-up question grounded in the prior conversation, not a cold start.

**What this doesn't do:** It doesn't replay the full prior conversation. It doesn't remember the exact wording of every question asked. It remembers the *outcome* — what gaps were identified and what the author said they'd fix. That's sufficient for coaching continuity.

### Two modes, not two phases

The original design imagined "inline coaching during authoring" — paragraph-level feedback in real time. Skills don't work that way. A skill activates once per invocation, not continuously. There is no mechanism for paragraph-level monitoring.

Instead, the skill operates in two distinct modes, triggered by how the user invokes it:

**Coaching mode (`/spec-coach path/to/spec.md`).** The default. The skill reads the spec, identifies gaps against the rubric dimensions, and asks Socratic questions. It does not score. It does not rewrite. It asks the questions the author isn't asking themselves. Uses `model: sonnet` in the frontmatter — faster, cheaper, and coaching questions don't require frontier reasoning.

**Evaluation mode (`/spec-coach --evaluate path/to/spec.md`).** Explicit request for a full rubric assessment. Runs all six dimensions, produces a structured score with specific gaps identified. This is the evaluator. Uses the default model (typically Opus) for thorough analysis. Note: you cannot switch models mid-skill, so evaluation mode is effectively a separate invocation with different arguments that the skill prompt interprets to change its behaviour.

The tutor's job is to ask questions. The evaluator's job is to score. Same skill, different argument, different prompt path.

### Metacognitive checkpoint (from Barbara Oakley's recommendation)

Before showing the evaluation score, the skill asks the author to predict their own performance: "Before I score this, how confident are you in the spec? Which dimension do you think is weakest?" The gap between prediction and actual score is the learning signal. Over time, improvement in self-assessment accuracy is the best predictor of specification maturity.

Self-assessment data is stored per author via the persistence layer described below. The longitudinal trend — are people getting better at knowing what they don't know? — is the most valuable metric for leaders.

## State Persistence Architecture

Skills are stateless. Every invocation starts from zero. For longitudinal tracking (scoring history, self-assessment calibration, per-team aggregates), persistence must be handled externally.

### Design decision: bun script + SQLite

The skill shells out to a helper script (`store.ts`) via the Bash tool. The script handles all data operations using `bun:sqlite` — SQLite bindings built into the bun runtime with zero npm dependencies.

**Why not JSONL or markdown files?** The consumer of historical data is the skill itself — an LLM subagent with a finite context window. JSONL means Claude has to read the entire file and parse it in-context. After 50 sessions that's thousands of tokens of raw JSON burned on retrieval, and the model is doing arithmetic it will get wrong. SQLite returns pre-computed aggregates. The skill never sees raw database rows.

### File layout

```
.claude/skills/spec-coach/
  SKILL.md              # Skill definition
  store.ts              # Data layer (ships with the skill)
  schema.sql            # Migration file (readable, auditable)

.spec-coach/            # Data directory (project root, gitignored)
  data.db               # SQLite database
```

The skill code ships in `.claude/skills/spec-coach/` (where Skills 2.0 expects it). The data lives in `.spec-coach/` at project root because scoring data is sensitive and should not travel with the skill distribution.

### Runtime prerequisite: bun

`bun:sqlite` requires the bun runtime. Plugins cannot trigger dependency installations — they are file-copy only. bun must be pre-installed on the user's machine.

The `store.ts` script checks for bun at startup and fails with a clear message:

```
Error: spec-coach persistence requires bun >= 1.0.
Install: https://bun.sh/docs/installation
The skill works without persistence — coaching and evaluation
function normally, but session history will not be tracked.
```

This means the skill degrades gracefully. Coaching and evaluation work without persistence (they're pure prompt logic). Longitudinal tracking is the feature that requires bun. Teams that don't use bun still get the core coaching value — they just don't get history.

### Store script subcommands

```bash
# Create .spec-coach/ directory and database (idempotent)
bun run .claude/skills/spec-coach/store.ts init

# Persist a coaching/evaluation session
bun run .claude/skills/spec-coach/store.ts save-session \
  --spec-name "auth-flow-v2" \
  --spec-path "docs/specs/auth-flow.md" \
  --tool-context "ceetrix" \
  --phase "evaluation" \
  --scores '{"testability":7,"edge_cases":4,"failure_modes":6,...}' \
  --predictions '{"testability":8,"edge_cases":6,...}'

# Compact author history for prompt injection (~200 tokens)
# Includes last session notes for --spec-name if provided
bun run .claude/skills/spec-coach/store.ts context-brief
bun run .claude/skills/spec-coach/store.ts context-brief --spec-name "auth-flow-v2"

# Anonymised team aggregates
bun run .claude/skills/spec-coach/store.ts team-summary
```

Author identification uses `git config user.email` — already configured on every developer machine, stable across sessions, same identity that appears in git log.

### The context-brief output

This is the key design decision. The `context-brief` subcommand does not return raw data. It returns pre-formatted natural language suitable for direct injection into the skill prompt:

> Julian has completed 14 coaching sessions. Strongest dimensions: decomposition (avg 8.2), testability (avg 7.8). Weakest: edge case coverage (avg 4.1, declining). Calibration accuracy improving — prediction gap narrowed from avg 2.3 to 1.1 over last 8 sessions. Priority coaching focus: edge case coverage, constraint completeness.

The skill injects this via dynamic context (`` !`bun run .claude/skills/spec-coach/store.ts context-brief` ``) or via an explicit Bash tool call during execution.

### Data flow

1. Skill invoked → author identified via `git config user.email`
2. Skill calls `store.ts context-brief --spec-name X` → aggregate history + last session notes for this spec injected into context
3. Skill reads the spec document via Read/Grep/Glob tools
4. If prior session notes exist for this spec, skill opens with follow-up: "Last time we discussed X, you committed to Y. Did you add it?"
5. Skill selects questions based on spec gaps, author history, and dimensions not yet covered in prior sessions
6. Skill conducts coaching or evaluation
7. Skill generates ~100 token session summary of what was discussed and what the author committed to
8. Skill calls `store.ts save-session --session-notes "..." --scores "..."` → persists session
9. Next invocation picks up where the last one left off

### Privacy model

`.spec-coach/` is gitignored by default. Scoring data is local and private to each developer's machine. Teams opt in to sharing by removing the gitignore entry and committing the database. Individual data is never aggregated without explicit opt-in — the `team-summary` subcommand only works when multiple authors' data exists in the same database (which only happens if the team commits the DB or uses a shared filesystem).

## Compatibility with Existing Spec Tools

The skill should work alongside, not instead of, existing tools:

**Spec Kit teams:** The skill activates during the Specify and Plan phases. It coaches within Spec Kit's structure — does the spec cover what the Plan will need? Are the tasks derived from the spec independently verifiable? The skill reads `.speckit/` files and understands the four-phase workflow.

**Kiro teams:** The skill coaches within EARS notation. It checks whether each WHEN/SHALL statement is testable, whether failure conditions are covered, whether non-functional requirements are specified. It reads `.kiro/specs/` and understands the three-file structure.

**Ceetrix teams:** The skill complements Ceetrix's enforcement layer. Ceetrix enforces the process (story → PRD → tech design → tasks → verification). The coaching skill helps the human write better content at each stage. Ceetrix is the guardrail for the agent; the skill is the coach for the human.

**Teams using none of these:** The skill works with any markdown document that contains requirements. It provides the rubric dimensions as a coaching framework regardless of format. This is the lowest-friction entry point — no tooling adoption required, just write a spec and get coaching.

## Data Model and Longitudinal Tracking

The persistence layer stores everything in SQLite via `store.ts`. The schema:

### SQLite schema

```sql
CREATE TABLE authors (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,  -- from git config user.email
  display_name  TEXT,                  -- from git config user.name
  first_seen_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY,
  author_id     INTEGER NOT NULL REFERENCES authors(id),
  spec_name     TEXT NOT NULL,
  spec_path     TEXT,                  -- file path if available
  tool_context  TEXT,                  -- 'speckit' | 'kiro' | 'ceetrix' | 'generic'
  trigger_layer INTEGER,              -- 1, 2, or 3 per trigger design
  phase         TEXT NOT NULL,         -- 'coaching' | 'evaluation'
  session_notes TEXT,                  -- ~100 token summary of what was discussed and committed to
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE dimension_scores (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES sessions(id),
  dimension_key TEXT NOT NULL,         -- 'testability', 'edge_cases', etc.
  score         INTEGER NOT NULL,      -- 1-10
  feedback      TEXT,
  UNIQUE(session_id, dimension_key)
);

CREATE TABLE self_assessments (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES sessions(id),
  dimension_key   TEXT NOT NULL,
  predicted_score INTEGER NOT NULL,    -- 1-10
  actual_score    INTEGER,             -- filled after evaluation
  gap             INTEGER,             -- actual - predicted
  UNIQUE(session_id, dimension_key)
);
```

### What this enables

**Per-author queries:** Recent scores, trend direction per dimension, calibration accuracy trend. All computed by the `context-brief` subcommand and returned as a compact paragraph the skill can inject directly into its context.

**Per-team queries:** Anonymised averages, weakest dimensions across the team, session count per author. Computed by `team-summary`.

### Leader dashboard signal

Not individual scores — that kills trust. Team-level trends surfaced via `team-summary`:

- "Specification quality across your team improved 30% this quarter."
- "Edge case coverage is still weak — 4 of 8 engineers consistently miss failure mode specification."
- "Verification independence is flat — your team is still relying primarily on agent-generated tests."
- "Recommended intervention: run the constraint specification micro-module at next team meeting."

This is not a web dashboard. It's a CLI output from `store.ts team-summary` that a leader runs locally or that a scheduled report generates. A web dashboard is a later-stage product decision, not an MVP feature.

## Micro-Learning Content Integration

The coaching skill can serve short teaching content at the point of need, triggered by persistent gap patterns observed across an author's sessions:

- Author consistently misses constraint specs → 5-minute coaching prompt on security, performance, data handling, and accessibility constraints during next spec session
- Author over-trusts agent output → material on probabilistic systems and the risks of cognitive surrender ("the AI said it's done, so it must be done") served as context
- Author writes untestable criteria → material on testable acceptance criteria with measurable thresholds served inline
- Author doesn't decompose → material on vertical slicing, walking skeleton patterns, and dependency mapping served when spec exceeds a complexity threshold

The content isn't a course. It's a library the coaching agent draws from based on observed practice gaps. The author never "takes a module" — they get the right 5-minute intervention at the right moment.

## Eval Strategy

There is no built-in eval or A/B testing framework in Skills 2.0. Measurement must be built into the persistence layer and compared manually.

### Direct metrics (from SQLite data)

- Spec quality score improvement over time (per author, per team) — queried from `dimension_scores` table
- Self-assessment calibration improvement (prediction accuracy trending up) — queried from `self_assessments` table, the `gap` column trending toward zero
- Session frequency and trigger layer distribution — which triggers produce engagement?

### Downstream metrics (requires integration with delivery pipeline)

- Defect rate for features built from coached specs vs. uncoached specs
- Verification gap count (spec requirements without corresponding tests) for coached vs. uncoached
- Time-to-ship for features with coached specs vs. uncoached
- Number of post-ship specification changes (proxy for "we didn't think of this")

These require correlating spec coaching sessions with delivery outcomes. If the team uses a process enforcement tool with gate tracking, story completion data and gate pass rates provide the delivery side. Otherwise this is manual tracking.

### A/B test design

Deploy the skill as a plugin to half the team. Compare SQLite data (spec quality scores, calibration trends) between the two groups. For downstream metrics, compare defect rates and verification gaps. This is manual comparison, not an automated framework — but the data is all in SQLite and queryable.

## Build Sequence

1. **`/spec-coach` MVP with auto-triggering.** The skill ships with the `description` field tuned for Layer 2 (requirements-like content) and Layer 3 (building without a spec) from day one. Discoverability is not a later feature — it's the product. The skill runs the rubric in coaching mode (Socratic questions, no scores). Also supports explicit invocation via `/spec-coach path/to/spec.md`. No persistence. Deliverable: `SKILL.md` with the rubric prompt, the question curriculum, the `description` field, `allowed-tools`, and dynamic context injection for project structure detection.

2. **Add evaluation mode.** `/spec-coach --evaluate` runs the full rubric with scores. Metacognitive checkpoint asks the author to predict before scoring. Still no persistence — scores are shown but not stored. Validates the evaluation rubric calibration.

3. **Add persistence and conversation memory.** `store.ts` + SQLite. Evaluation sessions are stored with session notes. `context-brief` injects author history and per-spec session notes into subsequent invocations. Self-assessment calibration is tracked. `trigger_layer` is recorded to measure auto-trigger effectiveness. This is where the skill becomes a learning tool, not just a one-shot coach. Prerequisite: bun runtime.

4. **Tune auto-triggering.** Analyse trigger data from step 3. Which sessions were auto-triggered vs. explicitly invoked? What's the false positive rate? Tighten or broaden the `description` field based on real usage. Add negative constraints if the skill is firing too often.

5. **Add compatibility layers.** Spec Kit, Kiro, Ceetrix format awareness in the prompt. The skill detects the team's spec tooling and adapts its coaching questions to the format.

6. **Add micro-learning content.** Short curriculum modules (constraint specification, failure mode analysis, testability patterns, etc.) served at point of need, triggered by persistent gap patterns (e.g. "author consistently misses constraint specs → serve constraint specification material").

## Relationship to Process Enforcement Tools

The coaching skill is designed to complement, not replace, process enforcement tools like Ceetrix, Spec Kit, or Kiro. These tools enforce structure on the *agent* side (e.g. "you can't proceed to implementation without a PRD"). The coaching skill develops the *human* side (e.g. "here's how to write a PRD that actually covers failure modes").

The pattern:

- **Enforcement tools** tell the agent "you can't proceed without a spec." The coaching skill helps the human write a better spec.
- **Enforcement tools** gate on verification coverage. The coaching skill helps the human understand what verification means and design it.
- **Enforcement tools** capture process data (what was specified, what was built, what was verified). The coaching skill captures human development data (are specs getting better? are people learning?).

One enforces the process. The other develops the people. They share the specification rubric as a common quality standard. If a team uses an enforcement tool, the coaching skill adapts its questions to that tool's format and terminology.

## Open Questions

### Resolved

- **Should the coaching skill share rubric definitions with enforcement tools?** Yes. A shared `rubric.ts` ships with the skill. If a team uses an enforcement tool (Ceetrix, Spec Kit, etc.), the same dimensions and scoring scale should apply to both human coaching and agent enforcement.
- **Privacy model?** Resolved: `.spec-coach/` is gitignored by default. Scoring data is local and private. Teams opt in to sharing by committing the DB.

### Still open

- **`context: fork` and conversation flow.** Does a forked subagent support multi-turn conversation (coaching back-and-forth with the author), or does it return a single result? If single result, the Socratic back-and-forth must happen inline (no fork) or the skill must be invoked multiple times. This needs testing.
- **`AskUserQuestion` in skills.** The `AskUserQuestion` tool presents interactive choice boxes. It should work in foreground skills (inline or foreground subagent). This would enable the metacognitive checkpoint as a selectable choice ("Which dimension do you think is weakest?" with the six dimensions as options). Underdocumented — needs empirical testing.
- **Dynamic context injection and shell expansion.** Can `` !`command` `` handle nested `$()` expansion (e.g. `` !`bun run store.ts context-brief --author-email $(git config user.email)` ``)? If not, the skill handles identity via an explicit Bash tool call during execution instead of at load time.
- **Format-agnostic vs. format-specific coaching.** The rubric dimensions are format-agnostic. The coaching prompts could be format-specific when a known structure is detected (EARS notation for Kiro teams, four-phase structure for Spec Kit teams). How much format-specific coaching is needed vs. generic? The rubric probably carries most of the value regardless of format.
- **Collaborative specs.** Per-author tracking breaks down when specs are written collaboratively. May need a per-spec tracking mode in addition to per-author. The `sessions` table already tracks `spec_name`, so queries can be per-spec or per-author.
- **Minimum data for useful trends.** Hypothesis: 4 weeks / 10+ specs per team member gives enough signal to identify patterns. Needs validation.
- **bun dependency for non-bun teams.** The persistence layer requires bun. For teams that use Node.js, the alternatives are: (a) install bun just for the coaching skill, (b) port `store.ts` to use `better-sqlite3` via Node.js, or (c) accept no persistence. Option (a) is the pragmatic recommendation — bun installs in seconds and the coaching skill is the only consumer.
- **Session notes quality.** The ~100 token session summary is generated by Claude at the end of each coaching conversation. If the summary is poor (too vague, misses key commitments), the follow-up questions in the next session will be useless. Need to test whether the SKILL.md prompt can reliably produce useful summaries, or whether a structured format (JSON with fields for `gaps_identified`, `commitments_made`, `dimensions_covered`) produces better continuity than free-text.
- **Three-dimension limit per session.** The question selection logic limits coaching to three dimensions per session to avoid overwhelming the author. Is three the right number? Too few and the skill feels shallow. Too many and the author disengages. Needs testing with real users.
