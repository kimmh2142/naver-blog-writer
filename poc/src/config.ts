import { readFileSync } from "node:fs";
import { paths } from "./paths.js";

export type PocConfig = {
  timeoutMs: number;
  claude: { model: string | null; effort: "low" | "medium" | "high" | "xhigh" | "max" | null; maxTurns: number };
  codex: { model: string | null; reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null };
};

export function loadConfig(): PocConfig {
  return JSON.parse(readFileSync(paths.config, "utf8")) as PocConfig;
}
