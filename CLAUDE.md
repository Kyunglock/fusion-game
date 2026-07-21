# Party Games — 프로젝트 개요

## 기술 스택
- **백엔드**: Node.js + Express + Socket.IO
- **프론트엔드**: Vanilla JS (ES Modules), SCSS → CSS 빌드 (`npm run build:css`)
- **뷰 엔진**: Pug (게임 페이지를 서버사이드 렌더링)
- 사용자 정보(닉네임/아바타)는 DB 없이 express-session에만 저장 (서버 재시작 시 초기화됨)

## Socket.IO 네임스페이스
| 네임스페이스 | 게임 | 방 목록 이벤트 |
|---|---|---|
| `/` (default) | 악어 이빨 뽑기 | `rooms_update` |
| `/bomb` | 폭탄 돌리기 | `bomb_rooms_update` |
| `/tetris` | 테트리스 | `tetris_rooms_update` |
| `/jamo` | 자모 워들 | `jamo_rooms_update` |

## 파일 구조
```
src/
  config.js              ← 게임별 설정 상수 (인원 제한, 타이머 등)
  routes/
    auth.js              ← /api/auth, /api/me, /api/me/username, /api/me/avatar (세션 기반)
  shared/
    roomManager.js       ← 범용 방 관리 팩토리 (createRoomManager)
    socketHandlers.js    ← 공통 소켓 핸들러 등록 (registerCommonHandlers)
  game/{crocodile,bomb,tetris,jamo}/
    rooms.js             ← createRoomManager() 호출 + 게임별 설정/함수
    socket.js            ← registerCommonHandlers() + 게임 고유 핸들러만
    jamoLogic.js         ← (jamo 전용) 한글 자모 분해/판정 순수 로직 (decompose, judge, keyboardFromAttempts)

views/
  layouts/base.pug      ← 공통 HTML head, script, 채팅 포함
  mixins/
    lobby.pug           ← +lobby() 로비 화면
    waiting.pug         ← +waitingRoom() 대기실 (게임별 host 전용 UI는 block 슬롯으로 주입 가능)
    chat.pug            ← 채팅 패널 + FAB
    overlays.pug        ← +aloneOverlay(), +resultOverlay(), +spectatorGame
  pages/
    crocodile.pug       ← extends base + 게임 고유 UI
    bomb.pug
    tetris.pug
    jamo.pug             ← +waitingRoom() 블록으로 방장 제시어 입력 UI 주입

client/
  js/
    shared/
      screenManager.js  ← showScreen(), $() 헬퍼
      chatManager.js    ← 채팅 전체 (initChat, setChatVisible, appendChatMessage)
      lobbyRenderer.js  ← renderRoomList, renderSpectatorList, renderWaiting
      uiHelpers.js      ← triggerFlash, triggerShake, 카운트다운, aloneOverlay
      authCheck.js      ← /api/me 호출 + 세션 정보 표시
    index.js            ← 홈(로비 선택) 페이지 로직, 각 네임스페이스 방 개수 표시
    online-widget.js    ← 우측 하단 접속자 위젯
    crocodile.js        ← 게임 고유 로직 (이빨 렌더링, 턴 타이머)
    bomb.js             ← 게임 고유 로직 (폭탄 패스, 위험 표시)
    tetris.js           ← 테트리스 엔진 + 게임 고유 UI
    jamo.js              ← 자모 보드/키보드 렌더링, 답 제출
    utils.js            ← escHtml, showError
  partials/
    crocodile-svg.html  ← 악어 SVG (서버에서 읽어 Pug 변수로 주입)
  scss/{crocodile,bomb,tetris,jamo}.scss  ← @use 'components' 공통 임포트
  scss/_components.scss              ← 공통 UI 컴포넌트
  scss/_variables.scss
  scss/_base.scss
```

## 공통 모듈 아키텍처

