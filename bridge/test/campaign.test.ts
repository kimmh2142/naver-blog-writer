import assert from "node:assert/strict";
import { test } from "node:test";
import { aiChecks, buildCampaignChecks, codeChecks, sanitizeRules } from "../src/campaign.js";
import { parseGenerateBody } from "../src/server.js";
import { buildWritingPrompt, finalizeDraft, findStructureProblems, type WritingInput, writingSchema } from "../src/writing.js";

const CAMPAIGN = [
  "[제공] 서초 돈거돈락 체험단",
  "- 제목에 '서초 돈가스' 필수",
  "- 본문에 '돈거돈락' 3회 이상 언급",
  "- 해시태그 #서초맛집 #돈거돈락 필수",
  "- 사진 15장 이상, 동영상 1개 첨부",
  "- 네이버 지도 첨부, 매장 링크 삽입",
  "- 대표 메뉴 등심카츠 맛 강조",
].join("\n");

const target = {
  titleCandidates: ["서초 돈가스 맛집 돈거돈락", "서초 돈가스 후기", "돈거돈락 방문기"],
  bodyText: "돈거돈락에 다녀왔다. 돈거돈락 외관.\n소제목\n돈거돈락 메뉴판에는 등심카츠가 적혀 있다.",
  hashtags: ["#서초맛집", "#돈가스"],
  photoCount: 12,
};

test("규칙 정리: 안내문에 실제로 적힌 문자열만 남기고, 모델이 지어낸 조건은 버린다", () => {
  const rules = sanitizeRules(
    {
      titleKeywords: ["서초 돈가스", "강남 맛집"],
      bodyKeywords: [{ keyword: "돈거돈락", minCount: 3 }, { keyword: "없는키워드", minCount: 2 }, { keyword: "등심카츠", minCount: 0 }],
      requiredHashtags: ["#서초맛집", "돈거돈락", "#지어낸태그"],
      minPhotos: 15,
    },
    CAMPAIGN,
  );
  assert.deepEqual(rules.titleKeywords, ["서초 돈가스"]);
  assert.deepEqual(rules.bodyKeywords, [{ keyword: "돈거돈락", minCount: 3 }, { keyword: "등심카츠", minCount: 1 }]);
  assert.deepEqual(rules.requiredHashtags, ["서초맛집", "돈거돈락"]);
  assert.equal(rules.minPhotos, 15);
  assert.equal(sanitizeRules({ minPhotos: 99 }, CAMPAIGN).minPhotos, 0); // 안내문에 없는 숫자
  assert.deepEqual(sanitizeRules(null, CAMPAIGN), { titleKeywords: [], bodyKeywords: [], requiredHashtags: [], minPhotos: 0 });
});

test("코드 확인: 제목 키워드는 후보 3개 모두에 있어야 APPLIED, 일부면 어느 후보인지 알려준다", () => {
  const [partial] = codeChecks({ titleKeywords: ["서초 돈가스"], bodyKeywords: [], requiredHashtags: [], minPhotos: 0 }, target);
  assert.equal(partial.status, "UNMET");
  assert.match(partial.note, /1, 2번에만 포함/);
  const [all] = codeChecks({ titleKeywords: ["돈"], bodyKeywords: [], requiredHashtags: [], minPhotos: 0 }, target);
  assert.equal(all.status, "APPLIED");
  const [none] = codeChecks({ titleKeywords: ["강남"], bodyKeywords: [], requiredHashtags: [], minPhotos: 0 }, target);
  assert.match(none.note, /제목 후보에 없음/);
});

