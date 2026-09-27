/**
 * 원고 작성 단계의 지시문, 스키마, 구조 검사, 결과 정리.
 * 사진 파일은 쓰지 않고, Android에 저장된 해당 Provider의 사진 분석(텍스트)만 쓴다.
 */
import type { PhotoAnalysis } from "./analysis.js";

export type StyleSettings = {
  endings?: string;
  sentenceLength?: string;
  paragraphLength?: string;
  emojiFrequency?: string;
  laughStyle?: string;
  favoritePhrases?: string;
  avoidPhrases?: string;
  reviewStructure?: string;
  customInstructions?: string;
};

export type WritingPhoto = { photoId: string; postOrder: number; analysis: PhotoAnalysis };

export type WritingInput = {
  category: string;
  subjectName: string;
  memo: string;
  style: StyleSettings;
  /** postOrder 순서로 정렬된 사진 */
  photos: WritingPhoto[];
};

/** 두 Provider의 엄격한 구조화 출력을 모두 통과하는 평평한 스키마 (PoC 원칙). 사진은 번호(photoRefs)로만 가리킨다. */
export const writingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["titleCandidates", "blocks", "hashtags", "confirmNeeded"],
  properties: {
    titleCandidates: { type: "array", items: { type: "string" } },
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "photoRefs"],
        properties: {
          type: { type: "string", enum: ["heading", "paragraph", "imageGroup"] },
          text: { type: "string" },
          photoRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
    hashtags: { type: "array", items: { type: "string" } },
    confirmNeeded: { type: "array", items: { type: "string" } },
  },
} as const;

const CATEGORIES: Record<string, { label: string; keyFacts: string; extra?: string }> = {
  RESTAURANT: { label: "맛집", keyFacts: "가게 이름, 위치(지역), 먹은 메뉴, 가격" },
  EVENT: { label: "공연·행사", keyFacts: "공연·행사 이름, 장소, 날짜" },
  PRODUCT: { label: "제품", keyFacts: "제품 이름, 가격 또는 구매처" },
  CLINIC: {
    label: "병원·피부관리",
    keyFacts: "병원·샵 이름, 시술·관리 이름",
    extra: "병원·피부관리 글은 효과·결과를 단정하거나 과장하지 않는다(의료 광고 규정). 효과는 메모에 적힌 사용자의 느낌으로만 쓴다.",
  },
  TRAVEL: { label: "여행", keyFacts: "방문한 각 장소의 이름" },
  OTHER: { label: "기타", keyFacts: "대상 이름" },
};

const STYLE_LABELS: [keyof StyleSettings, string][] = [
  ["endings", "종결어미"],
  ["sentenceLength", "문장 길이"],
  ["paragraphLength", "문단 길이"],
  ["emojiFrequency", "이모지"],
  ["laughStyle", "ㅋㅋ/ㅎㅎ"],
  ["favoritePhrases", "자주 쓰는 표현"],
  ["avoidPhrases", "피해야 할 표현"],
  ["reviewStructure", "후기 구성"],
  ["customInstructions", "기타 지침"],
];

function photoLine(photo: WritingPhoto, index: number): string {
  const a = photo.analysis;
  return [
    `사진 ${index + 1}: 종류 ${a.type}`,
    `설명: ${a.description}`,
    `사진 속 글자: ${a.visibleText || "(없음)"}`,
    `불확실: ${a.uncertain.length ? a.uncertain.join(" / ") : "(없음)"}`,
  ].join(" | ");
}

