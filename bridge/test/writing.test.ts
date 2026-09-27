import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGenerateBody } from "../src/server.js";
import {
  buildRepairPrompt,
  buildWritingPrompt,
  extractConfirmMarkers,
  finalizeDraft,
  findStructureProblems,
  type WritingInput,
} from "../src/writing.js";

const photo = (id: string, order: number, uncertain: string[] = []) => ({
  photoId: id,
  postOrder: order,
  analysis: { type: "food" as const, description: `설명 ${id}`, visibleText: id === "a" ? "초원사진관" : "", tags: [], uncertain },
});

const input: WritingInput = {
  category: "TRAVEL",
  subjectName: "군산 당일치기",
  memo: "엄마랑 초원사진관 가서 사진 찍음",
  style: { endings: "~했어요", avoidPhrases: "존맛탱", customInstructions: "" },
  photos: [photo("a", 0), photo("b", 1, ["우산인지 양산인지 불확실"]), photo("c", 2), photo("d", 3)],
  campaignText: null,
};

const draft = (groups: string[][], extra: Partial<Record<string, unknown>> = {}) => ({
  titleCandidates: ["제목1", "제목2", "제목3"],
  blocks: [
    { type: "paragraph", text: "도입 문단", photoRefs: [] },
    ...groups.flatMap((g) => [
      { type: "imageGroup", text: "", photoRefs: g },
      { type: "paragraph", text: `사진 ${g.join(",")} 설명`, photoRefs: [] },
    ]),
  ],
  hashtags: ["#군산", "여행"],
  confirmNeeded: [],
  ...extra,
});

test("지시문: 출처 구분, 사실 규칙, 사진 번호, 문체, 카테고리 핵심 정보", () => {
  const prompt = buildWritingPrompt(input);
  for (const section of ["[작성 정보]", "[사용자 메모]", "[사진 분석]", "[문체 설정]"]) assert.ok(prompt.includes(section), section);
  assert.match(prompt, /사진 1: 종류 food \| 설명: 설명 a \| 사진 속 글자: 초원사진관/);
  assert.match(prompt, /불확실: 우산인지 양산인지 불확실/);
  assert.match(prompt, /방문 동기, 장소 사이의 관계/);
  assert.match(prompt, /1부터 4까지 모든 번호를 정확히 한 번씩/);
  assert.match(prompt, /- 종결어미: ~했어요/);
  assert.doesNotMatch(prompt, /기타 지침/); // 빈 문체 항목은 넣지 않음
  assert.match(prompt, /방문한 각 장소의 이름/);
  assert.match(buildWritingPrompt({ ...input, category: "CLINIC" }), /효과·결과를 단정하거나 과장하지 않는다/);
  assert.match(buildRepairPrompt(input, { x: 1 }, ["빠진 사진 번호: 4"]), /빠진 사진 번호: 4/);
});

test("기본 문체: 자연스러운 '~다'체, 사용자 문체가 우선, 사실 규칙이 가장 우선", () => {
  const noStyle = buildWritingPrompt({ ...input, style: {} });
  assert.match(noStyle, /- \(사용자 설정 없음\)/);
  assert.match(noStyle, /자연스러운 개인 블로그의 '~다'체/);
  assert.match(noStyle, /방문했다, 공간이 넓다, 전시되어 있다, 볼 수 있다/);
  assert.match(noStyle, /종결어미가 따로 없으면 존댓말\(~했어요, ~있어요, ~보여요\)을 쓰지 않는다/);
  assert.match(noStyle, /뉴스 기사처럼 딱딱하게 쓰지 않는다/);
  assert.match(noStyle, /사실 규칙 > 사용자 문체 설정 > 기본 문체/);
  // 사용자 문체 설정은 그대로 전달되고 기본 문체보다 우선한다고 적혀 있다
  const withStyle = buildWritingPrompt(input);
  assert.match(withStyle, /- 종결어미: ~했어요/);
  assert.match(withStyle, /아래 기본 문체보다 우선한다/);
});

