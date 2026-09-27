import { mkdirSync, rmSync } from "node:fs";
import { serve } from "@hono/node-server";
import { ConfigError, HOST, loadEnvFile, readConfig } from "./config.js";
import { isBlockedEnvKey } from "./guard.js";
import { dirs } from "./paths.js";
import { ClaudeProvider } from "./providers/claude.js";
import { CodexProvider } from "./providers/codex.js";
import { createApp } from "./server.js";

loadEnvFile();
let config;
try {
  config = readConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

// API 키 관련 환경변수는 AI 프로세스에 전달되지 않지만, 있다는 사실은 알려 준다(값은 출력하지 않음).
const risky = Object.keys(process.env).filter(
  (k) => isBlockedEnvKey(k) && /API_KEY|AUTH_TOKEN|ACCESS_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY/i.test(k),
);
if (risky.length) console.warn(`참고: 다음 환경변수는 AI 호출에 전달되지 않습니다: ${risky.join(", ")}`);

// 이전 실행에서 남은 임시 파일 정리
rmSync(dirs.workDir, { recursive: true, force: true });
mkdirSync(dirs.workDir, { recursive: true });

const app = createApp({
  appToken: config.appToken,
  providers: {
    claude: new ClaudeProvider(config.models.claude, dirs),
    codex: new CodexProvider(config.models.codex, dirs),
  },
});

const server = serve({ fetch: app.fetch, hostname: HOST, port: config.port }, (info) => {
  console.log(`브리지 실행 중: http://${HOST}:${info.port} (이 PC 안에서만 열림)`);
  console.log(`휴대폰에서 쓰려면 다른 PowerShell 창에서 한 번: tailscale serve --bg ${info.port}`);
  console.log("종료: Ctrl+C");
});
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `포트 ${config.port}가 이미 사용 중입니다. 브리지가 이미 실행 중인지 확인하세요.` : e.message);
  process.exit(1);
});