export function buildWritingPrompt(input: WritingInput): string {
  const n = input.photos.length;
  const category = CATEGORIES[input.category] ?? CATEGORIES.OTHER;
  const styleLines = STYLE_LABELS.map(([key, label]) => [label, input.style[key]?.trim()] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);

  return [
    "너는 사용자의 실제 경험을 바탕으로 네이버 블로그 후기 초안을 쓰는 작가다.",
    "아래 입력은 출처별로 나뉘어 있다. 출처를 섞지 말고, 각 출처가 허용하는 방식으로만 쓴다.",
    "",
    "[작성 정보] — 사용자가 직접 입력한 사실",
    `- 카테고리: ${category.label}`,
    `- 대상 이름: ${input.subjectName.trim() || "(입력 없음)"}`,
    "",
    "[사용자 메모] — 사용자가 직접 겪은 일. 1인칭 경험·행동·감정·평가는 여기에 있는 것만 쓸 수 있다.",
    input.memo.trim() || "(메모 없음)",
    "",
    `[사진 분석] — 사진 ${n}장, 포스팅 순서대로 번호 1~${n}. 사진에 '보이는 것'일 뿐, 사용자가 그것을 했다·먹었다·느꼈다는 근거가 아니다.`,
    ...input.photos.map(photoLine),
    "",
    "[문체 설정]",
    ...(styleLines.length ? styleLines : ["- (설정 없음: 친근하고 담백한 블로그 말투)"]),
    "",
    "# 사실 규칙 (가장 우선. 문체보다 앞선다)",
    "1. 1인칭 경험, 행동, 감정, 평가(맛, 친절, 분위기, 만족, 추천 등)는 [사용자 메모]에 있을 때만 사실로 쓴다.",
    "2. [사진 분석]은 \"사진 속 ~가 보여요\", \"~가 놓여 있어요\"처럼 관찰로만 쓴다. 사진만 보고 사용자가 그것을 주문·구매·사용·경험했다고 쓰지 않는다.",
    "3. 사진 분석만으로 다음을 추론하지 않는다: 방문 동기, 장소 사이의 관계나 위치, 시간대(아침·점심·저녁), 주문·소유 여부, 날씨나 그 원인, 대기 시간, 인원, 가격, 영업시간, 주차, 맛, 친절도, 효능·효과.",
    "4. [사진 분석]의 '불확실' 항목은 단정하지 않는다.",
    "5. 고유명사와 숫자(가게·장소 이름, 메뉴명, 가격, 날짜)는 [사용자 메모], [작성 정보], 사진 속 글자에 있는 것만 쓴다. 사진 속 글자를 쓸 때는 \"간판에 ~라고 적혀 있어요\"처럼 출처를 드러낸다.",
    `6. 글에 필요한데 근거가 없는 핵심 정보는 본문에 [확인 필요: 항목]으로 남기고 confirmNeeded에 같은 항목을 넣는다. 이 카테고리의 핵심 정보는 "${category.keyFacts}"이다. 이 중 글에 쓰는데 근거가 없는 것, 그리고 글의 핵심과 관련된 '불확실' 항목만 해당한다. 사소한 정보는 지어내지도, 확인 필요로 만들지도 않는다.`,
    ...(category.extra ? [`7. ${category.extra}`] : []),
    "",
    "# 사진 배치 규칙",
    `- blocks의 imageGroup에 photoRefs로 사진 번호를 넣는다. 1부터 ${n}까지 모든 번호를 정확히 한 번씩, 번호 순서대로 쓴다.`,
    "- 순서를 바꾸거나 빼거나 중복하지 않는다. 한 imageGroup에는 연속된 번호만 묶는다(예: 3, 4, 5).",
    "- 비슷한 연속 사진은 한 그룹으로 묶고, 각 imageGroup 바로 뒤에 그 사진들에 대한 heading 또는 paragraph를 쓴다. 첫 imageGroup 앞에 짧은 도입 문단이 있어도 된다.",
    "",
    "# 형식",
    "- titleCandidates: 제목 후보 정확히 3개. 대표 키워드를 앞쪽에 자연스럽게 넣는다.",
    "- blocks: type이 heading, paragraph, imageGroup인 블록. heading·paragraph는 text에 내용, photoRefs는 []. imageGroup은 photoRefs에 번호, text는 \"\".",
    "- hashtags: 5~10개, '#'을 붙인다.",
    "- confirmNeeded: 사실 규칙 6에 해당하는 항목. 없으면 [].",
    "- 본문에 마크다운 기호(#, **, - 목록)를 쓰지 않는다. 네이버 에디터에 그대로 붙여넣을 순수 텍스트로, 문단은 짧게, 과장된 광고 문구 없이 쓴다.",
    "- 파일을 읽거나 명령을 실행하지 말고 이 입력만으로 답한다.",
  ].join("\n");
}

