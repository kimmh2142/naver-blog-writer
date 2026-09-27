import { parseDraft, type Draft } from "./checks.js";
import type { PreparedPhoto } from "./inputs.js";
import type { RunRecord } from "./providers/types.js";

// 콘솔 글꼴에서 영문 O와 숫자 0이 헷갈리지 않도록 글자로 표시한다.
export const passFail = (v: boolean | undefined | null) => (v ? "통과" : "실패");

/** 사람이 읽고 평가하기 쉬운 원고 미리보기 (네이버에 붙일 때의 순서대로). */
export function renderPreview(record: RunRecord, photos: PreparedPhoto[]): string {
  const lines = [`# ${record.provider} · ${record.runIndex}회차`, ""];
  const draft = parseDraft(record.rawOutput) as Partial<Draft> | null;
  if (!draft || !record.checks?.schemaValid) {
    lines.push("결과를 스키마대로 받지 못했습니다.", "", `오류: ${record.error ?? "-"}`, "", "```", String(JSON.stringify(record.rawOutput, null, 2)).slice(0, 4000), "```");
    return lines.join("\n");
  }
  const sourceName = new Map(photos.map((p) => [p.photoId, p.sourceName]));
  lines.push("## 제목 후보");
  draft.titles?.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  lines.push("", "## 본문");
  for (const block of draft.blocks ?? []) {
    if (block.type === "imageGroup") {
      lines.push("", `📷 ${block.photoIds.map((id) => `${id}(${sourceName.get(id) ?? "?"})`).join(", ")}`, "");
    } else if (block.type === "heading") {
      lines.push("", `### ${block.text}`);
    } else {
      lines.push(block.text, "");
    }
  }
  lines.push("", "## 해시태그", (draft.hashtags ?? []).join(" "));
  lines.push("", "## 확인 필요", ...((draft.confirmNeeded ?? []).length ? draft.confirmNeeded!.map((c) => `- ${c}`) : ["- (없음)"]));
  lines.push("", "## AI가 본 사진 설명");
  for (const p of draft.photos ?? []) lines.push(`- ${p.photoId}(${sourceName.get(p.photoId) ?? "?"}): ${p.description}`);
  return lines.join("\n");
}

function subscriptionChange(record: RunRecord): string {
  if (record.provider === "codex") {
    const fmt = (snapshot: any) => {
      const rl = snapshot?.rateLimits;
      if (!rl) return snapshot?.error ? `오류` : "-";
      return [rl.primary, rl.secondary]
        .filter(Boolean)
        .map((w: any) => `${w.windowDurationMins}분 ${w.usedPercent}%`)
        .join(", ");
    };
    return `${fmt(record.subscription.before)} → ${fmt(record.subscription.after)}`;
  }
  const events = record.subscription.duringRun as { utilization?: number; status?: string }[];
  if (events.length === 0) return "실행 중 사용량 이벤트 없음 (claude.ai 설정 > 사용량에서 직접 확인)";
  const values = events.map((e) => `${e.status ?? "?"}${e.utilization !== undefined ? ` ${e.utilization}` : ""}`);
  return `실행 중 rate_limit_event ${events.length}건: ${values.join(" → ")}`;
}

export function renderSummary(records: RunRecord[], meta: { photoCount: number; startedAt: string }): string {
  const lines = [
    "# PoC 결과 요약",
    "",
    `- 시작: ${meta.startedAt}`,
    `- 입력: 사진 ${meta.photoCount}장 + memo.txt + style.txt (두 Provider 동일)`,
    "",
    "| Provider | 회차 | 성공 | 스키마 | 제목3 | 사진 인식 | 순서 보존 | 시간(초) | 재시도 | 인증 | 모델 | 오류 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of records) {
    const c = r.checks;
    lines.push(
      `| ${r.provider} | ${r.runIndex} | ${passFail(r.success)} | ${passFail(c?.schemaValid)} | ${c ? (c.titlesCount === 3 ? "통과" : `실패(${c.titlesCount})`) : "-"} | ` +
        `${passFail(c?.allPhotosRecognized)} | ${c ? (c.orderPreserved ? "통과" : `실패: ${c.orderProblem}`) : "-"} | ` +
        `${(r.durationMs / 1000).toFixed(1)} | ${r.retries.sdkApiRetries ?? "?"} | ${r.authAborted ? "중단" : "구독"} | ${r.model ?? "-"} | ${(r.error ?? "").replace(/\|/g, "/").slice(0, 80)} |`,
    );
  }
  lines.push("", "## 구독 사용량 변화", "");
  for (const r of records) lines.push(`- ${r.provider} ${r.runIndex}회차: ${subscriptionChange(r)}`);
  lines.push("", "## 본문 분량", "");
  for (const r of records) {
    if (r.checks?.schemaValid) {
      lines.push(`- ${r.provider} ${r.runIndex}회차: ${r.checks.bodyChars}자 (공백 제외 ${r.checks.bodyCharsNoSpaces}자), 사진 그룹 ${r.checks.imageGroupCount}개, 글 블록 ${r.checks.textBlockCount}개`);
    }
  }
  lines.push("", "각 회차 원고는 `<provider>-run<N>.md`, 전체 기록은 `<provider>-run<N>.json`에 있습니다.");
  return lines.join("\n");
}

/** 직접 평가할 항목. 결과를 읽고 채워 넣는다. */
export function renderEvaluationSheet(records: RunRecord[]): string {
  const lines = [
    "# 직접 평가표",
    "",
    "점수는 1(나쁨)~5(좋음). '지어낸 사실'에는 메모/사진에 없는데 쓴 내용을 그대로 적어 주세요.",
    "'수정 없이 사용'은 네이버에 그대로 올릴 수 있는 정도(%)입니다.",
    "",
    "| Provider | 회차 | 글 품질 | 내 말투 반영 | 사진-글 연결 | 지어낸 사실 (없으면 '없음') | 수정 없이 사용(%) | 메모 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of records) lines.push(`| ${r.provider} | ${r.runIndex} |  |  |  |  |  |  |`);
  lines.push("", "## 종합 의견", "", "- Claude:", "- Codex:", "- 선택:");
  return lines.join("\n");
}
