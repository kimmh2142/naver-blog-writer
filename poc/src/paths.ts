import path from "node:path";
import { fileURLToPath } from "node:url";

export const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const at = (...parts: string[]) => path.join(POC_ROOT, ...parts);

export const paths = {
  // 사용자가 직접 넣는 입력 (git 제외)
  originals: at("samples", "originals"),
  prepared: at("samples", "prepared"),
  preparedManifest: at("samples", "prepared", "manifest.json"),
  memo: at("samples", "memo.txt"),
  style: at("samples", "style.txt"),

  // 결과 (git 제외)
  out: at("out"),

  // Provider 전용 인증/설정 폴더 (git 제외). 평소 쓰는 ~/.claude, ~/.codex 와 분리한다.
  claudeConfigDir: at(".auth", "claude"),
  codexHome: at(".auth", "codex"),

  // 에이전트가 실행되는 빈 작업 폴더 (git 제외)
  claudeWorkDir: at(".work", "claude"),
  codexWorkDir: at(".work", "codex"),

  // 두 Provider가 똑같이 쓰는 지시문과 스키마
  instructions: at("prompt", "instructions.md"),
  schema: at("schema", "draft.schema.json"),
  config: at("config.json"),
};
