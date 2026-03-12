import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, readFileSync } from "fs";
import { execSync } from "child_process";

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

describe("init", () => {
  test("creates database directory and file", () => {
    resetDb();
    const result = run("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initialized");
    expect(existsSync(DB_PATH)).toBe(true);
  });

  test("idempotent - running twice is fine", () => {
    const result = run("init");
    expect(result.exitCode).toBe(0);
  });
});

describe("save-session", () => {
  test("saves session with all fields", () => {
    const result = run(
      `save-session --spec-name auth-flow --phase evaluation --tool-context ceetrix --trigger-layer 2 --session-notes "Discussed failure modes" --scores '{"testability":7,"edge_cases":4}'`
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Session saved for "auth-flow"');
    expect(result.stdout).toContain("2 dimensions scored");
  });

  test("saves session with minimal fields", () => {
    const result = run("save-session --spec-name minimal-spec");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("0 dimensions scored");
  });

  test("saves predictions with gap computation", () => {
    const result = run(
      `save-session --spec-name pred-test --scores '{"testability":7,"edge_cases":4}' --predictions '{"testability":9,"edge_cases":3}'`
    );
    expect(result.exitCode).toBe(0);
  });

  test("fails without spec-name", () => {
    const result = run("save-session --phase coaching");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Missing required argument: --spec-name");
  });
});

describe("context-brief", () => {
  test("returns empty message when no data", () => {
    const result = run("context-brief");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No coaching history");
  });

  test("returns summary after saving a session", () => {
    run(
      `save-session --spec-name test-spec --scores '{"testability":7,"edge_cases":4,"failure_modes":6}'`
    );
    const result = run("context-brief");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 coaching session");
    expect(result.stdout).toContain("testability");
  });

  test("includes spec notes when --spec-name provided", () => {
    run(
      `save-session --spec-name my-spec --session-notes "Author committed to adding failure modes"`
    );
    const result = run("context-brief --spec-name my-spec");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Author committed to adding failure modes");
  });

  test("no spec notes for unmatched spec name", () => {
    run(
      `save-session --spec-name my-spec --session-notes "Some notes"`
    );
    const result = run("context-brief --spec-name other-spec");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("Some notes");
  });

  test("identifies strongest and weakest dimensions", () => {
    run(
      `save-session --spec-name s1 --scores '{"testability":9,"edge_cases":2,"decomposition":8}'`
    );
    const result = run("context-brief");
    expect(result.stdout).toContain("Strongest:");
    expect(result.stdout).toContain("Weakest:");
    expect(result.stdout).toContain("edge_cases");
  });
});

describe("inspect", () => {
  test("shows no data message when empty", () => {
    const result = run("inspect");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No coaching data");
  });

  test("shows sessions after saving", () => {
    run(
      `save-session --spec-name inspect-test --scores '{"testability":5}' --session-notes "Test notes"`
    );
    const result = run("inspect");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("inspect-test");
    expect(result.stdout).toContain("testability=5");
    expect(result.stdout).toContain("Test notes");
  });
});

describe("reset-all", () => {
  test("fails without --confirm", () => {
    const result = run("reset-all");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("--confirm");
  });

  test("deletes all data with --confirm", () => {
    run(`save-session --spec-name s1 --scores '{"testability":7}'`);
    run(`save-session --spec-name s2 --scores '{"edge_cases":5}'`);
    const result = run("reset-all --confirm");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("All coaching data deleted");

    const brief = run("context-brief");
    expect(brief.stdout).toContain("No coaching history");
  });
});

describe("reset-spec", () => {
  test("fails without --confirm", () => {
    const result = run("reset-spec --spec-name foo");
    expect(result.exitCode).toBe(1);
  });

  test("deletes only target spec", () => {
    run(`save-session --spec-name keep-me --scores '{"testability":7}'`);
    run(`save-session --spec-name delete-me --scores '{"testability":5}'`);

    const result = run("reset-spec --spec-name delete-me --confirm");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 session");
    expect(result.stdout).toContain("delete-me");

    const inspect = run("inspect");
    expect(inspect.stdout).toContain("keep-me");
    expect(inspect.stdout).not.toContain("delete-me");
  });

  test("handles non-existent spec gracefully", () => {
    const result = run("reset-spec --spec-name nonexistent --confirm");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No sessions found");
  });
});

describe("reset-author", () => {
  test("fails without --confirm", () => {
    const result = run("reset-author");
    expect(result.exitCode).toBe(1);
  });

  test("deletes current author data with --confirm", () => {
    run(`save-session --spec-name author-test --scores '{"testability":7}'`);
    const result = run("reset-author --confirm");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 session");

    const brief = run("context-brief");
    expect(brief.stdout).toContain("No coaching history");
  });
});

describe("export", () => {
  test("exports data to default path", () => {
    run(`save-session --spec-name export-test --scores '{"testability":8}'`);
    const result = run("export");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("export.json");

    const exported = JSON.parse(
      readFileSync(".spec-coach/export.json", "utf-8")
    );
    expect(exported.authors.length).toBe(1);
    expect(exported.sessions.length).toBe(1);
    expect(exported.scores.length).toBe(1);
  });

  test("exports empty database as valid JSON", () => {
    const result = run("export");
    expect(result.exitCode).toBe(0);

    const exported = JSON.parse(
      readFileSync(".spec-coach/export.json", "utf-8")
    );
    expect(exported.authors.length).toBe(0);
    expect(exported.sessions.length).toBe(0);
  });

  test("exports to custom path", () => {
    run(`save-session --spec-name custom-export --scores '{"testability":6}'`);
    const result = run("export --output .spec-coach/custom.json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("custom.json");
    expect(existsSync(".spec-coach/custom.json")).toBe(true);
  });
});

describe("unknown command", () => {
  test("shows usage on invalid command", () => {
    const result = run("foobar");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Usage:");
  });
});
