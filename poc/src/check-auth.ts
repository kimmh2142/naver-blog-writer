import {
  assertClaudeConfigClean,
  assertCodexAccount,
  assertCodexAuthFile,
  claudeEnv,
  codexEnv,
  describeClaudeLogin,
  writeCodexConfig,
} from "./auth-guard.js";
import { readCodexAccount } from "./codex-app-server.js";
import { claudePreflight } from "./providers/claude.js";

/**
 * 모델 요청 없이 두 Provider의 인증 상태만 확인한다.
 * - Claude: /usage(로컬 명령)를 실행해 apiKeySource가 "none"(구독 로그인)인지 확인
 * - Codex: auth.json과 app-server account/read로 ChatGPT 계정인지 확인
 */
const only = process.argv[2];
let failed = false;

if (!only || only === "claude") {
  console.log("── Claude ──");
  try {
    assertClaudeConfigClean();
    // 로그인 파일 형식은 공식 문서에 없어서 참고용으로만 본다. 실제 판정은 아래 apiKeySource로 한다.
    const login = describeClaudeLogin();
    if (!login.loggedIn) console.log("참고: PoC 전용 폴더에서 로그인 파일을 확인하지 못했습니다. 안 했다면 `npm run login:claude`를 먼저 실행하세요.");
    const { env, removed } = claudeEnv();
    console.log(`제거한 환경변수: ${removed.length ? removed.join(", ") : "(없음)"}`);
    const preflight = await claudePreflight(env);
    console.log(`apiKeySource: ${preflight.apiKeySource} → API 키를 쓰지 않음 (종량제 과금 경로 아님)`);
    console.log(`점검 명령 모델 호출: ${preflight.localCommand ? "없음" : "확인 불가"}`);
    console.log(
      login.loggedIn
        ? `PoC 전용 폴더 로그인: 있음 (구독: ${login.subscriptionType ?? "표시 안 됨"})`
        : "PoC 전용 폴더 로그인: 없음 → 이 상태로 실행하면 '로그인 필요' 오류로 끝납니다.",
    );
    if (!login.loggedIn) failed = true;
  } catch (e) {
    failed = true;
    console.error(`실패: ${(e as Error).message}`);
  }
}

if (!only || only === "codex") {
  console.log("\n── Codex ──");
  try {
    writeCodexConfig();
    assertCodexAuthFile();
    const { env, removed } = codexEnv();
    console.log(`제거한 환경변수: ${removed.length ? removed.join(", ") : "(없음)"}`);
    const snapshot = await readCodexAccount(env);
    assertCodexAccount(snapshot.account);
    console.log(`계정 유형: ${snapshot.account?.type}, 요금제: ${snapshot.account?.planType ?? "-"} → ChatGPT 인증 확인`);
    console.log(`사용량: ${JSON.stringify(snapshot.rateLimits)}`);
  } catch (e) {
    failed = true;
    console.error(`실패: ${(e as Error).message}`);
  }
}

process.exit(failed ? 1 : 0);
