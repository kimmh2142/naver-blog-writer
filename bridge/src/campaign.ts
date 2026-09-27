/**
 * 체험단 조건 확인. 별도 AI 호출 없이, 원고 작성 호출이 함께 돌려준 값만 쓴다.
 * - campaignRules: 작성 모델이 안내문에서 뽑은 "코드로 확인할 수 있는" 조건 (제목/본문 키워드, 해시태그, 사진 수)
 * - campaignChecks: 그 밖의 조건에 대한 작성 모델의 판단
 * 코드로 확인할 수 있는 조건은 실제 원고를 세어서 판정한다(작성 모델의 자기 평가를 믿지 않는다).
 */

/**
 * APPLIED: 원고에서 처리됨
 * MANUAL: 사용자가 직접 해야 함 (동영상, 지도, 링크 첨부 등)
 * NEEDS_CONFIRMATION: 사실 근거가 없어 자동으로 반영하지 않음
 * UNMET: 코드로 확인했더니 조건을 채우지 못함 (코드만 씀)
 */
export type CampaignStatus = "APPLIED" | "MANUAL" | "NEEDS_CONFIRMATION" | "UNMET";

export type CampaignCheck = { requirement: string; status: CampaignStatus; note: string; checkedBy: "code" | "ai" };

export type CampaignRules = {
  titleKeywords: string[];
  bodyKeywords: { keyword: string; minCount: number }[];
  requiredHashtags: string[];
  minPhotos: number;
};

/** 작성 스키마에 붙는 체험단 필드. 체험단이 아니면 모델은 빈 값을 돌려준다. */
export const campaignSchemaProperties = {
  campaignRules: {
    type: "object",
    additionalProperties: false,
    required: ["titleKeywords", "bodyKeywords", "requiredHashtags", "minPhotos"],
    properties: {
      titleKeywords: { type: "array", items: { type: "string" } },
      bodyKeywords: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["keyword", "minCount"],
          properties: { keyword: { type: "string" }, minCount: { type: "integer" } },
        },
      },
      requiredHashtags: { type: "array", items: { type: "string" } },
      minPhotos: { type: "integer" },
    },
  },
  campaignChecks: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["requirement", "status", "note"],
      properties: {
        requirement: { type: "string" },
        status: { type: "string", enum: ["APPLIED", "MANUAL", "NEEDS_CONFIRMATION"] },
        note: { type: "string" },
      },
    },
  },
} as const;

/** 원고 텍스트만으로는 끝낼 수 없는 작업. 작성 모델이 "처리함"이라고 해도 사용자 직접 항목으로 바꾼다. */
const MANUAL_PATTERN = /동영상|영상|gif|움짤|지도|플레이스|링크|url|영수증|인증\s*사진|스티커|업로드|첨부|촬영/i;

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const stripHash = (s: string) => s.trim().replace(/^#+/, "");

function countOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0;
  let count = 0;
  let from = 0;
  const hay = text.toLowerCase();
  const needle = keyword.toLowerCase();
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}

/** 작성 모델이 뽑은 규칙 중, 실제로 안내문에 적힌 문자열만 남긴다(모델이 조건을 지어내지 않게). */
export function sanitizeRules(raw: unknown, campaignText: string): CampaignRules {
  const r = (raw ?? {}) as Partial<CampaignRules>;
  const inText = (keyword: string) => keyword.length > 0 && squash(campaignText).includes(squash(keyword));
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : []);
  const unique = <T>(list: T[], key: (t: T) => string) => list.filter((t, i) => list.findIndex((u) => key(u) === key(t)) === i);

  const bodyKeywords = Array.isArray(r.bodyKeywords)
    ? r.bodyKeywords
        .filter((b): b is { keyword: string; minCount: number } => !!b && typeof b.keyword === "string")
        .map((b) => ({ keyword: b.keyword.trim(), minCount: Number.isInteger(b.minCount) && b.minCount > 0 ? Math.min(b.minCount, 20) : 1 }))
        .filter((b) => inText(b.keyword))
    : [];
  const minPhotos = Number.isInteger(r.minPhotos) && (r.minPhotos as number) > 0 && squash(campaignText).includes(String(r.minPhotos)) ? (r.minPhotos as number) : 0;
  return {
    titleKeywords: unique(strings(r.titleKeywords).filter(inText), squash),
    bodyKeywords: unique(bodyKeywords, (b) => squash(b.keyword)),
    requiredHashtags: unique(strings(r.requiredHashtags).map(stripHash).filter(inText), squash),
    minPhotos,
  };
}

