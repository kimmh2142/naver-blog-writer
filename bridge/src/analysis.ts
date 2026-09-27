/**
 * 사진 분석(Vision) 단계의 지시문, 스키마, 결과 정리.
 * 두 Provider가 같은 지시문과 스키마를 쓰고, 결과는 같은 형태(PhotoAnalysis)로 정리된다.
 */

/** 지시문이나 스키마를 바꾸면 올린다. Android 캐시는 이 값이 같을 때만 재사용한다. */
export const ANALYSIS_VERSION = "v1";

export const PHOTO_TYPES = [
  "food",
  "drink",
  "menu",
  "exterior",
  "interior",
  "product",
  "place",
  "people",
  "document",
  "before_after",
  "other",
] as const;

export type PhotoAnalysis = {
  type: (typeof PHOTO_TYPES)[number];
  description: string;
  visibleText: string;
  tags: string[];
  uncertain: string[];
};

/** 두 Provider의 엄격한 구조화 출력을 모두 통과하도록 모든 필드를 필수로 둔 평평한 스키마 (PoC에서 확인한 원칙). */
export const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "type", "description", "visibleText", "tags", "uncertain"],
        properties: {
          ref: { type: "string" },
          type: { type: "string", enum: [...PHOTO_TYPES] },
          description: { type: "string" },
          visibleText: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          uncertain: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export function buildAnalysisPrompt(count: number, context: { category?: string; subjectName?: string }): string {
  const refs = Array.from({ length: count }, (_, i) => String(i + 1)).join(", ");
  return [
    "너는 블로그 원고 작성을 돕기 위해 사진에 보이는 것만 기록하는 관찰자다.",
    "",
    "# 입력",
    `- 첨부 이미지 ${count}장. 첨부된 순서대로 ref는 ${refs} 이다. (첫 번째 이미지 = 1)`,
    `- 참고용 맥락(사진 내용의 근거로 쓰지 말 것): 카테고리 ${context.category ?? "-"}, 대상 ${context.subjectName?.trim() || "-"}`,
    "",
    "# 규칙",
    "1. description: 사진에 실제로 보이는 것만 1~2문장으로 쓴다.",
    "   - 평가·감정·맛·분위기 판단(맛있어 보인다, 예쁘다, 아늑하다 등)을 쓰지 않는다.",
    "   - 사진 밖의 사실(장소 이름, 시간대, 날씨의 원인, 누가 주문했는지, 사진 사이의 관계)을 추측하지 않는다.",
    "2. visibleText: 사진 속 글자(간판, 메뉴판, 가격표, 포장, 표지판)를 보이는 그대로 옮긴다. 없으면 \"\".",
    "   - 읽기 어려운 글자는 추측해서 채우지 말고 uncertain에 적는다.",
    "3. uncertain: 확실하지 않은 해석을 짧게 적는다. 예: \"우산인지 양산인지 불확실\", \"메뉴판 가격 일부가 흐려 읽기 어려움\". 없으면 [].",
    "4. tags: 사진에 보이는 대상을 나타내는 짧은 명사 1~5개.",
    `5. type: ${PHOTO_TYPES.join(", ")} 중 하나.`,
    `6. photos에는 ref ${refs} 를 정확히 한 번씩, 순서대로 넣는다.`,
    "7. 파일을 읽거나 명령을 실행하지 말고, 첨부 이미지만 보고 답한다.",
  ].join("\n");
}

export type AnalysisOutcome = {
  results: { photoId: string; analysis: PhotoAnalysis }[];
  failed: { photoId: string; reason: string }[];
};

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cleanList = (value: unknown) =>
  Array.isArray(value) ? value.map(clean).filter((v) => v.length > 0) : [];

/**
 * 모델이 돌려준 ref(1..N)를 앱의 photoId로 되돌린다. 모델이 photoId를 직접 다루지 않게 해서 ID가 바뀔 일이 없다.
 * 빠졌거나 중복된 사진, 설명이 빈 사진은 그 사진만 실패로 돌린다.
 */
export function normalizeAnalysis(output: unknown, photoIds: string[]): AnalysisOutcome | null {
  const photos = (output as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(photos)) return null;

  const byRef = new Map<string, Record<string, unknown>[]>();
  for (const item of photos) {
    if (!item || typeof item !== "object") continue;
    const ref = clean((item as Record<string, unknown>).ref);
    byRef.set(ref, [...(byRef.get(ref) ?? []), item as Record<string, unknown>]);
  }

  const outcome: AnalysisOutcome = { results: [], failed: [] };
  photoIds.forEach((photoId, index) => {
    const matches = byRef.get(String(index + 1)) ?? [];
    if (matches.length === 0) {
      outcome.failed.push({ photoId, reason: "분석 결과에 이 사진이 없음" });
      return;
    }
    if (matches.length > 1) {
      outcome.failed.push({ photoId, reason: "분석 결과에 이 사진이 중복됨" });
      return;
    }
    const item = matches[0];
    const description = clean(item.description);
    if (!description) {
      outcome.failed.push({ photoId, reason: "사진 설명이 비어 있음" });
      return;
    }
    const type = PHOTO_TYPES.includes(item.type as PhotoAnalysis["type"]) ? (item.type as PhotoAnalysis["type"]) : "other";
    outcome.results.push({
      photoId,
      analysis: {
        type,
        description,
        visibleText: clean(item.visibleText),
        tags: cleanList(item.tags),
        uncertain: cleanList(item.uncertain),
      },
    });
  });
  return outcome;
}
