#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

// --- Constants ---

const DATA_DIR = ".spec-coach";
const DB_PATH = join(DATA_DIR, "data.db");
const SCHEMA_PATH = join(dirname(import.meta.path), "schema.sql");
const MIN_SCORE = 1;
const MAX_SCORE = 10;
const CONTEXT_BRIEF_TOKEN_BUDGET = 200;
const TREND_WINDOW_SIZE = 5;
const EXIT_USER_ERROR = 1;
const EXIT_ENV_ERROR = 2;

const DIMENSION_KEYS = [
  "testability",
  "edge_cases",
  "failure_modes",
  "constraints",
  "decomposition",
  "autonomy",
] as const;

// --- Helpers ---

function getGitConfig(key: string): string | null {
  try {
    return execSync(`git config ${key}`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

function ensureDatabase(): Database {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  let db: Database;
  try {
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
  } catch (e) {
    console.error(
      `Database appears corrupted. Delete ${DB_PATH} and try again, or run: bun run store.ts reset-all --confirm`
    );
    process.exit(EXIT_ENV_ERROR);
  }

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

function parseArgs(
  args: string[]
): Record<string, string | boolean | undefined> {
  const parsed: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

function requireFlag(
  args: Record<string, string | boolean | undefined>,
  flag: string
): string {
  const val = args[flag];
  if (!val || val === true) {
    console.error(`Missing required argument: --${flag}`);
    process.exit(EXIT_USER_ERROR);
  }
  return val as string;
}

function getOrCreateAuthor(
  db: Database
): { id: number; email: string; name: string | null } {
  const email = getGitConfig("user.email");
  if (!email) {
    console.error(
      "Cannot identify author: git config user.email is not set."
    );
    process.exit(EXIT_USER_ERROR);
  }
  const name = getGitConfig("user.name");

  db.run(
    `INSERT INTO authors (email, display_name) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name`,
    [email, name]
  );

  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM authors WHERE email = ?")
    .get(email);

  return { id: row!.id, email, name };
}

// --- Subcommand Handlers ---

function handleInit() {
  ensureDatabase();
  console.log(`Initialized ${DB_PATH}`);
}

function handleSaveSession(args: Record<string, string | boolean | undefined>) {
  const db = ensureDatabase();
  const specName = requireFlag(args, "spec-name");
  const specPath = (args["spec-path"] as string) || null;
  const toolContext = (args["tool-context"] as string) || "generic";
  const triggerLayer = args["trigger-layer"]
    ? parseInt(args["trigger-layer"] as string)
    : null;
  const phase = (args["phase"] as string) || "coaching";
  const sessionNotes = (args["session-notes"] as string) || null;

  const author = getOrCreateAuthor(db);

  const result = db.run(
    `INSERT INTO sessions (author_id, spec_name, spec_path, tool_context, trigger_layer, phase, session_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      author.id,
      specName,
      specPath,
      toolContext,
      triggerLayer,
      phase,
      sessionNotes,
    ]
  );
  const sessionId = Number(result.lastInsertRowid);

  let scoreCount = 0;
  if (args.scores && typeof args.scores === "string") {
    const scores = JSON.parse(args.scores);
    const stmt = db.prepare(
      `INSERT INTO dimension_scores (session_id, dimension_key, score, feedback) VALUES (?, ?, ?, ?)`
    );
    for (const [key, val] of Object.entries(scores)) {
      const score =
        typeof val === "object" && val !== null
          ? (val as { score: number }).score
          : (val as number);
      const feedback =
        typeof val === "object" && val !== null
          ? (val as { feedback?: string }).feedback || null
          : null;
      stmt.run(sessionId, key, score, feedback);
      scoreCount++;
    }
  }

  if (args.predictions && typeof args.predictions === "string") {
    const predictions = JSON.parse(args.predictions);
    const stmt = db.prepare(
      `INSERT INTO self_assessments (session_id, dimension_key, predicted_score, actual_score, gap)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const [key, predicted] of Object.entries(predictions)) {
      const predictedScore = predicted as number;
      // Find actual score if it exists
      const actual = db
        .query<{ score: number }, [number, string]>(
          `SELECT score FROM dimension_scores WHERE session_id = ? AND dimension_key = ?`
        )
        .get(sessionId, key);
      const actualScore = actual?.score ?? null;
      const gap = actualScore !== null ? actualScore - predictedScore : null;
      stmt.run(sessionId, key, predictedScore, actualScore, gap);
    }
  }

  console.log(
    `Session saved for "${specName}" (${scoreCount} dimensions scored)`
  );
}

function handleContextBrief(
  args: Record<string, string | boolean | undefined>
) {
  const db = ensureDatabase();
  const email = getGitConfig("user.email");
  if (!email) {
    console.log("No coaching history found.");
    return;
  }

  const author = db
    .query<
      { id: number; display_name: string | null },
      [string]
    >("SELECT id, display_name FROM authors WHERE email = ?")
    .get(email);

  if (!author) {
    console.log("No coaching history found.");
    return;
  }

  const sessionCount = db
    .query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM sessions WHERE author_id = ?"
    )
    .get(author.id);

  if (!sessionCount || sessionCount.count === 0) {
    console.log("No coaching history found.");
    return;
  }

  const name = author.display_name || email;
  const total = sessionCount.count;

  // Average scores per dimension
  const avgScores = db
    .query<
      { dimension_key: string; avg_score: number },
      [number]
    >(
      `SELECT ds.dimension_key, ROUND(AVG(ds.score), 1) as avg_score
       FROM dimension_scores ds
       JOIN sessions s ON s.id = ds.session_id
       WHERE s.author_id = ?
       GROUP BY ds.dimension_key
       ORDER BY avg_score DESC`
    )
    .all(author.id);

  // Trend: compare last N sessions avg vs prior N
  const recentSessions = db
    .query<{ id: number }, [number, number]>(
      `SELECT id FROM sessions WHERE author_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(author.id, TREND_WINDOW_SIZE);

  const strongest = avgScores.filter((d) => d.avg_score >= 7);
  const weakest = avgScores.filter((d) => d.avg_score < 5);

  // Calibration trend
  const calibrationRow = db
    .query<{ avg_gap: number }, [number]>(
      `SELECT ROUND(AVG(ABS(gap)), 1) as avg_gap
       FROM self_assessments sa
       JOIN sessions s ON s.id = sa.session_id
       WHERE s.author_id = ? AND sa.gap IS NOT NULL`
    )
    .get(author.id);

  let brief = `${name} has completed ${total} coaching session${total === 1 ? "" : "s"}.`;

  if (strongest.length > 0) {
    brief += ` Strongest: ${strongest.map((d) => `${d.dimension_key} (avg ${d.avg_score})`).join(", ")}.`;
  }
  if (weakest.length > 0) {
    brief += ` Weakest: ${weakest.map((d) => `${d.dimension_key} (avg ${d.avg_score})`).join(", ")}.`;
  }
  if (calibrationRow && calibrationRow.avg_gap !== null) {
    brief += ` Calibration gap: avg ${calibrationRow.avg_gap} points.`;
  }
  if (weakest.length > 0) {
    brief += ` Priority focus: ${weakest.map((d) => d.dimension_key).join(", ")}.`;
  }

  // Per-spec session notes
  const specName = args["spec-name"] as string | undefined;
  if (specName) {
    const lastNote = db
      .query<
        { session_notes: string; created_at: string },
        [number, string]
      >(
        `SELECT session_notes, created_at FROM sessions
         WHERE author_id = ? AND spec_name = ? AND session_notes IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(author.id, specName);

    if (lastNote) {
      const daysAgo = Math.floor(
        (Date.now() - new Date(lastNote.created_at + "Z").getTime()) /
          (1000 * 60 * 60 * 24)
      );
      const timeLabel =
        daysAgo === 0
          ? "today"
          : daysAgo === 1
            ? "yesterday"
            : `${daysAgo} days ago`;
      brief += `\n\nLast session on "${specName}" (${timeLabel}): ${lastNote.session_notes}`;
    }
  }

  console.log(brief);
}

function handleInspect() {
  const db = ensureDatabase();
  const email = getGitConfig("user.email");
  if (!email) {
    console.log("No data. Git user email not configured.");
    return;
  }

  const author = db
    .query<
      { id: number; display_name: string | null },
      [string]
    >("SELECT id, display_name FROM authors WHERE email = ?")
    .get(email);

  if (!author) {
    console.log("No coaching data found.");
    return;
  }

  const sessions = db
    .query<
      {
        id: number;
        spec_name: string;
        phase: string;
        created_at: string;
        session_notes: string | null;
      },
      [number]
    >(
      `SELECT id, spec_name, phase, created_at, session_notes
       FROM sessions WHERE author_id = ? ORDER BY created_at DESC`
    )
    .all(author.id);

  console.log(
    `Author: ${author.display_name || email} (${sessions.length} sessions)\n`
  );

  for (const session of sessions) {
    console.log(
      `  ${session.created_at} | ${session.phase} | ${session.spec_name}`
    );
    const scores = db
      .query<
        { dimension_key: string; score: number },
        [number]
      >(
        `SELECT dimension_key, score FROM dimension_scores WHERE session_id = ? ORDER BY dimension_key`
      )
      .all(session.id);
    if (scores.length > 0) {
      console.log(
        `    Scores: ${scores.map((s) => `${s.dimension_key}=${s.score}`).join(", ")}`
      );
    }
    if (session.session_notes) {
      console.log(`    Notes: ${session.session_notes}`);
    }
  }
}

function handleResetAll(args: Record<string, string | boolean | undefined>) {
  if (!args.confirm) {
    console.error(
      "Destructive operation. Add --confirm to proceed.\nThis will delete ALL coaching data."
    );
    process.exit(EXIT_USER_ERROR);
  }
  const db = ensureDatabase();
  db.exec("DELETE FROM self_assessments");
  db.exec("DELETE FROM dimension_scores");
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM authors");
  console.log("All coaching data deleted.");
}

function handleResetSpec(args: Record<string, string | boolean | undefined>) {
  if (!args.confirm) {
    console.error("Destructive operation. Add --confirm to proceed.");
    process.exit(EXIT_USER_ERROR);
  }
  const db = ensureDatabase();
  const specName = requireFlag(args, "spec-name");

  const sessions = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM sessions WHERE spec_name = ?"
    )
    .all(specName);

  if (sessions.length === 0) {
    console.log(`No sessions found for spec "${specName}".`);
    return;
  }

  const ids = sessions.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(",");
  db.run(
    `DELETE FROM self_assessments WHERE session_id IN (${placeholders})`,
    ids
  );
  db.run(
    `DELETE FROM dimension_scores WHERE session_id IN (${placeholders})`,
    ids
  );
  db.run(`DELETE FROM sessions WHERE spec_name = ?`, [specName]);

  console.log(
    `Deleted ${sessions.length} session${sessions.length === 1 ? "" : "s"} for spec "${specName}".`
  );
}

function handleResetAuthor(args: Record<string, string | boolean | undefined>) {
  if (!args.confirm) {
    console.error("Destructive operation. Add --confirm to proceed.");
    process.exit(EXIT_USER_ERROR);
  }
  const db = ensureDatabase();
  const email = (args.email as string) || getGitConfig("user.email");
  if (!email) {
    console.error("No email provided and git config user.email not set.");
    process.exit(EXIT_USER_ERROR);
  }

  const author = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM authors WHERE email = ?"
    )
    .get(email);

  if (!author) {
    console.log(`No data found for author "${email}".`);
    return;
  }

  const sessions = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM sessions WHERE author_id = ?"
    )
    .all(author.id);

  const ids = sessions.map((s) => s.id);
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    db.run(
      `DELETE FROM self_assessments WHERE session_id IN (${placeholders})`,
      ids
    );
    db.run(
      `DELETE FROM dimension_scores WHERE session_id IN (${placeholders})`,
      ids
    );
  }
  db.run("DELETE FROM sessions WHERE author_id = ?", [author.id]);
  db.run("DELETE FROM authors WHERE id = ?", [author.id]);

  console.log(
    `Deleted ${sessions.length} session${sessions.length === 1 ? "" : "s"} for "${email}".`
  );
}

