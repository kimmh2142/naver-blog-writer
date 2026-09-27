import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { bundledClaudeBinary, codexLauncher } from "../binaries.js";
import { checkCodexAuthFile, claudeEnv, codexEnv, readCodexAuthFile, writeCodexConfig } from "../guard.js";
import { dirs } from "../paths.js";

/**
 * 브리지 전용 폴더에 구독 계정으로 로그인한다(PoC의 login.ts와 같은 방식).
 * 평소 쓰는 ~/.claude, ~/.codex 와 PoC 로그인은 건드리지 않는다. API 키는 입력하지 않는다.
 */
const provider = process.argv[2];

if (provider === "claude") {
  mkdirSync(dirs.claudeConfigDir, { recursive: true });
  mkdirSync(dirs.workDir, { recursive: true });
  console.log(
    [
      "Claude Code가 브리지 전용 설정 폴더로 열립니다.",
      "1) 로그인 방식에서 'Claude account with subscription'(Pro/Max 구독)을 고르세요. Console(API) 계정은 고르지 마세요.",
      "2) 브라우저에서 로그인을 마치고 터미널로 돌아오세요.",
      "3) 입력창이 보이면 /exit 로 종료하세요. 그다음 `npm run status`로 확인합니다.",
      "",
    ].join("\n"),
  );
  spawnSync(bundledClaudeBinary(), [], { env: claudeEnv(dirs.claudeConfigDir).env, cwd: dirs.workDir, stdio: "inherit" });
} else if (provider === "codex") {
  writeCodexConfig(dirs.codexHome);
  const device = process.argv.includes("--device-auth");
  console.log("ChatGPT 계정으로 로그인합니다 (브리지 전용 CODEX_HOME). API 키 로그인은 설정으로 막혀 있습니다.\n");
  const { command, args } = codexLauncher();
  spawnSync(command, [...args, "login", ...(device ? ["--device-auth"] : [])], { env: codexEnv(dirs.codexHome).env, stdio: "inherit" });
  const verdict = checkCodexAuthFile(readCodexAuthFile(dirs.codexHome));
  console.log(verdict.code === "READY" ? "\nChatGPT 로그인 확인됨. `npm run status`로 상태를 확인하세요." : `\n${verdict.message}\n브라우저가 안 열리면: npm run login:codex -- --device-auth`);
} else {
  console.error("사용법: npm run login:claude  또는  npm run login:codex");
  process.exit(1);
}