test("코드 확인: 본문 키워드 횟수, 해시태그, 사진 수", () => {
  const checks = codeChecks(
    { titleKeywords: [], bodyKeywords: [{ keyword: "돈거돈락", minCount: 3 }, { keyword: "돈거돈락", minCount: 4 }], requiredHashtags: ["서초맛집", "돈거돈락"], minPhotos: 15 },
    target,
  );
  assert.deepEqual(checks.map((c) => [c.requirement, c.status]), [
    ['본문에 "돈거돈락" 3회 이상', "APPLIED"],
    ['본문에 "돈거돈락" 4회 이상', "UNMET"],
    ["해시태그 #서초맛집", "APPLIED"],
    ["해시태그 #돈거돈락", "UNMET"],
    ["사진 15장 이상", "UNMET"],
  ]);
  assert.equal(checks[1].note, "본문 3회 (필요 4회)");
  assert.match(checks[4].note, /12장 \(필요 15장\)/);
  assert.ok(checks.every((c) => c.checkedBy === "code"));
});

test("AI 판단: 텍스트로 끝낼 수 없는 작업을 '처리함'이라고 하면 사용자 직접 항목으로 바꾼다", () => {
  const checks = aiChecks([
    { requirement: "동영상 1개 첨부", status: "APPLIED", note: "" },
    { requirement: "네이버 지도 첨부", status: "APPLIED", note: "" },
    { requirement: "매장 링크 삽입", status: "MANUAL", note: "에디터에서 링크 추가" },
    { requirement: "대표 메뉴 등심카츠 맛 강조", status: "NEEDS_CONFIRMATION", note: "메모에 맛 평가 없음" },
    { requirement: "메뉴 이름 언급", status: "APPLIED", note: "메뉴판 글자로 반영" },
    { requirement: "  ", status: "APPLIED", note: "" },
    { requirement: "이상한 상태", status: "DONE", note: "" },
  ]);
  assert.deepEqual(checks.map((c) => [c.requirement, c.status]), [
    ["동영상 1개 첨부", "MANUAL"],
    ["네이버 지도 첨부", "MANUAL"],
    ["매장 링크 삽입", "MANUAL"],
    ["대표 메뉴 등심카츠 맛 강조", "NEEDS_CONFIRMATION"],
    ["메뉴 이름 언급", "APPLIED"],
    ["이상한 상태", "NEEDS_CONFIRMATION"],
  ]);
  assert.match(checks[0].note, /직접 추가/);
});

test("체크리스트: 체험단이 아니면 비어 있고, 체험단인데 확인한 게 없으면 안내 항목 하나", () => {
  assert.deepEqual(buildCampaignChecks({ campaignChecks: [{ requirement: "x", status: "APPLIED", note: "" }] }, null, target), []);
  const fallback = buildCampaignChecks({}, "자유롭게 작성해 주세요", target);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].status, "MANUAL");
});

// ---- 작성 지시문과 결과 정리에 들어가는 부분 ----

const photo = (id: string, order: number) => ({
  photoId: id,
  postOrder: order,
  analysis: { type: "food" as const, description: `설명 ${id}`, visibleText: "", tags: [], uncertain: [] },
});
const input: WritingInput = {
  category: "RESTAURANT",
  subjectName: "돈거돈락",
  memo: "등심카츠 먹음. 바삭했음",
  style: {},
  photos: [photo("a", 0), photo("b", 1)],
  campaignText: CAMPAIGN,
};

test("지시문: 체험단 요구사항이 별도 출처로 들어가고, 사실 규칙보다 뒤에 온다", () => {
  const prompt = buildWritingPrompt(input);
  assert.match(prompt, /\[체험단 요구사항\] — 체험단 운영자가 준 작성 조건\. 사용자의 경험이나 사실의 근거가 아니다\./);
  assert.ok(prompt.includes(CAMPAIGN));
  assert.match(prompt, /사실 규칙 > 체험단 요구사항 > 사용자 문체 설정 > 기본 문체/);
  assert.match(prompt, /\[사용자 메모\]에 근거가 없으면 1인칭 사실로 쓰지 않는다/);
  assert.match(prompt, /동영상·GIF 첨부, 지도·네이버 플레이스 첨부/);
  assert.match(prompt, /campaignChecks: campaignRules에 넣은 조건을 뺀 나머지/);

  const plain = buildWritingPrompt({ ...input, campaignText: null });
  assert.doesNotMatch(plain, /\[체험단 요구사항\]/);
  assert.doesNotMatch(plain, /체험단 요구사항 반영 규칙/);
  assert.match(plain, /사실 규칙 > 사용자 문체 설정 > 기본 문체/);
  assert.match(plain, /체험단 글이 아니므로/);
});

