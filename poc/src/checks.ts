import { Ajv } from "ajv";

export type Draft = {
  photos: { photoId: string; description: string }[];
  titles: string[];
  blocks: { type: "heading" | "paragraph" | "imageGroup"; text: string; photoIds: string[] }[];
  hashtags: string[];
  confirmNeeded: string[];
};

export type DraftChecks = {
  parsed: boolean;
  schemaValid: boolean;
  schemaErrors: string[];
  titlesCount: number;
  /** photos[]에 10장 모두 설명이 있는가 */
  allPhotosRecognized: boolean;
  missingPhotoIds: string[];
  unexpectedPhotoIds: string[];
  emptyDescriptions: string[];
  /** imageGroup을 순서대로 펼친 결과가 입력 순서와 정확히 같은가 (누락·중복·순서 바뀜 없음) */
  orderPreserved: boolean;
  groupedPhotoIds: string[];
  orderProblem: string | null;
  imageGroupCount: number;
  textBlockCount: number;
  bodyChars: number;
  bodyCharsNoSpaces: number;
};

/** 모델 출력(객체 또는 JSON 문자열)을 객체로 바꾼다. */
export function parseDraft(output: unknown): unknown | null {
  if (output === null || output === undefined) return null;
  if (typeof output === "object") return output;
  if (typeof output !== "string") return null;
  const text = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function checkDraft(output: unknown, expectedIds: string[], schema: object): DraftChecks {
  const draft = parseDraft(output);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const schemaValid = draft !== null && validate(draft) === true;
  const schemaErrors = draft === null
    ? ["JSON으로 해석할 수 없음"]
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());

  const d = (schemaValid ? draft : {}) as Partial<Draft>;
  const photos = Array.isArray(d.photos) ? d.photos : [];
  const blocks = Array.isArray(d.blocks) ? d.blocks : [];

  const described = new Set(photos.filter((p) => p.description?.trim()).map((p) => p.photoId));
  const listed = photos.map((p) => p.photoId);
  const missingPhotoIds = expectedIds.filter((id) => !listed.includes(id));
  const unexpectedPhotoIds = [...new Set(listed.filter((id) => !expectedIds.includes(id)))];
  const emptyDescriptions = listed.filter((id) => expectedIds.includes(id) && !described.has(id));

  const groupedPhotoIds = blocks.filter((b) => b.type === "imageGroup").flatMap((b) => b.photoIds ?? []);
  const orderProblem = describeOrderProblem(groupedPhotoIds, expectedIds);

  const text = blocks.filter((b) => b.type !== "imageGroup").map((b) => b.text ?? "").join("\n");

  return {
    parsed: draft !== null,
    schemaValid,
    schemaErrors,
    titlesCount: Array.isArray(d.titles) ? d.titles.length : 0,
    allPhotosRecognized: schemaValid && missingPhotoIds.length === 0 && unexpectedPhotoIds.length === 0 && emptyDescriptions.length === 0,
    missingPhotoIds,
    unexpectedPhotoIds,
    emptyDescriptions,
    orderPreserved: schemaValid && orderProblem === null,
    groupedPhotoIds,
    orderProblem,
    imageGroupCount: blocks.filter((b) => b.type === "imageGroup").length,
    textBlockCount: blocks.filter((b) => b.type !== "imageGroup").length,
    bodyChars: text.length,
    bodyCharsNoSpaces: text.replace(/\s/g, "").length,
  };
}

export function describeOrderProblem(grouped: string[], expected: string[]): string | null {
  const missing = expected.filter((id) => !grouped.includes(id));
  const duplicated = [...new Set(grouped.filter((id, i) => grouped.indexOf(id) !== i))];
  const unknown = [...new Set(grouped.filter((id) => !expected.includes(id)))];
  const problems: string[] = [];
  if (missing.length) problems.push(`빠짐: ${missing.join(", ")}`);
  if (duplicated.length) problems.push(`중복: ${duplicated.join(", ")}`);
  if (unknown.length) problems.push(`없는 id: ${unknown.join(", ")}`);
  if (problems.length === 0 && grouped.join(",") !== expected.join(",")) {
    problems.push(`순서 바뀜: ${grouped.join(", ")}`);
  }
  return problems.length ? problems.join(" / ") : null;
}
