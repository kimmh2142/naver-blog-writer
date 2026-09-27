# Claude vs Codex 블로그 초안 비교 PoC

같은 입력(사진 약 10장 + 메모 + 문체 지시 + 같은 지시문 + 같은 JSON 스키마)으로
**Claude(구독 로그인, Agent SDK)**와 **Codex(ChatGPT 로그인, Codex SDK)**를 실행해 결과를 비교합니다.
먼저 각 1회씩 비교하고, 둘 다 유효한 후보일 때만 추가로 2회씩 더 실행합니다.

Phase 2 구현과 무관한 독립 실험입니다. Android 앱, Cloud Run, API 키를 쓰지 않습니다.

## 과금 안전장치

| | Claude | Codex |
|---|---|---|
| 환경변수 | `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*`, `CODEX_*` 등을 자식 프로세스에서 제거 | 같음 |
| 전용 폴더 | `poc/.auth/claude` (`CLAUDE_CONFIG_DIR`) — 평소 `~/.claude` 로그인과 분리 | `poc/.auth/codex` (`CODEX_HOME`) — 평소 `~/.codex`와 분리 |
| 로그인 제한 | 전용 설정에 `apiKeyHelper` 등이 있으면 실행 거부 | `config.toml`에 `forced_login_method = "chatgpt"` (API 키 로그인이면 Codex가 스스로 로그아웃·종료) |
| 실행 전 확인 | 모델 호출 없는 점검 명령으로 `apiKeySource`를 확인. `"none"`이 아니면 중단 | `auth.json`이 ChatGPT 방식인지 + app-server `account/read`가 `chatgpt`인지 확인 |
| 실행 중 확인 | 본 실행의 init 메시지에서 다시 `apiKeySource` 확인, 아니면 즉시 중단 | 실행 후 계정 유형 재확인 |

안전장치가 작동하면 그 즉시 전체 실행을 멈추고 종료 코드 3으로 끝납니다.
에이전트는 도구 없이(Claude) 또는 읽기 전용·네트워크 차단(Codex)으로, 빈 작업 폴더에서 실행됩니다.

## 준비 (한 번만)

```bash
cd poc
npm install
npm run login:claude     # Claude Pro/Max 구독 계정으로 로그인 (Console/API 계정 고르지 말 것) → 끝나면 /exit
npm run login:codex      # ChatGPT 계정으로 로그인 (브라우저가 안 열리면: npm run login:codex -- --device-auth)
npm run check-auth       # 두 Provider 모두 API 키 없이 구독 로그인인지 확인 (모델 호출 없음)
```

## 입력 넣기

아래 폴더와 파일은 `.gitignore`에 들어 있어 git에 올라가지 않습니다.

1. **사진**: `poc/samples/originals/` 에 약 10장
   - **파일 이름 순서가 포스팅 순서**입니다. 예: `01.jpg`, `02.jpg`, … `10.jpg`
   - JPEG/PNG/WebP/GIF(첫 프레임). HEIC는 이 PC에서 안 될 수 있으니 JPEG로 내보내 주세요.
2. **메모**: `poc/samples/memo.txt` — 실제 경험 (`templates/memo.example.txt` 참고)
3. **문체**: `poc/samples/style.txt` — 내 말투 지시 (`templates/style.example.txt` 참고)

```bash
npm run prepare-photos   # Android와 같은 규칙으로 변환: 긴 변 1280px, JPEG 80, EXIF/GPS 제거 → samples/prepared/p01.jpg…
```

## 실행

```bash
npm run run                              # 첫 비교: Claude 1회 + Codex 1회 (같은 입력)
npm run run -- --runs 2                  # 둘 다 유효한 후보일 때만: 추가로 각 2회
npm run run -- --provider claude         # 한쪽만 1회
```

한 회차는 최대 10분(`config.json`의 `timeoutMs`)에서 끊깁니다.
모델은 억지로 같은 급으로 맞추지 않고, 각 구독에서 개인용 앱에 계속 쓸 현실적인 모델을 씁니다
(기본: Claude `opus` = Phase 2 설계의 원고 작성 모델, Codex = 요금제 기본 모델). `config.json`에서 바꿀 수 있고, 실제 사용된 모델은 결과에 기록됩니다.

## 결과 (`poc/out/<실행시각>/`)

| 파일 | 내용 |
|---|---|
| `summary.md` | 회차별 성공, 스키마 통과, 제목 3개, 사진 10장 인식, 순서 보존, 시간, 재시도, 구독 사용량 변화, 오류 |
| `evaluation.md` | 직접 채울 평가표: 글 품질, 내 말투 반영, 사진-글 연결, 지어낸 사실, 수정 없이 사용 가능(%) |
| `<provider>-run<N>.md` | 읽기 쉬운 원고 미리보기 (사진 위치 📷 표시, AI가 본 사진 설명 포함) |
| `<provider>-run<N>.json` | 전체 기록 (원본 응답, 토큰, 인증 정보, 재시도 메모) |
| `prompt.txt`, `photos.json` | 두 Provider에 똑같이 보낸 지시문과 사진 목록 |

### 측정 방식 메모
- **사진 인식**: `photos`에 p01~p10이 빠짐없이, 설명과 함께 있는지
- **순서 보존**: `imageGroup`의 사진을 차례로 펼쳤을 때 p01~p10과 정확히 같은지 (빠짐·중복·순서 바뀜을 구분해 표시)
- **구독 사용량**: Codex는 실행 전후 app-server `account/rateLimits/read` 값을 비교합니다.
  Claude는 SDK가 실행 전후 사용량을 알려주지 않아 실행 중 `rate_limit_event`만 기록합니다.
  정확한 비교가 필요하면 실행 전후로 claude.ai 설정 > 사용량 화면을 직접 확인해 주세요.
- **재시도**: PoC 코드는 자동 재시도를 하지 않습니다. Claude는 SDK의 `api_retry` 이벤트 수를, Codex는 오류 item을 기록합니다.
- Claude 기록의 `estimatedCostUsdNotBilled`는 Claude Code가 계산한 추정치이며, 구독 인증에서는 실제 청구액이 아닙니다.

## 개발용

```bash
npm run typecheck
npm test                 # 안전장치와 결과 검사 로직 단위 테스트 (모델 호출 없음)
```