function handleExport(args: Record<string, string | boolean | undefined>) {
  const db = ensureDatabase();
  const outputPath = (args.output as string) || join(DATA_DIR, "export.json");

  const data = {
    exportedAt: new Date().toISOString(),
    authors: db.query("SELECT * FROM authors").all(),
    sessions: db.query("SELECT * FROM sessions").all(),
    scores: db.query("SELECT * FROM dimension_scores").all(),
    assessments: db.query("SELECT * FROM self_assessments").all(),
  };

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  const counts = `${(data.authors as unknown[]).length} authors, ${(data.sessions as unknown[]).length} sessions, ${(data.scores as unknown[]).length} scores, ${(data.assessments as unknown[]).length} assessments`;
  console.log(`Exported ${counts} to ${outputPath}`);
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const flags = parseArgs(args.slice(1));

  switch (subcommand) {
    case "init":
      handleInit();
      break;
    case "save-session":
      handleSaveSession(flags);
      break;
    case "context-brief":
      handleContextBrief(flags);
      break;
    case "inspect":
      handleInspect();
      break;
    case "reset-all":
      handleResetAll(flags);
      break;
    case "reset-spec":
      handleResetSpec(flags);
      break;
    case "reset-author":
      handleResetAuthor(flags);
      break;
    case "export":
      handleExport(flags);
      break;
    default:
      console.error(
        `Usage: bun run store.ts <command>

Commands:
  init                          Create database
  save-session --spec-name S    Save a coaching session
  context-brief [--spec-name S] Get author history summary
  inspect                       View all stored data
  reset-all --confirm           Delete all data
  reset-spec --spec-name S --confirm  Delete one spec's data
  reset-author [--email E] --confirm  Delete one author's data
  export [--output PATH]        Export data to JSON`
      );
      process.exit(EXIT_USER_ERROR);
  }
}

main();
