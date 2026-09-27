import { spawn } from "node:child_process";
import readline from "node:readline";
import { codexLauncher } from "../binaries.js";

/**
 * `codex exec`를 직접 실행한다.
 * Codex SDK와 같은 인자를 쓰되 `--ephemeral`을 더한다. SDK에는 이 옵션이 없어서,
 * SDK로 부르면 세션 기록(CODEX_HOME/sessions)에 첨부 사진이 base64로 남는다(PoC에서 확인).
 */
export type CodexExecArgs = {
  env: Record<string, string>;
  prompt: string;
  imagePaths: string[];
  outputSchemaPath: string;
  workingDirectory: string;
  model: string | null;
  signal: AbortSignal;
};

export function buildCodexExecArgs(args: Omit<CodexExecArgs, "env" | "prompt" | "signal">): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    args.workingDirectory,
    "--output-schema",
    args.outputSchemaPath,
    "--config",
    'forced_login_method="chatgpt"',
    "--config",
    'approval_policy="never"',
    "--config",
    'web_search="disabled"',
    ...(args.model ? ["--model", args.model] : []),
    ...args.imagePaths.flatMap((p) => ["--image", p]),
  ];
}

export type CodexExecOutcome = {
  finalText: string | null;
  usage: unknown;
  error: string | null;
};

/** `codex exec --json` 의 JSONL 이벤트에서 최종 응답, 사용량, 오류를 뽑는다. */
export function parseCodexEvents(lines: string[]): CodexExecOutcome {
  const outcome: CodexExecOutcome = { finalText: null, usage: null, error: null };
  for (const line of lines) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") outcome.finalText = event.item.text;
    else if (event.type === "item.completed" && event.item?.type === "error") outcome.error = event.item.message ?? "오류";
    else if (event.type === "turn.completed") outcome.usage = event.usage ?? null;
    else if (event.type === "turn.failed") outcome.error = event.error?.message ?? "turn.failed";
    else if (event.type === "error") outcome.error = event.message ?? "error";
  }
  return outcome;
}

export async function runCodexExec(args: CodexExecArgs): Promise<CodexExecOutcome & { exitCode: number | null; stderr: string }> {
  const { command, args: launcherArgs } = codexLauncher();
  const child = spawn(command, [...launcherArgs, ...buildCodexExecArgs(args)], { env: args.env, signal: args.signal });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4000) stderr += chunk.toString();
  });
  const exit = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  child.stdin.write(args.prompt);
  child.stdin.end();

  const lines: string[] = [];
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) lines.push(line);
  } catch {
    /* 중단 시 스트림 오류는 무시하고 아래에서 판단 */
  }
  const exitCode = await exit;
  return { ...parseCodexEvents(lines), exitCode, stderr };
}
