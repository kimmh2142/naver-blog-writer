import { loadEnvFile, readConfig } from "../config.js";
import { dirs } from "../paths.js";
import { ClaudeProvider } from "../providers/claude.js";
import { CodexProvider } from "../providers/codex.js";
import type { ProviderStatus } from "../providers/types.js";

/** 서버를 띄우지 않고 PC에서 바로 두 Provider 상태를 본다. 모델 호출은 없다. */
loadEnvFile();
const models = (() => {
  try {
    return readConfig(process.env).models;
  } catch {
    // 토큰을 아직 만들지 않았어도 상태 확인은 할 수 있게 기본 모델로 본다.
    return { claude: { analysis: "sonnet", writing: "opus" }, codex: { analysis: null, writing: null } };
  }
})();

const print = (label: string, s: ProviderStatus) => {
  console.log(`── ${label} ──`);
  console.log(`상태: ${s.code}${s.ready ? " (사용 가능)" : ""}`);
  console.log(`설명: ${s.message}`);
  console.log(`요금제: ${s.plan ?? "-"} · 구독 외 과금 확인: ${s.billingCheck}`);
  for (const w of s.usage) console.log(`사용량 ${w.name}: ${w.usedPercent ?? "?"}% (초기화 ${w.resetsAt ?? "?"})`);
  console.log(`모델: 분석 ${s.models.analysis ?? "구독 기본"} / 작성 ${s.models.writing ?? "구독 기본"}\n`);
};

const [claude, codex] = await Promise.all([
  new ClaudeProvider(models.claude, dirs).status(),
  new CodexProvider(models.codex, dirs).status(),
]);
print("Claude", claude);
print("GPT (Codex)", codex);
process.exit(claude.ready && codex.ready ? 0 : 1);
