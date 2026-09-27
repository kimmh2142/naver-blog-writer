import { spawn } from "node:child_process";
import readline from "node:readline";
import { codexLauncher } from "./binaries.js";

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/**
 * `codex app-server`(stdio JSON-RPC)를 잠깐 띄워 계정 유형과 구독 사용량을 읽는다.
 * 모델 요청은 하지 않는다.
 */
export async function withCodexAppServer<T>(
  env: Record<string, string>,
  fn: (call: (method: string, params?: unknown) => Promise<any>) => Promise<T>,
): Promise<T> {
  const { command, args } = codexLauncher();
  const proc = spawn(command, [...args, "app-server"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let stderr = "";
  proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id !== "number" || !pending.has(msg.id)) return; // 알림은 무시
    const entry = pending.get(msg.id)!;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(`${msg.error.message ?? "app-server error"} (${msg.error.code ?? "?"})`));
    else entry.resolve(msg.result);
  });

  const send = (message: unknown) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  const call = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`app-server ${method} 응답 없음. stderr: ${stderr.slice(-500)}`));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      send(params === undefined ? { method, id } : { method, id, params });
    });

  try {
    await call("initialize", { clientInfo: { name: "nbw_poc", title: "naver-blog-writer PoC", version: "0.0.0" } });
    send({ method: "initialized", params: {} });
    return await fn(call);
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    rl.close();
    proc.kill();
  }
}

export type CodexAccountSnapshot = {
  account: { type?: string; planType?: string | null } | null;
  rateLimits: unknown;
};

/** 계정 유형과 사용량 한도를 함께 읽는다. 이메일은 기록하지 않는다. */
export async function readCodexAccount(env: Record<string, string>): Promise<CodexAccountSnapshot> {
  return withCodexAppServer(env, async (call) => {
    const account = await call("account/read", { refreshToken: false });
    let rateLimits: unknown = null;
    try {
      rateLimits = await call("account/rateLimits/read");
    } catch (e) {
      rateLimits = { error: (e as Error).message };
    }
    const acc = account?.account ?? null;
    return {
      account: acc ? { type: acc.type, planType: acc.planType ?? null } : null,
      rateLimits,
    };
  });
}
