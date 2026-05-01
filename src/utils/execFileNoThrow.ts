import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export async function execFileNoThrow(
  file: string,
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: options?.timeout ?? 30000,
      cwd: options?.cwd,
    });
    return { status: 0, stdout, stderr };
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null) {
      const e = err as Record<string, unknown>;
      return {
        status: typeof e["code"] === "number" ? e["code"] : 1,
        stdout: typeof e["stdout"] === "string" ? e["stdout"] : "",
        stderr: typeof e["stderr"] === "string" ? e["stderr"] : String(err),
      };
    }
    return { status: 1, stdout: "", stderr: String(err) };
  }
}