export function buildRepairPrompt(input: WritingInput, previous: unknown, problems: string[]): string {
  return [
    buildWritingPrompt(input),
    "",
    "# 이전 응답의 구조 문제 (반드시 고칠 것)",
    ...problems.map((p) => `- ${p}`),
    "",
    "이전 응답(JSON):",
    JSON.stringify(previous),
    "",
    "위 구조 문제만 고쳐서 같은 스키마로 다시 답한다. 글 내용과 문체는 최대한 그대로 둔다.",
  ].join("\n");
}

type RawBlock = { type: string; text: string; photoRefs: string[] };
type RawDraft = { titleCandidates: string[]; blocks: RawBlock[]; hashtags: string[]; confirmNeeded: string[] };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** 코드로 판정할 수 있는 구조 문제를 모두 찾는다. 문제가 없으면 []. */
export function findStructureProblems(output: unknown, photoCount: number): string[] {
  const o = output as Partial<RawDraft> | null;
  if (!o || typeof o !== "object") return ["응답이 JSON 객체가 아님"];
  const problems: string[] = [];
  if (!isStringArray(o.titleCandidates)) problems.push("titleCandidates가 문자열 배열이 아님");
  else if (o.titleCandidates.filter((t) => t.trim()).length !== 3) problems.push(`제목 후보가 정확히 3개가 아님 (${o.titleCandidates.length}개)`);
  if (!isStringArray(o.hashtags)) problems.push("hashtags가 문자열 배열이 아님");
  if (!isStringArray(o.confirmNeeded)) problems.push("confirmNeeded가 문자열 배열이 아님");
  if (!Array.isArray(o.blocks)) return [...problems, "blocks가 배열이 아님"];

  const blocks = o.blocks as RawBlock[];
  if (!blocks.every((b) => b && ["heading", "paragraph", "imageGroup"].includes(b.type) && typeof b.text === "string" && isStringArray(b.photoRefs))) {
    problems.push("blocks 항목 형식이 올바르지 않음");
    return problems;
  }
  if (!blocks.some((b) => b.type !== "imageGroup" && b.text.trim())) problems.push("본문(heading/paragraph)이 없음");

  const seen: number[] = [];
  const unknown = new Set<string>();
  blocks.filter((b) => b.type === "imageGroup").forEach((group, gi) => {
    if (group.photoRefs.length === 0) problems.push(`${gi + 1}번째 사진 그룹이 비어 있음`);
    const nums = group.photoRefs.map((r) => (/^\d+$/.test(r.trim()) ? Number(r.trim()) : NaN));
    nums.forEach((num, i) => {
      if (!Number.isInteger(num) || num < 1 || num > photoCount) unknown.add(group.photoRefs[i]);
      else seen.push(num);
    });
    const valid = nums.filter((x) => Number.isInteger(x));
    if (valid.some((x, i) => i > 0 && x !== valid[i - 1] + 1)) {
      problems.push(`${gi + 1}번째 사진 그룹이 연속된 번호가 아님 (${group.photoRefs.join(", ")})`);
    }
  });
  if (unknown.size) problems.push(`없는 사진 번호: ${[...unknown].join(", ")}`);
  const missing = Array.from({ length: photoCount }, (_, i) => i + 1).filter((x) => !seen.includes(x));
  if (missing.length) problems.push(`빠진 사진 번호: ${missing.join(", ")}`);
  const duplicated = [...new Set(seen.filter((x, i) => seen.indexOf(x) !== i))];
  if (duplicated.length) problems.push(`중복된 사진 번호: ${duplicated.join(", ")}`);
  if (!missing.length && !duplicated.length && seen.some((x, i) => x !== i + 1)) {
    problems.push(`사진 순서가 바뀜 (${seen.join(", ")})`);
  }
  return problems;
}