### 서버: createRoomManager (src/shared/roomManager.js)
- `createRoomManager(config)` 팩토리가 rooms Map과 CRUD 함수 반환
- config로 게임별 차이를 주입:
  - `maxPlayers`, `minPlayers` — 인원 제한
  - `extraRoomFields` — 방 생성 시 추가 필드 (예: `{ trapTooth: null }`)
  - `defaultPlayerFields` — 플레이어 기본 필드 (예: `{ score: 0 }`)
  - `extraStateFields(room)` — safeState에 포함할 게임별 필드
  - `safePlayer(p)` — 플레이어 직렬화 커스텀
  - `resetGameState(room)` — 인원 부족 시 게임 상태 초기화
  - `onPlayerLeave(room, socketId)` — 이탈 시 게임별 처리 (폭탄 넘기기 등)

### 서버: registerCommonHandlers (src/shared/socketHandlers.js)
- 8개 공통 핸들러 한 번에 등록: `get_rooms`, `create_room`, `join_room`, `join_as_spectator`, `toggle_spectator_allowed`, `kick_player`, `toggle_ready`, `chat_message`
- `validateStartGame()` 유틸 반환 (게임별 socket.js에서 사용)
- opts로 차이 주입: `roomsEvent`, `spectateCheck`, `joinPlayerFields`

### 클라이언트: shared 모듈 (client/js/shared/)
- **screenManager** — `showScreen(name)`, `$()` DOM 헬퍼
- **chatManager** — `initChat(socket, myIdGetter, avatarMap)` 한 번 호출로 채팅 전체 셋업
- **lobbyRenderer** — `renderRoomList`, `renderSpectatorList`, `renderWaiting` (공통 대기실 UI)
- **uiHelpers** — `triggerFlash`, `triggerShake`, `startReturnCountdown`, `showAloneOverlay`
- **authCheck** — `checkAuth(inputName)` → Promise<{username, avatar}>

## 게임 페이지 라우팅
- `GET /crocodile` → Pug 렌더링 (`views/pages/crocodile.pug`)
- `GET /bomb` → Pug 렌더링 (`views/pages/bomb.pug`)
- `GET /tetris` → Pug 렌더링 (`views/pages/tetris.pug`)
- `GET /jamo` → Pug 렌더링 (`views/pages/jamo.pug`)
- 기존 정적 HTML 파일은 제거 가능 (Pug로 대체됨). 단, 홈(로비 선택) 페이지인 `client/index.html`은 정적 파일로 유지

## 관전 시스템
- 방 생성 시 `allowSpectators: true` 기본값
- 로비에서 방장이 토글 가능 (`toggle_spectator_allowed` 이벤트)
- 게임 중인 방에 `join_as_spectator`로 입장 → `spectate_start` 수신
- 관전자는 `spectators[]` 배열에 별도 저장 (players[]와 분리)
- CSS 클래스 `is-spectating` (악어/폭탄/자모) 또는 `spectating` (테트리스) 로 인터랙션 비활성화
- `member_joined` 이벤트 → 채팅 시스템 메시지로 표시 (`chat-system-msg`)
- 방 목록에 게임 중인 방도 표시 (관전 허용된 것만)

## 채팅
- 플레이어 + 관전자 모두 채팅 가능
- 아바타 없는 유저는 `playerAvatarEmojis` Map으로 임시 이모지 부여
  - 악어/폭탄: `['🐊','🦁','🐸','🦊']`
  - 테트리스: `['🟦','🟧','🟥','🟩']`
  - 자모 워들: `['🔤','🔡','🔠','📝']`