test("사진 묘사: '사진에는 ~가 보인다'를 반복하지 않고 본문에 녹이되, 경험으로 바꾸지 않는다", () => {
  const prompt = buildWritingPrompt(input);
  assert.match(prompt, /사진을 가리키는 문장을 반복하지 않는다/);
  assert.match(prompt, /'철길 주변으로 나무가 이어져 있다'/);
  assert.match(prompt, /관찰을 사용자의 경험으로 바꾸지 않는다/);
  assert.match(prompt, /'철길을 걸어보니 분위기가 너무 좋았다'/);
  // 이전 지시문의 존댓말 관찰 예시는 없어야 한다
  assert.doesNotMatch(prompt, /사진 속 ~가 보여요/);
  assert.doesNotMatch(prompt, /적혀 있어요/);
  assert.match(prompt, /간판에는 ~라고 적혀 있다/);
});

test("구조 검사: 정상이면 문제 없음", () => {
  assert.deepEqual(findStructureProblems(draft([["1", "2"], ["3"], ["4"]]), 4), []);
});

test("구조 검사: 누락, 중복, 순서, 비연속 그룹, 없는 번호, 제목 수", () => {
  assert.match(findStructureProblems(draft([["1", "2"], ["3"]]), 4).join(), /빠진 사진 번호: 4/);
  assert.match(findStructureProblems(draft([["1", "2"], ["2", "3", "4"]]), 4).join(), /중복된 사진 번호: 2/);
  assert.match(findStructureProblems(draft([["1"], ["3"], ["2"], ["4"]]), 4).join(), /사진 순서가 바뀜/);
  assert.match(findStructureProblems(draft([["1", "3"], ["2", "4"]]), 4).join(), /연속된 번호가 아님/);
  assert.match(findStructureProblems(draft([["1", "2", "3", "4", "9"]]), 4).join(), /없는 사진 번호: 9/);
  assert.match(findStructureProblems(draft([["1", "2", "3", "4"]], { titleCandidates: ["하나"] }), 4).join(), /정확히 3개가 아님/);
  assert.match(findStructureProblems({ nope: true }, 4).join(), /blocks가 배열이 아님/);
});

test("정리: 번호를 photoId로, [확인 필요]를 목록에 동기화, 해시태그 보정", () => {
  const raw = draft([["1", "2"], ["3", "4"]]);
  raw.blocks[2].text = "사진 속 [확인 필요: 식당 이름] 앞에 줄이 있어요. [확인 필요 : 대기 시간]";
  const { draft: final, validation } = finalizeDraft({ ...raw, confirmNeeded: ["식당 이름"] }, input.photos, null);
  assert.deepEqual(final.blocks.filter((b) => b.type === "imageGroup").map((b) => b.photoIds), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(final.confirmNeeded, ["식당 이름", "대기 시간"]);
  assert.deepEqual(final.hashtags, ["#군산", "#여행"]);
  assert.equal(validation.find((v) => v.label === "확인 필요 동기화")!.status, "WARN");
});

test("정리: 불확실 항목이 있는데 확인 필요가 비면 경고만 (자동으로 채우지 않음)", () => {
  const { draft: final, validation } = finalizeDraft(draft([["1", "2", "3", "4"]]), input.photos, ["빠진 사진 번호: 4"]);
  assert.deepEqual(final.confirmNeeded, []);
  assert.equal(validation.find((v) => v.label === "불확실 항목")!.status, "WARN");
  assert.equal(validation.find((v) => v.label === "자동 구조 수정")!.status, "WARN");
});

test("확인 필요 표시 찾기", () => {
  assert.deepEqual(extractConfirmMarkers(["[확인 필요: 가격] 그리고 [확인필요:주차]", "[확인 필요: 가격]"]), ["가격", "주차"]);
});

test("생성 요청 검사: 분석 없는 사진, 중복, postOrder 정렬", () => {
  const body = { provider: "codex", category: "TRAVEL", memo: "m", photos: [photo("b", 5), photo("a", 1)] };
  assert.deepEqual(parseGenerateBody(body).input.photos.map((p) => p.photoId), ["a", "b"]);
  assert.throws(() => parseGenerateBody({ ...body, photos: [{ photoId: "a", postOrder: 0 }] }), /분석 결과가 없습니다/);
  assert.throws(() => parseGenerateBody({ ...body, photos: [photo("a", 0), photo("a", 1)] }), /중복/);
  assert.throws(() => parseGenerateBody({ ...body, provider: "gemini" }), /provider/);
});