export type PostBlock = { type: "heading" | "paragraph" | "imageGroup"; text: string; photoIds: string[] };
export type FinalDraft = { titleCandidates: string[]; blocks: PostBlock[]; hashtags: string[]; confirmNeeded: string[] };
export type ValidationItem = { label: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

const CONFIRM_PATTERN = /\[확인\s*필요\s*:\s*([^\]]+)\]/g;

/** 본문과 제목의 [확인 필요: X]를 모두 찾는다. */
export function extractConfirmMarkers(texts: string[]): string[] {
  const found: string[] = [];
  for (const text of texts) for (const match of text.matchAll(CONFIRM_PATTERN)) found.push(match[1].trim());
  return [...new Set(found)];
}

const normalizeKey = (s: string) => s.replace(/\s+/g, "");

/**
 * 구조 검사를 통과한 결과를 앱에 보낼 형태로 정리한다.
 * - 사진 번호 → photoId
 * - [확인 필요]와 confirmNeeded 동기화 (본문에만 있는 항목을 목록에 추가)
 * - 해시태그 '#' 보정과 중복 제거, 빈 문단 제거
 */
export function finalizeDraft(output: unknown, photos: WritingPhoto[], repairedProblems: string[] | null): { draft: FinalDraft; validation: ValidationItem[] } {
  const raw = output as RawDraft;
  const blocks: PostBlock[] = raw.blocks
    .map((b): PostBlock =>
      b.type === "imageGroup"
        ? { type: "imageGroup", text: "", photoIds: b.photoRefs.map((r) => photos[Number(r.trim()) - 1].photoId) }
        : { type: b.type as "heading" | "paragraph", text: b.text.trim(), photoIds: [] },
    )
    .filter((b) => b.type === "imageGroup" || b.text.length > 0);

  const titleCandidates = raw.titleCandidates.map((t) => t.trim()).filter(Boolean);
  const markers = extractConfirmMarkers([...titleCandidates, ...blocks.map((b) => b.text)]);
  const listed = raw.confirmNeeded.map((c) => c.trim()).filter(Boolean);
  const listedKeys = new Set(listed.map(normalizeKey));
  const added = markers.filter((m) => !listedKeys.has(normalizeKey(m)));
  const confirmNeeded = [...new Set([...listed, ...added])];

  const hashtags = [...new Set(raw.hashtags.map((h) => h.trim().replace(/\s+/g, "")).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)))];

  const uncertainCount = photos.reduce((sum, p) => sum + p.analysis.uncertain.length, 0);
  const markdown = blocks.some((b) => /\*\*|^#{1,6}\s|^\s*[-*]\s/m.test(b.text));

  const validation: ValidationItem[] = [
    { label: "구조", status: "PASS", detail: "스키마, 제목 후보 3개" },
    { label: "사진", status: "PASS", detail: `${photos.length}/${photos.length}장, 누락·중복 없이 포스팅 순서대로, 연속된 사진끼리만 묶음` },
    {
      label: "확인 필요 동기화",
      status: added.length ? "WARN" : "PASS",
      detail: added.length ? `본문의 [확인 필요] ${added.length}개를 목록에 추가` : `본문 표시 ${markers.length}개, 목록 ${confirmNeeded.length}개`,
    },
  ];
  if (uncertainCount > 0 && confirmNeeded.length === 0) {
    validation.push({ label: "불확실 항목", status: "WARN", detail: `사진 분석에 불확실 항목 ${uncertainCount}개가 있는데 확인 필요 목록이 비어 있어요. 본문을 한 번 확인하세요.` });
  }
  if (markdown) validation.push({ label: "마크다운 기호", status: "WARN", detail: "본문에 #, **, - 같은 기호가 있어요. 붙여넣기 전에 확인하세요." });
  if (repairedProblems) validation.push({ label: "자동 구조 수정", status: "WARN", detail: `1회 수정됨: ${repairedProblems.join(" / ")}` });

  return { draft: { titleCandidates, blocks, hashtags, confirmNeeded }, validation };
}
