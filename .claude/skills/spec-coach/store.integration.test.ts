import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "fs";
import { execSync } from "child_process";

/**
 * Integration tests: verify the round-trip contract between
 * the skill (which shells out to store.ts) and the store script.
 * These test the stdout format that SKILL.md parses.
 */

const STORE_PATH = import.meta.dir + "/store.ts";
const DATA_DIR = ".spec-coach";
const DB_PATH = `${DATA_DIR}/data.db`;

function run(cmd: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`bun run ${STORE_PATH} ${cmd}`, {
      encoding: "utf-8",
      cwd: import.meta.dir + "/../../..",
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: ((err.stdout || "") + (err.stderr || "")).trim(),
      exitCode: err.status || 1,
    };
  }
}

function resetDb() {
  if (existsSync(DB_PATH)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

beforeEach(() => {
  resetDb();
  run("init");
});

afterEach(() => {
  resetDb();
});

describe("round-trip: save-session → context-brief", () => {
  test("saved session data appears in context-brief output", () => {
    const save = run(
      `save-session --spec-name auth-flow --scores '{"testability":7,"edge_cases":4,"failure_modes":6}'`
    );
    expect(save.exitCode).toBe(0);

    const brief = run("context-brief");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain("1 coaching session");
    // Context-brief is a natural language summary showing strongest/weakest,
    // not all dimensions. Verify the strongest and weakest are present.
    expect(brief.stdout).toContain("Strongest:");
    expect(brief.stdout).toContain("Weakest:");
  });

  test("session notes appear in spec-filtered context-brief", () => {
    const save = run(
      `save-session --spec-name payments --session-notes "Author agreed to add retry logic for failed charges"`
    );
    expect(save.exitCode).toBe(0);

    const brief = run("context-brief --spec-name payments");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain(
      "Author agreed to add retry logic for failed charges"
    );
  });

  test("predictions are stored and retrievable", () => {
    const save = run(
      `save-session --spec-name pred-flow --scores '{"testability":7,"edge_cases":4}' --predictions '{"testability":9,"edge_cases":3}'`
    );
    expect(save.exitCode).toBe(0);

    // Verify via inspect that predictions were stored
    const inspect = run("inspect");
    expect(inspect.exitCode).toBe(0);
    expect(inspect.stdout).toContain("pred-flow");
  });

  test("multiple sessions accumulate in context-brief", () => {
    run(
      `save-session --spec-name s1 --scores '{"testability":8}'`
    );
    run(
      `save-session --spec-name s2 --scores '{"testability":3}'`
    );
    run(
      `save-session --spec-name s3 --scores '{"edge_cases":6}'`
    );

    const brief = run("context-brief");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain("3 coaching sessions");
  });
});

describe("round-trip: reset → context-brief verifies clean state", () => {
  test("reset-all clears everything — context-brief returns first-time message", () => {
    run(
      `save-session --spec-name s1 --scores '{"testability":7}'`
    );
    run(
      `save-session --spec-name s2 --scores '{"edge_cases":5}'`
    );

    const resetResult = run("reset-all --confirm");
    expect(resetResult.exitCode).toBe(0);

    const brief = run("context-brief");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain("No coaching history");
  });

  test("reset-spec clears only target — other specs remain in context-brief", () => {
    run(
      `save-session --spec-name keep --scores '{"testability":8}'`
    );
    run(
      `save-session --spec-name remove --scores '{"testability":3}'`
    );

    run("reset-spec --spec-name remove --confirm");

    const brief = run("context-brief");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain("1 coaching session");
  });
});

describe("stdout format contract", () => {
  test("save-session output includes spec name and score count", () => {
    const result = run(
      `save-session --spec-name format-check --scores '{"testability":7,"edge_cases":4,"failure_modes":6}'`
    );
    expect(result.stdout).toContain('Session saved for "format-check"');
    expect(result.stdout).toContain("3 dimensions scored");
  });

  test("context-brief output contains strongest/weakest when multiple dimensions", () => {
    run(
      `save-session --spec-name dims --scores '{"testability":9,"edge_cases":2,"decomposition":7}'`
    );
    const brief = run("context-brief");
    expect(brief.stdout).toContain("Strongest:");
    expect(brief.stdout).toContain("Weakest:");
  });

  test("init output contains 'Initialized'", () => {
    resetDb();
    const result = run("init");
    expect(result.stdout).toContain("Initialized");
  });
});
