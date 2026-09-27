import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { checkDraft } from "./checks.js";
import { loadConfig } from "./config.js";
import { loadInputs, MissingInputError } from "./inputs.js";
import { paths } from "./paths.js";
import { runClaude } from "./providers/claude.js";
import { runCodex } from "./providers/codex.js";
import type { ProviderName, RunRecord } from "./providers/types.js";
import { renderEvaluationSheet, renderPreview, renderSummary } from "./report.js";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "both" },
    // 첫 비교는 Provider마다 1회. 둘 다 유효한 후보일 때만 --runs로 추가 실행한다.
    runs: { type: "string", default: "1" },
  },
});

const providers: ProviderName[] =
  values.provider === "both" ? ["claude", "codex"] : values.provider === "claude" || values.provider === "codex" ? [values.provider] : [];
const runs = Number(values.runs);
if (providers.length === 0 || !Number.isInteger(runs) || runs < 1 || runs > 5) {
  console.error("사용법: npm run run -- --provider claude|codex|both --runs 1~5");
  process.exit(1);
}

let inputs;
try {
  inputs = loadInputs();
} catch (e) {
  if (e instanceof MissingInputError) {
    console.error(`입력이 준비되지 않았습니다.\n${e.message}\n자세한 순서는 poc/README.md를 보세요.`);
    process.exit(2);
  }
  throw e;
}

const config = loadConfig();
const startedAt = new Date();
const outDir = path.join(paths.out, startedAt.toISOString().replace(/[:.]/g, "-"));
mkdirSync(outDir, { recursive: true });
// 재현용: 두 Provider에 똑같이 보낸 지시문과 사진 목록
writeFileSync(path.join(outDir, "prompt.txt"), inputs.prompt);
writeFileSync(path.join(outDir, "photos.json"), JSON.stringify(inputs.photos, null, 2));

const expectedIds = inputs.photos.map((p) => p.photoId);
const records: RunRecord[] = [];

console.log(`사진 ${inputs.photos.length}장, Provider ${providers.join(", ")}, 각 ${runs}회. 결과: ${outDir}`);

// 시간대 차이가 한쪽에만 몰리지 않게 회차마다 번갈아 실행한다.
outer: for (let i = 1; i <= runs; i++) {
  for (const provider of providers) {
    console.log(`\n▶ ${provider} ${i}/${runs} 실행 중…`);
    const record = provider === "claude" ? await runClaude(inputs, config, i) : await runCodex(inputs, config, i);
    record.checks = record.rawOutput !== null ? checkDraft(record.rawOutput, expectedIds, inputs.schema) : null;
    if (record.success && !record.checks?.parsed) {
      record.success = false;
      record.error = record.error ?? "응답을 JSON으로 해석하지 못함";
    }
    records.push(record);

    writeFileSync(path.join(outDir, `${provider}-run${i}.json`), JSON.stringify(record, null, 2));
    writeFileSync(path.join(outDir, `${provider}-run${i}.md`), renderPreview(record, inputs.photos));
    const c = record.checks;
    console.log(
      `  성공 ${record.success ? "O" : "X"} · 스키마 ${c?.schemaValid ? "O" : "X"} · 사진 인식 ${c?.allPhotosRecognized ? "O" : "X"} · ` +
        `순서 ${c?.orderPreserved ? "O" : "X"} · ${(record.durationMs / 1000).toFixed(1)}초${record.error ? ` · 오류: ${record.error}` : ""}`,
    );

    if (record.authAborted) {
      console.error(`\n⛔ ${provider}: 인증 안전장치가 작동해 전체 실행을 중단합니다.\n${record.error}`);
      break outer;
    }
  }
}

writeFileSync(path.join(outDir, "summary.md"), renderSummary(records, { photoCount: inputs.photos.length, startedAt: startedAt.toISOString() }));
writeFileSync(path.join(outDir, "evaluation.md"), renderEvaluationSheet(records));
console.log(`\n요약: ${path.join(outDir, "summary.md")}\n직접 평가표: ${path.join(outDir, "evaluation.md")}`);
process.exit(records.some((r) => r.authAborted) ? 3 : 0);