## 테마 (위장 테마)
- "회사에서 몰래 하는" 컨셉 — 대놓고 게임처럼 안 보이도록 여러 위장 테마를 제공한다.
- 6가지: `green`(기본 그린), `doc`(문서/워드풍 라이트), `sheet`(스프레드시트풍), `excel`(엑셀/오피스 라이트, 엑셀 그린 리본), `code`(코드 에디터 다크), `eclipse`(Eclipse IDE 라이트, 이클립스 퍼플)
- 구현: 색상은 전부 CSS 변수(`var(--x)`)로 통일. `client/scss/_variables.scss`의 `:root`가 기본(그린), `:root[data-theme='doc'|'sheet'|'code']` 블록이 팔레트를 오버라이드
  - `--green-*`는 이름은 그대로지만 각 테마의 **강조색 스케일**로 재정의됨(그린→블루 등). 채팅/서피스용으로 `--sunken`(채팅 패널·입력), `--bubble`(받은 말풍선), `--chip`(옅은 배지) 추가
  - SCSS 컴파일타임 변수(`$green-dark` 등)를 색상 위치에서 쓰면 테마가 안 먹으니 항상 `var(--x)` 사용
- 전환 UI: `client/js/shared/themeManager.js`가 우측 하단 위젯으로 주입. 선택값은 `localStorage('pg-theme')`에 저장하고 `<html data-theme>`로 적용
  - 접속자 위젯(`online-widget.js`)과 테마/투명도 위젯은 공용 도크 `#pg-dock`(우측 하단 가로 flex)에 나란히 놓여 겹치지 않는다. 두 파일 모두 `getDock()`로 도크를 생성/재사용
- **화면 투명도**: 테마 버튼 옆 슬라이더로 전체 화면(`<html>`) 투명도를 30~100%로 조절(몰래 하는 컨셉—덜 눈에 띄게). `localStorage('pg-opacity')`에 저장. 위젯을 항상 조작할 수 있도록 최소 30%로 제한
- 깜빡임 방지: `views/layouts/base.pug`와 `client/index.html`의 `<head>` 인라인 스크립트가 CSS 로드 전에 `data-theme`와 투명도를 먼저 설정
- 모든 페이지에서 `themeManager.js`와 `online-widget.js`를 로드(base.pug scripts 블록 + index.html)

## 테트리스 — 멀티플레이어 규칙
- 최소 2명, 최대 4명
- **콤보 시스템**: 연속으로 라인 클리어 시 콤보 증가, 실패 시 초기화
  - 콤보별 쓰레기 줄: 1→0, 2→1, 3→1, 4→2, 5→2, 6→3, 7→3, 8→4, 9→4, 10+→5
  - 1~2콤보: 효과 없음 (클라이언트에서 표시 없음)
  - 3콤보 이상: 보드 위 콤보 카운터 표시 (녹색→노랑→빨강)
- **홀드 (좌측 Ctrl)**: 현재 블럭을 보관, 다시 불러오기 가능 (한 블럭당 1회)
- 탈락자는 보드 페이드, 마지막 1명이 우승
- 관전자는 보드·컨트롤 숨김 (`#screen-game.spectating`)

## 자모 워들 — 게임 규칙
- 최소 2명(방장 + 참가자 1명 이상), 최대 8명
- **방장은 게임에 직접 참여하지 않고 진행만 담당한다. 방장에게는 자신의 보드/키보드/답 입력이 없다.**
- 게임 상태(`room.state`): `lobby`(대기실) → `intermission`(라운드 대기, 방장이 제시어 입력) → `playing`(라운드 진행) → 라운드 종료 시 다시 `intermission`
  - `start_game`(인자 없음): 대기실 → 게임 화면(`intermission`)으로 진입. 준비 완료 검증만 하고 제시어는 받지 않는다. 진입 시 점수/승수 초기화
  - `set_answer { answer }`: 방장이 게임 화면 안에서 제시어를 내면 `intermission` → `playing`
- 제시어를 맞혀도 대기실로 나가지 않는다. 라운드가 끝나면 `intermission`으로 돌아가 **방장이 그 방 안에서 연속으로 다음 제시어를 낸다** (점수/승수 누적, 자동 복귀 타이머 없음)
  - 자동 복귀가 없으므로 방장은 게임 화면의 `대기실로 나가기` 버튼(`return_to_lobby`)으로 언제든 방 전체를 대기실로 되돌릴 수 있다
