import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  assertCodexAuthFile,
  checkCodexAuthFile,
  claudeEnv,
  codexEnv,
  describeClaudeLogin,
  readCodexAuthFile,
  writeCodexConfig,
} from "./auth-guard.js";
import { bundledClaudeBinary, codexLauncher } from "./binaries.js";
import { paths } from "./paths.js";

/**
 * PoC 전용 폴더에 구독 계정으로 로그인한다. 평소 쓰는 ~/.claude, ~/.codex 로그인은 건드리지 않는다.
 * API 키는 절대 입력하지 않는다.
 */
const provider = process.argv[2];

if (provider === "claude") {
  mkdirSync(paths.claudeConfigDir, { recursive: true });
  mkdirSync(paths.claudeWorkDir, { recursive: true });
  console.log(
    [
      "Claude Code가 PoC 전용 설정 폴더로 열립니다.",
      "1) 로그인 방식에서 'Claude account with subscription'(Pro/Max 구독)을 고르세요. Console(API) 계정은 고르지 마세요.",
      "2) 브라우저에서 로그인을 마치고 터미널로 돌아오세요.",
      "3) 프롬프트가 보이면 /exit 를 입력해 종료하세요.",
      "",
    ].join("\n"),
  );
  const { env } = claudeEnv();
  spawnSync(bundledClaudeBinary(), [], { env, cwd: paths.claudeWorkDir, stdio: "inherit" });
  const login = describeClaudeLogin();
  console.log(login.loggedIn ? `\n로그인 확인됨 (구독: ${login.subscriptionType ?? "표시 안 됨"}).` : "\n로그인 정보를 찾지 못했습니다. 다시 시도하세요.");
} else if (provider === "codex") {
  writeCodexConfig();
  const device = process.argv.includes("--device-auth");
  console.log("ChatGPT 계정으로 로그인합니다 (PoC 전용 CODEX_HOME). API 키 로그인은 설정으로 막혀 있습니다.\n");
  const { command, args } = codexLauncher();
  const { env } = codexEnv();
  spawnSync(command, [...args, "login", ...(device ? ["--device-auth"] : [])], { env, stdio: "inherit" });
  const status = checkCodexAuthFile(readCodexAuthFile());
  if (status.ok) {
    assertCodexAuthFile();
    console.log("\nChatGPT 로그인 확인됨.");
  } else {
    console.log(`\n${status.reason}\n브라우저가 안 열리면: npm run login:codex -- --device-auth`);
  }
} else {
  console.error("사용법: npm run login:claude  또는  npm run login:codex");
  process.exit(1);
}
