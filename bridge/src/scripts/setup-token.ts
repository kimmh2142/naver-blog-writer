import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { files } from "../paths.js";

/**
 * 앱 접근 토큰을 만들어 bridge/.env 와 android/local.properties 에 같은 값으로 넣는다.
 * 두 파일 모두 git에 올라가지 않는다. 토큰 값은 화면에 출력하지 않는다.
 * 이미 토큰이 있으면 그대로 두고 Android 쪽만 맞춘다. 새로 만들려면 --rotate.
 */
const rotate = process.argv.includes("--rotate");

function setLine(text: string, key: string, value: string, separator = "="): string {
  const line = `${key}${separator}${value}`;
  const pattern = new RegExp(`^${key.replace(/\./g, "\\.")}\\s*${separator}.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
}

function readKey(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim() || null;
}

// 1) bridge/.env
if (!existsSync(files.env)) copyFileSync(files.envExample, files.env);
let envText = readFileSync(files.env, "utf8");
let token = readKey(envText, "BRIDGE_APP_TOKEN");
if (!token || rotate) {
  token = randomBytes(32).toString("base64url");
  envText = setLine(envText, "BRIDGE_APP_TOKEN", token);
  writeFileSync(files.env, envText);
  console.log(`${rotate ? "새 토큰" : "토큰"}을 만들어 bridge/.env 에 저장했습니다.`);
} else {
  console.log("bridge/.env 에 있는 기존 토큰을 사용합니다.");
}

// 2) 휴대폰에서 접속할 주소: 이 PC의 Tailscale 이름 (tailscale serve의 HTTPS 주소)
let bridgeUrl: string | null = null;
try {
  const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" }));
  const dnsName: string | undefined = status?.Self?.DNSName;
  if (dnsName) bridgeUrl = `https://${dnsName.replace(/\.$/, "")}`;
} catch {
  bridgeUrl = null;
}

// 3) android/local.properties
if (!existsSync(files.androidLocalProperties)) {
  console.error(`Android 설정 파일이 없습니다: ${files.androidLocalProperties}`);
  process.exit(1);
}
let props = readFileSync(files.androidLocalProperties, "utf8");
props = setLine(props, "blogwriter.bridgeToken", token);
if (bridgeUrl) props = setLine(props, "blogwriter.bridgeUrl", bridgeUrl);
writeFileSync(files.androidLocalProperties, props);

console.log("android/local.properties 에 토큰을 넣었습니다 (값은 출력하지 않음).");
console.log(
  bridgeUrl
    ? `브리지 주소도 넣었습니다: ${bridgeUrl}`
    : "Tailscale 주소를 찾지 못했습니다. Tailscale 로그인 후 다시 실행하거나, local.properties에 blogwriter.bridgeUrl=https://<PC이름>.<tailnet>.ts.net 을 직접 적으세요.",
);
console.log("토큰이나 주소를 바꿨다면 Android 앱을 다시 빌드해 설치하세요.");
