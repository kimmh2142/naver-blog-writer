import path from "node:path";
import { fileURLToPath } from "node:url";

export const BRIDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type BridgeDirs = {
  /** 브리지 전용 Claude 로그인/설정 폴더. 평소 쓰는 ~/.claude와 분리한다. */
  claudeConfigDir: string;
  /** 브리지 전용 Codex 로그인/설정 폴더. 평소 쓰는 ~/.codex와 분리한다. */
  codexHome: string;
  /** 에이전트가 실행되는 빈 작업 폴더와 요청별 임시 파일 */
  workDir: string;
};

export const dirs: BridgeDirs = {
  claudeConfigDir: path.join(BRIDGE_ROOT, ".auth", "claude"),
  codexHome: path.join(BRIDGE_ROOT, ".auth", "codex"),
  workDir: path.join(BRIDGE_ROOT, ".work"),
};

export const files = {
  env: path.join(BRIDGE_ROOT, ".env"),
  envExample: path.join(BRIDGE_ROOT, ".env.example"),
  androidLocalProperties: path.join(BRIDGE_ROOT, "..", "android", "local.properties"),
};