- 게임 도중 관전으로 들어온 사람은 나갔다 오지 않고 `참여자로 이동` 버튼(`spectator_to_player`)으로 바로 참가자가 될 수 있다. 대기실(`lobby`)뿐 아니라 방장이 제시어를 내기 전(`intermission`, 라운드 대기)에도 합류 가능하며, 라운드 진행(`playing`) 중에는 불가. 클라이언트는 `room_update`에서 자신이 `players`에 들어오면 관전 모드를 해제한다
- 제시어는 자모 단위로 분해 (`jamoLogic.js`의 `decompose`): 초성/받침 쌍자음도 낱개로 분해 (ㄲ→ㄱㄱ 등)
- 키보드에는 쌍자음(ㄲㄸㅃㅆㅉ) 키가 없다. 기본 자음을 두 번 눌러 표현한다(ㄱㄱ=ㄲ). 배열은 표준 두벌식 순서 + 중앙 정렬 (`jamo.js`의 `KEY_ROWS`)
- 참가자는 최대 5회 시도, 각 시도는 Wordle 방식으로 자모 단위 채점 (`judge`): green(정확한 위치)/yellow(포함되지만 위치 다름)/black(불포함)
- 정답 시 점수 = `max(1, 6 - 시도 횟수)`, 승수 +1. 첫 정답자가 나오거나 참가자 전원이 소진하면 라운드 종료
- 정답/우승자는 `intermission`에서만 `safeState`에 포함해 공개(`answer`/`winnerName`/`hasResult`). `playing` 중 `safeState`의 정답은 마스킹된다
  - 단, `playing` 중에도 **방장·관전자**에게는 뷰어별 개인화 이벤트 `jamo_state.answer`로 정답을 내려보내 관전자가 정답을 볼 수 있다. **참가자**에게는 어느 경로로도 정답을 보내지 않는다
- 참가자는 자신의 시도는 전체 공개, 다른 참가자의 시도는 색깔 결과만 보이고 단어/자모는 마스킹됨. 방장·관전자는 전체 열람 가능 (`socket.js`의 `emitGameState`가 뷰어별로 개인화된 `jamo_state` 이벤트 전송, 방장 보드는 없으므로 참가자만 전송)
- 참가자 보드는 방장이 한 눈에 볼 수 있도록 그리드로 배치 (`#jamo-boards`, 스코어보드도 방장 제외)
- 방장이 대기실에서 참가자 키보드(자모별 최고 등급 색상) 노출 여부 토글 가능 (`toggle_keyboard_visible`)

## 자모 워들 — 솔로 플레이(솔플)
- 로비에서 방을 만들지 않고 난이도(하/중/상)만 골라 바로 시작하는 **완전 로컬** 모드. 서버/소켓 통신 없이 이 브라우저 안에서만 돈다 (테트리스 솔플과 동일 컨셉)
- 낱말 사전은 `client/js/jamoWords.js`의 `WORD_LIST`(5~12 자모 낱말 513개). 난이도는 저장하지 않고 실제 자모 분해 길이로 그때그때 거른다 → 사전과 채점 기준이 항상 일치
  - **하**: 자모 5개 / **중**: 자모 6~9개 / **상**: 자모 9~12개 (`SOLO_DIFFICULTY`, 9는 중·상이 겹칠 수 있음)
