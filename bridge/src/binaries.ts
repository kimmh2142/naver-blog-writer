import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** SDK에 포함된 Claude Code 실행 파일 (로그인에 사용). 평소 설치된 claude와 별개로 SDK와 같은 버전을 쓴다. */
export function bundledClaudeBinary(): string {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  const binary = path.join(dir, process.platform === "win32" ? "claude.exe" : "claude");
  if (!existsSync(binary)) throw new Error(`Claude 실행 파일을 찾지 못했습니다: ${binary}`);
  return binary;
}

/** @openai/codex 의 실행 스크립트. node로 실행하면 플랫폼별 codex 바이너리를 찾아 실행한다. */
export function codexLauncher(): { command: string; args: string[] } {
  const script = path.join(path.dirname(require.resolve("@openai/codex/package.json")), "bin", "codex.js");
  if (!existsSync(script)) throw new Error(`Codex 실행 스크립트를 찾지 못했습니다: ${script}`);
  return { command: process.execPath, args: [script] };
}
