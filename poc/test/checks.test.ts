import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkDraft, describeOrderProblem } from "../src/checks.js";
import { buildPrompt, photoIdFor } from "../src/inputs.js";
import { paths } from "../src/paths.js";

const schema = JSON.parse(readFileSync(paths.schema, "utf8"));
const ids = ["p01", "p02", "p03", "p04"];

function draft(groups: string[][]) {
  return {
    photos: ids.map((id) => ({ photoId: id, description: `${id} 설명` })),
    titles: ["제목1", "제목2", "제목3"],
    blocks: groups.flatMap((g) => [
      { type: "imageGroup", text: "", photoIds: g },
      { type: "paragraph", text: "본문 문단", photoIds: [] },
    ]),
    hashtags: ["#맛집"],
    confirmNeeded: [],
  };
}

test("모든 사진이 순서대로 한 번씩 들어가면 통과", () => {
  const c = checkDraft(draft([["p01", "p02"], ["p03"], ["p04"]]), ids, schema);
  assert.equal(c.schemaValid, true);
  assert.equal(c.allPhotosRecognized, true);
  assert.equal(c.orderPreserved, true);
  assert.equal(c.titlesCount, 3);
  assert.equal(c.imageGroupCount, 3);
});

test("JSON 문자열 응답과 코드펜스도 해석한다", () => {
  const text = "```json\n" + JSON.stringify(draft([["p01", "p02", "p03", "p04"]])) + "\n```";
  assert.equal(checkDraft(text, ids, schema).orderPreserved, true);
});

test("순서 바뀜, 누락, 중복을 구분해 알려준다", () => {
  assert.match(describeOrderProblem(["p02", "p01", "p03", "p04"], ids)!, /순서 바뀜/);
  assert.match(describeOrderProblem(["p01", "p02", "p03"], ids)!, /빠짐: p04/);
  assert.match(describeOrderProblem(["p01", "p01", "p02", "p03", "p04"], ids)!, /중복: p01/);
  assert.equal(checkDraft(draft([["p02", "p01"], ["p03", "p04"]]), ids, schema).orderPreserved, false);
});

test("사진 설명이 빠지면 인식 실패로 본다", () => {
  const d = draft([["p01", "p02", "p03", "p04"]]);
  d.photos = d.photos.slice(0, 3);
  const c = checkDraft(d, ids, schema);
  assert.equal(c.allPhotosRecognized, false);
  assert.deepEqual(c.missingPhotoIds, ["p04"]);
});

test("스키마에 없는 필드나 잘못된 block type은 스키마 실패", () => {
  const extra = { ...draft([ids]), extra: 1 };
  assert.equal(checkDraft(extra, ids, schema).schemaValid, false);
  const badType = draft([ids]);
  (badType.blocks[0] as any).type = "image";
  assert.equal(checkDraft(badType, ids, schema).schemaValid, false);
  assert.equal(checkDraft("not json", ids, schema).parsed, false);
});

test("photoId와 지시문 치환", () => {
  assert.equal(photoIdFor(0), "p01");
  assert.equal(photoIdFor(9), "p10");
  const prompt = buildPrompt(readFileSync(paths.instructions, "utf8"), ["p01", "p02"], "메모 내용", "문체 내용");
  assert.doesNotMatch(prompt, /\{\{/);
  assert.match(prompt, /p01, p02/);
  assert.match(prompt, /메모 내용/);
  assert.match(prompt, /문체 내용/);
});