test("스키마: 체험단 필드가 필수이고 모델이 쓸 수 있는 상태는 3개 (UNMET은 코드 전용)", () => {
  assert.ok(writingSchema.required.includes("campaignRules"));
  assert.ok(writingSchema.required.includes("campaignChecks"));
  assert.deepEqual(writingSchema.properties.campaignChecks.items.properties.status.enum, ["APPLIED", "MANUAL", "NEEDS_CONFIRMATION"]);
});

const output = {
  titleCandidates: ["서초 돈가스 돈거돈락", "서초 돈가스 후기", "서초 돈가스 맛집"],
  blocks: [
    { type: "imageGroup", text: "", photoRefs: ["1", "2"] },
    { type: "paragraph", text: "돈거돈락에서 등심카츠를 먹었다. 돈거돈락 튀김옷이 바삭했다. 돈거돈락 [확인 필요: 가격]", photoRefs: [] },
  ],
  hashtags: ["서초맛집", "#돈거돈락"],
  confirmNeeded: [],
  campaignRules: { titleKeywords: ["서초 돈가스"], bodyKeywords: [{ keyword: "돈거돈락", minCount: 3 }], requiredHashtags: ["서초맛집", "돈거돈락"], minPhotos: 15 },
  campaignChecks: [
    { requirement: "동영상 1개 첨부", status: "MANUAL", note: "게시할 때 직접 첨부" },
    { requirement: "대표 메뉴 등심카츠 맛 강조", status: "APPLIED", note: "메모의 '바삭했음'만 반영" },
  ],
};

test("결과 정리: 체험단 체크리스트를 만들고, 채우지 못한 조건은 검사 목록에도 경고", () => {
  assert.deepEqual(findStructureProblems(output, 2), []);
  const { draft, validation } = finalizeDraft(output, input.photos, null, CAMPAIGN);
  assert.equal(draft.isCampaign, true);
  assert.deepEqual(draft.campaignChecks.map((c) => [c.requirement, c.status, c.checkedBy]), [
    ['제목에 "서초 돈가스" 포함', "APPLIED", "code"],
    ['본문에 "돈거돈락" 3회 이상', "APPLIED", "code"],
    ["해시태그 #서초맛집", "APPLIED", "code"],
    ["해시태그 #돈거돈락", "APPLIED", "code"],
    ["사진 15장 이상", "UNMET", "code"],
    ["동영상 1개 첨부", "MANUAL", "ai"],
    ["대표 메뉴 등심카츠 맛 강조", "APPLIED", "ai"],
  ]);
  assert.deepEqual(draft.confirmNeeded, ["가격"]); // 기존 확인 필요 동기화는 그대로
  assert.equal(validation.find((v) => v.label === "체험단 조건")!.status, "WARN");
});

test("결과 정리: 체험단이 아니면 모델이 채운 체험단 필드는 버린다", () => {
  const { draft, validation } = finalizeDraft(output, input.photos, null, null);
  assert.equal(draft.isCampaign, false);
  assert.deepEqual(draft.campaignChecks, []);
  assert.equal(validation.find((v) => v.label === "체험단 조건"), undefined);
});

test("요청 검사: campaign.text가 있으면 체험단 글, 없거나 비면 일반 글", () => {
  const base = { provider: "claude", category: "RESTAURANT", memo: "m", photos: [photo("a", 0)] };
  assert.equal(parseGenerateBody({ ...base, campaign: { text: " 조건 " } }).input.campaignText, "조건");
  assert.equal(parseGenerateBody({ ...base, campaign: { text: "   " } }).input.campaignText, null);
  assert.equal(parseGenerateBody(base).input.campaignText, null);
  assert.equal(parseGenerateBody({ ...base, campaign: { text: "가".repeat(7000) } }).input.campaignText!.length, 6000);
});
