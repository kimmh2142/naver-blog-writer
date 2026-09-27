import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { photoIdFor, type PreparedPhoto } from "./inputs.js";
import { paths } from "./paths.js";

/**
 * samples/originals 의 사진을 파일 이름 순서대로 읽어,
 * Android 앱의 AI용 사본과 같은 규칙(긴 변 1280px, JPEG 품질 80, 메타데이터 제거)으로
 * samples/prepared/p01.jpg … 를 만든다. 원본은 건드리지 않는다.
 */
const LONG_EDGE = 1280;
const QUALITY = 80;
const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);

mkdirSync(paths.originals, { recursive: true });
const files = readdirSync(paths.originals)
  .filter((name) => SUPPORTED.has(path.extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (files.length === 0) {
  console.error(`사진이 없습니다. ${paths.originals} 에 사진 약 10장을 넣어 주세요 (파일 이름 순서 = 포스팅 순서).`);
  process.exit(2);
}
if (files.length > 20) {
  console.error(`사진이 ${files.length}장입니다. PoC는 20장까지만 받습니다.`);
  process.exit(2);
}

rmSync(paths.prepared, { recursive: true, force: true });
mkdirSync(paths.prepared, { recursive: true });

const manifest: PreparedPhoto[] = [];
for (const [index, name] of files.entries()) {
  const photoId = photoIdFor(index);
  const out = path.join(paths.prepared, `${photoId}.jpg`);
  try {
    // rotate(): EXIF 방향대로 돌린 뒤 저장. sharp는 기본적으로 EXIF/GPS를 쓰지 않는다. GIF는 첫 프레임만 쓴다.
    const info = await sharp(path.join(paths.originals, name), { animated: false })
      .rotate()
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toFile(out);
    manifest.push({ photoId, file: out, sourceName: name, width: info.width, height: info.height, bytes: info.size });
    console.log(`${photoId} ← ${name}  (${info.width}×${info.height}, ${Math.round(info.size / 1024)}KB)`);
  } catch (e) {
    console.error(`${name} 변환 실패: ${(e as Error).message}`);
    console.error("HEIC는 이 PC에서 지원되지 않을 수 있습니다. 휴대폰에서 JPEG로 내보내거나 다른 사진으로 바꿔 주세요.");
    process.exit(1);
  }
}

writeFileSync(paths.preparedManifest, JSON.stringify(manifest, null, 2));
if (manifest.length !== 10) console.warn(`\n참고: 사진이 ${manifest.length}장입니다 (권장 약 10장).`);
console.log(`\n${manifest.length}장 준비 완료 → ${paths.prepared}`);
