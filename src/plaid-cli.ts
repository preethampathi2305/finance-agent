import { spawn } from "node:child_process";

export type PlaidCliResult = {
  ok: boolean;
  data: unknown;
  stderr: string;
  exitCode: number | null;
};

/**
 * Run the Plaid CLI and parse JSON lines from stdout.
 * The CLI often emits diagnostic JSON objects before the payload.
 */
export async function runPlaid(
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<PlaidCliResult> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  return new Promise((resolve) => {
    const child = spawn("plaid", [...args, "-j"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        data: null,
        stderr: stderr || `plaid timed out after ${timeoutMs}ms`,
        exitCode: null,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        data: null,
        stderr:
          error.message.includes("ENOENT")
            ? "Plaid CLI not found. Install with: brew install plaid/plaid-cli/plaid"
            : error.message,
        exitCode: null,
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const parsed = parseJsonLines(stdout);
      if (exitCode !== 0) {
        resolve({
          ok: false,
          data: parsed.payload ?? parsed.diagnostics,
          stderr: stderr || stdout || `plaid exited with code ${exitCode}`,
          exitCode,
        });
        return;
      }
      resolve({
        ok: true,
        data: parsed.payload ?? parsed.all,
        stderr,
        exitCode,
      });
    });
  });
}

function parseJsonLines(text: string): {
  all: unknown[];
  diagnostics: unknown[];
  payload: unknown;
} {
  const all: unknown[] = [];
  const diagnostics: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      all.push(value);
      if (
        value &&
        typeof value === "object" &&
        "diagnostic" in value
      ) {
        diagnostics.push(value);
      }
    } catch {
      // ignore non-JSON noise
    }
  }

  const nonDiagnostic = all.filter(
    (value) => !(value && typeof value === "object" && "diagnostic" in value),
  );
  const payload =
    nonDiagnostic.length === 0
      ? null
      : nonDiagnostic.length === 1
        ? nonDiagnostic[0]
        : nonDiagnostic;

  return { all, diagnostics, payload };
}

/** Well-known institution ids → display names (CLI often returns id only). */
export const INSTITUTION_NAMES: Record<string, string> = {
  ins_10: "American Express",
  ins_33: "Discover",
  ins_54: "Robinhood",
  ins_56: "Chase",
  ins_5: "Citibank",
};
