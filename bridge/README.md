# Windows 로컬 브리지

Android 앱의 요청을 받아, 이 PC에 로그인된 **Claude 구독**(Agent SDK) 또는 **ChatGPT 구독**(Codex SDK)으로 처리합니다.
API 키와 클라우드 서버는 쓰지 않습니다.

```
휴대폰 ─HTTPS(Tailscale 내부)─▶ tailscale serve ─▶ 127.0.0.1:8787 브리지 ─▶ Claude / Codex (구독 로그인)
```

## 과금 안전장치
- API 키 관련 환경변수(`ANTHROPIC_*`, `OPENAI_*`, `CODEX_*`, `CLAUDE_*`)와 브리지 토큰은 AI 프로세스에 전달하지 않습니다.
- 로그인은 브리지 전용 폴더(`bridge/.auth/`)에만 있습니다. 평소 쓰는 Claude Code/Codex, PoC 로그인과 분리됩니다.
- Codex는 `forced_login_method = "chatgpt"`로 API 키 로그인을 막습니다.
- 모델을 호출하기 전에 확인하고, 아래 경우에는 호출하지 않습니다.
  - API 키 인증이 감지됨 → `API_KEY_BLOCKED`
  - 구독 외 과금 가능성(Claude 초과 사용 켜짐, ChatGPT 크레딧 잔액 있음 또는 일반 사용 불가) → `BILLING_RISK`
  - 사용량 한도 도달 → `USAGE_LIMIT`
- Claude의 사전 사용량 확인은 Agent SDK의 **실험적** API를 씁니다. 응답이 없으면 `billingCheck: unknown`으로 표시하고,
  생성 중에 초과 사용 전환이 감지되면 즉시 중단합니다(2단계부터).

## 처음 한 번
```powershell
cd C:\Users\minheekim\naver-blog-writer\bridge
npm.cmd install
npm.cmd run setup-token      # 토큰을 만들어 bridge\.env 와 android\local.properties 에 넣음 (값은 출력 안 함)
npm.cmd run login:claude     # Claude 구독 계정 로그인 → 끝나면 /exit
npm.cmd run login:codex      # ChatGPT 계정 로그인
npm.cmd run status           # 두 Provider 상태 확인 (모델 호출 없음)
tailscale serve --bg 8787    # 휴대폰에서 https://<PC이름>.<tailnet>.ts.net 으로 접속 가능하게 (Funnel 아님)
```
`tailscale serve`는 설정이 유지되므로 한 번만 하면 됩니다. 확인: `tailscale serve status`, 해제: `tailscale serve reset`.

## 쓸 때마다
```powershell
cd C:\Users\minheekim\naver-blog-writer\bridge
npm.cmd start                # Ctrl+C로 종료
```

## 설정 (`bridge/.env`, git 제외)
| 항목 | 기본값 | 설명 |
|---|---|---|
| `BRIDGE_PORT` | 8787 | 브리지 포트. 주소는 항상 127.0.0.1 |
| `BRIDGE_APP_TOKEN` | (setup-token이 생성) | 앱 접근 토큰. `npm run setup-token -- --rotate`로 교체 |
| `CLAUDE_ANALYSIS_MODEL` / `CLAUDE_WRITING_MODEL` | sonnet / opus | Claude 사진 분석 / 원고 작성 모델 |
| `CODEX_ANALYSIS_MODEL` / `CODEX_WRITING_MODEL` | (비움 = 구독 기본) | GPT 사진 분석 / 원고 작성 모델 |

## API
| 경로 | 설명 |
|---|---|
| `GET /v1/status` | 두 Provider의 로그인, 과금 안전, 사용량 상태. 30초 캐시, `?refresh=1`로 새로 확인. 모델 호출 없음 |

모든 요청에 `Authorization: Bearer <BRIDGE_APP_TOKEN>`이 필요합니다. 로그에는 경로, 상태 코드, 시간만 남깁니다.

## 개발
```powershell
npm.cmd run typecheck
npm.cmd test
```