export type CheckTarget = { titleCandidates: string[]; bodyText: string; hashtags: string[]; photoCount: number };

/** 코드로 확인할 수 있는 조건을 실제 원고에서 센다. */
export function codeChecks(rules: CampaignRules, target: CheckTarget): CampaignCheck[] {
  const checks: CampaignCheck[] = [];
  const check = (requirement: string, ok: boolean, note: string): CampaignCheck => ({ requirement, status: ok ? "APPLIED" : "UNMET", note, checkedBy: "code" });

  for (const keyword of rules.titleKeywords) {
    const hits = target.titleCandidates.map((t, i) => (squash(t).includes(squash(keyword)) ? i + 1 : 0)).filter((i) => i > 0);
    const all = hits.length === target.titleCandidates.length && hits.length > 0;
    checks.push(
      check(
        `제목에 "${keyword}" 포함`,
        all,
        all ? `제목 후보 ${hits.length}개 모두 포함` : hits.length ? `제목 후보 ${hits.join(", ")}번에만 포함 — 포함된 제목을 고르세요` : "제목 후보에 없음 — 제목을 고칠 때 넣으세요",
      ),
    );
  }
  for (const { keyword, minCount } of rules.bodyKeywords) {
    const count = countOccurrences(target.bodyText, keyword);
    checks.push(check(`본문에 "${keyword}" ${minCount}회 이상`, count >= minCount, `본문 ${count}회${count >= minCount ? "" : ` (필요 ${minCount}회)`}`));
  }
  const tags = new Set(target.hashtags.map((h) => squash(stripHash(h))));
  for (const tag of rules.requiredHashtags) {
    const ok = tags.has(squash(tag));
    checks.push(check(`해시태그 #${tag}`, ok, ok ? "해시태그에 있음" : "해시태그에 없음 — 직접 추가하세요"));
  }
  if (rules.minPhotos > 0) {
    const ok = target.photoCount >= rules.minPhotos;
    checks.push(
      check(
        `사진 ${rules.minPhotos}장 이상`,
        ok,
        ok ? `앱에서 고른 사진 ${target.photoCount}장 — 게시할 때 모두 첨부하세요` : `앱에서 고른 사진 ${target.photoCount}장 (필요 ${rules.minPhotos}장)`,
      ),
    );
  }
  return checks;
}

/** 작성 모델의 판단을 정리한다. 텍스트로 끝낼 수 없는 작업을 "처리함"이라고 하면 사용자 직접 항목으로 바꾼다. */
export function aiChecks(raw: unknown): CampaignCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.requirement === "string" && c.requirement.trim())
    .map((c): CampaignCheck => {
      const requirement = c.requirement.trim();
      const note = typeof c.note === "string" ? c.note.trim() : "";
      const status: CampaignStatus = ["APPLIED", "MANUAL", "NEEDS_CONFIRMATION"].includes(c.status) ? c.status : "NEEDS_CONFIRMATION";
      if (status === "APPLIED" && MANUAL_PATTERN.test(requirement)) {
        return { requirement, status: "MANUAL", note: "원고 텍스트만으로는 끝낼 수 없어요. 네이버 에디터에서 직접 추가하세요.", checkedBy: "ai" };
      }
      return { requirement, status, note, checkedBy: "ai" };
    });
}

/** 체험단 체크리스트 전체. 체험단이 아니면 []. */
export function buildCampaignChecks(output: { campaignRules?: unknown; campaignChecks?: unknown }, campaignText: string | null, target: CheckTarget): CampaignCheck[] {
  if (!campaignText) return [];
  const checks = [...codeChecks(sanitizeRules(output.campaignRules, campaignText), target), ...aiChecks(output.campaignChecks)];
  if (checks.length === 0) {
    checks.push({ requirement: "체험단 안내문 전체", status: "MANUAL", note: "자동으로 확인한 조건이 없어요. 게시 전에 안내문을 직접 한 번 더 확인하세요.", checkedBy: "code" });
  }
  return checks;
}
