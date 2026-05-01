import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Config } from "./config";
import { insertSendLog, type SendLogRow } from "./db";
import { postDiscordNotification } from "./notifier";

// D-02: Questions ported verbatim from git history (claude_message_send_with_CC_CLI.py)
const QUESTIONS = [
  "What is the best method to incorporate with a database in Python? (Answer in 1 sentence.)",
  "What are 3 key principles for writing clean code? (Answer in 1 sentence.)",
  "How should I structure error handling in Python? (Answer in 1 sentence.)",
  "What are best practices for API design? (Answer in 1 sentence.)",
  "How do you implement proper logging? (Answer in 1 sentence.)",
  "What are secure coding practices? (Answer in 1 sentence.)",
  "How should I organize a Python project? (Answer in 1 sentence.)",
  "What are testing best practices? (Answer in 1 sentence.)",
  "How do you optimize database queries? (Answer in 1 sentence.)",
  "What design patterns should I know? (Answer in 1 sentence.)",
];

function pickQuestion(): string {
  const index = Math.floor(Math.random() * QUESTIONS.length);
  return QUESTIONS[index];
}

export async function send(
  config: Config,
  opts?: {
    timeoutMs?: number;
    scheduledFor?: string | null;
    isAnchor?: number;
  }
): Promise<SendLogRow> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const scheduledFor = opts?.scheduledFor ?? null;
  const isAnchor = opts?.isAnchor ?? 0;
  const startTime = Date.now();
  const question = pickQuestion();

  return new Promise((resolve) => {
    // D-06: spawn from os.tmpdir() to prevent loading project CLAUDE.md (Pitfall 1)
    const cwd = os.tmpdir();

    // T-03-04: Always use array form — never shell: true (prevents injection)
    // claude CLI requires a writable HOME to store its config; service user has HOME=/nonexistent
    const claudeHome = path.join(os.tmpdir(), "claude-home");
    const child = spawn("claude", ["-p", question, "--model", "haiku"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: claudeHome },
    });

    let stdout = "";
    let stderr = "";
    // Pitfall 2: finished flag guards against timeout race condition
    let finished = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Enforce configurable timeout (D-04)
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;

      const duration = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[sender]", msg);

      const row = insertSendLog(config, {
        fired_at: new Date().toISOString(),
        scheduled_for: scheduledFor,
        is_anchor: isAnchor,
        status: "error",
        duration_ms: duration,
        question,
        response_excerpt: null,
        error_message: msg,
      });

      // Fire webhook notification on send failure (NOTIFY-01, D-05)
      void postDiscordNotification(
        "Send Failure",
        `Send scheduled for ${scheduledFor || "manual trigger"} failed with status 'error': ${msg}`,
        new Date()
      );

      resolve(row);
    });

    child.on(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer);
        if (finished) return;
        finished = true;

        const duration = Date.now() - startTime;
        let status: string;
        let responseExcerpt: string | null = null;
        let errorMessage: string | null = null;

        if (signal === "SIGTERM" || duration >= timeoutMs) {
          status = "timeout";
          errorMessage = `Timeout after ${timeoutMs}ms`;
        } else if (code === 0) {
          status = "ok";
          // T-03-06: cap response excerpt at 500 chars to avoid memory exhaustion
          responseExcerpt = stdout.slice(0, 500) || null;
        } else {
          status = "error";
          errorMessage = stderr || `Exit code ${code}`;
        }

        const row = insertSendLog(config, {
          fired_at: new Date().toISOString(),
          scheduled_for: scheduledFor,
          is_anchor: isAnchor,
          status,
          duration_ms: duration,
          question,
          response_excerpt: responseExcerpt,
          error_message: errorMessage,
        });

        // Fire webhook notification on send failure (NOTIFY-01, D-05)
        if (status !== "ok") {
          void postDiscordNotification(
            "Send Failure",
            `Send scheduled for ${scheduledFor || "manual trigger"} failed with status '${status}': ${errorMessage || "unknown error"}`,
            new Date()
          );
        }

        resolve(row);
      }
    );
  });
}

export { QUESTIONS };