- **하루 1문제/난이도**: '오늘의 낱말'은 `날짜(로컬 YYYY-MM-DD) + 난이도`를 FNV-1a 해시한 인덱스로 결정(무작위 아님) → 같은 날 재접속·재도전해도 항상 같은 낱말이라 중복 출제가 없다
- **하루 1회 클리어 잠금**: 난이도별로 하루 한 번만 클리어 가능. 정답을 맞히면 `localStorage('pg-jamo-solo-cleared')`에 `{ date, diffs }`로 기록하고 다음 날까지 잠금(재진입 시 '이미 클리어' 안내). 실패(6회 소진)는 미클리어이므로 '다시 도전'으로 같은 오늘의 낱말에 재도전 가능
- 시도는 최대 6회(`SOLO_MAX_ATTEMPTS`). 채점/분해 로직(`decompose`/`judge`/`keyboardFromAttempts`)은 서버 `jamoLogic.js`와 동일 규칙을 `client/js/jamo.js`에 그대로 둔다(멀티는 서버가 채점하지만 솔플은 로컬이므로). 멀티용 렌더 함수(`renderAttemptRow`/`renderEmptyRow`/`renderKeyboard`/`updateComposingCells`)와 입력 조합 로직을 그대로 재사용
- 화면: `#screen-solo`(뷰는 `views/pages/jamo.pug`). 로비 진입 버튼은 `+lobby` 블록의 `.solo-diff-btn`(오늘 클리어한 난이도는 `.cleared` + '오늘 클리어 ✅' 표시). `/jamo` 페이지 자체는 닉네임(세션)이 있어야 진입 가능(홈에서 로그인)

## 모바일 대응
- 레이아웃은 대부분 `max-width` + flex-wrap + `%` 기반으로 유동적. 각 게임 scss에 `@media (max-width: 500px)` 보정, 테트리스는 `@media (pointer: coarse)`로 `#mobile-controls`(터치 버튼) 노출
- 테트리스 보드 셀 크기는 `client/js/tetris.js`의 `calcCellSize()`가 뷰포트 기준으로 계산하고 `resize`에 재계산. 악어 이빨 그리드도 `resize`에 `positionTeethGrid()`로 재배치(회전 대응)
- 전역(_base/_components): 입력창 `font-size:16px`(iOS 포커스 확대 방지), `-webkit-text-size-adjust:100%`, `overscroll-behavior-y:contain`(당겨서 새로고침 방지), `body .screen`/`body .page`에 `min-height:100dvh`(주소창 감안, 미지원 시 100vh 폴백)
- `<head>` meta viewport에 `viewport-fit=cover`. 우측 하단 공용 도크(`#pg-dock`)는 `env(safe-area-inset-*)` + `flex-wrap`으로 노치/좁은 화면 대응

## CSS 빌드
```bash
npm run build:css   # SCSS → CSS 컴파일 (변경 시 반드시 실행)
```

## 커밋 컨벤션
[Conventional Commits](https://www.conventionalcommits.org/) 형식을 따른다: `<type>: <설명>`

- `feat` — 새 기능 추가
- `fix` — 버그 수정
- `docs` — 문서(README, CLAUDE.md 등)만 변경
- `style` — 동작에 영향 없는 스타일/포맷팅 변경
- `refactor` — 기능 변경 없는 코드 구조 개선
- `chore` — 빌드/설정/의존성 등 그 외 잡무

설명은 한글로 작성하며, 무엇을 했는지보다 왜 했는지가 드러나게 간결히 쓴다.

```
feat: 자모 워들 게임 추가
fix: 채팅 스크롤 위치 버그 수정
docs: README 작성
chore: .env.sample 추가
```

## 중요 패턴
- `createRoomManager(config)` — 게임별 방 관리를 config 주입으로 통합
- `registerCommonHandlers(io, socket, manager, opts)` — 8개 공통 소켓 핸들러 일괄 등록
- `safeState(room)` — 클라이언트에 보내는 직렬화된 방 상태 (순환참조 제거)
- `getRoomOf(socketId)` — socketId로 플레이어가 있는 방 찾기
- `getRoomOfSpectator(socketId)` — socketId로 관전자가 있는 방 찾기
- disconnect 시 관전자 먼저 확인, 없으면 플레이어 처리
- `reapDisconnected(liveIds)` — 방 목록을 낼 때(`get_rooms`/`broadcastRooms`) 해당 네임스페이스에 연결된 소켓만 남기고, 연결이 끊긴 소켓만 있는 유령 방을 삭제. `liveIds`는 네임스페이스의 실제 연결 소켓 집합(기본 ns는 `io.sockets.sockets`, 그 외는 `io.sockets`)
