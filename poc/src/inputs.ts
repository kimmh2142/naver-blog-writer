import { existsSync, readFileSync } from "node:fs";
import { paths } from "./paths.js";

export type PreparedPhoto = {
  photoId: string;
  file: string;
  sourceName: string;
  width: number;
  height: number;
  bytes: number;
};

export type PocInputs = {
  photos: PreparedPhoto[];
  memo: string;
  style: string;
  prompt: string;
  schema: Record<string, unknown>;
};

export class MissingInputError extends Error {}

/** 사진 순서대로 p01, p02 … 를 붙인다. */
export function photoIdFor(index: number): string {
  return `p${String(index + 1).padStart(2, "0")}`;
}

export function buildPrompt(template: string, photoIds: string[], memo: string, style: string): string {
  return template
    .replaceAll("{{PHOTO_COUNT}}", String(photoIds.length))
    .replaceAll("{{PHOTO_IDS}}", photoIds.join(", "))
    .replaceAll("{{FIRST_ID}}", photoIds[0] ?? "")
    .replaceAll("{{MEMO}}", memo.trim())
    .replaceAll("{{STYLE}}", style.trim());
}

/** 실행 전에 입력이 모두 준비됐는지 확인하고 읽는다. 빠진 것이 있으면 무엇을 해야 하는지 알려준다. */
export function loadInputs(): PocInputs {
  const problems: string[] = [];
  if (!existsSync(paths.preparedManifest)) {
    problems.push(
      `사진이 준비되지 않았습니다. ${paths.originals} 에 사진을 넣고 \`npm run prepare-photos\`를 실행하세요.`,
    );
  }
  const memo = existsSync(paths.memo) ? readFileSync(paths.memo, "utf8") : "";
  const style = existsSync(paths.style) ? readFileSync(paths.style, "utf8") : "";
  if (!memo.trim()) problems.push(`메모가 비어 있습니다: ${paths.memo}`);
  if (!style.trim()) problems.push(`문체 지시가 비어 있습니다: ${paths.style}`);
  if (problems.length > 0) throw new MissingInputError(problems.join("\n"));

  const photos = JSON.parse(readFileSync(paths.preparedManifest, "utf8")) as PreparedPhoto[];
  for (const photo of photos) {
    if (!existsSync(photo.file)) throw new MissingInputError(`준비된 사진 파일이 없습니다: ${photo.file}. prepare-photos를 다시 실행하세요.`);
  }
  const template = readFileSync(paths.instructions, "utf8");
  return {
    photos,
    memo,
    style,
    prompt: buildPrompt(template, photos.map((p) => p.photoId), memo, style),
    schema: JSON.parse(readFileSync(paths.schema, "utf8")),
  };
}
