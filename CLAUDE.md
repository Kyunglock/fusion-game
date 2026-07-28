# Party Games — 프로젝트 개요

## 기술 스택
- **백엔드**: Node.js + Express + Socket.IO
- **프론트엔드**: Vanilla JS (ES Modules), SCSS → CSS 빌드 (`npm run build:css`)
- **뷰 엔진**: Pug (게임 페이지를 서버사이드 렌더링)
- **DB**: SQLite (better-sqlite3). 계정(닉네임)·아바타·전적·세션이 모두 여기에 저장된다. 파일 경로는 `DB_PATH`(기본 `data/app.db`)

## Socket.IO 네임스페이스
| 네임스페이스 | 게임 | 방 목록 이벤트 |
|---|---|---|
| `/` (default) | 악어 이빨 뽑기 | `rooms_update` |
| `/bomb` | 폭탄 돌리기 | `bomb_rooms_update` |
| `/tetris` | 테트리스 | `tetris_rooms_update` |
| `/jamo` | 자모 워들 | `jamo_rooms_update` |
| `/wordchain` | 끝말잇기 | `wordchain_rooms_update` |

## 계정 · 전적 · 등급 (DB)

### 계정 = 닉네임 (비밀번호 없음)
- 홈에서 닉네임만 입력하면 `POST /api/auth`가 그 닉네임의 계정으로 접속시킨다. 처음 보는 닉네임이면 그 자리에서 계정을 만든다(`loginOrCreate`). 대소문자 구분 없이 같은 닉네임 = 같은 계정(`UNIQUE COLLATE NOCASE`)
- 세션에는 `userId`(`user:<id>` 문자열, 접속자 위젯·방 참가자 식별용), `accountId`(users.id, 전적 기록 기준), `username`, `avatar`를 캐시한다. **정본은 항상 DB**이고 `GET /api/me`가 매번 DB로 세션 캐시를 맞춘다
- 세션은 SQLite(`sessions` 테이블, `src/db/sessionStore.js`)에 저장되므로 서버를 재시작·재배포해도 접속이 유지된다
- 닉네임 변경(`PUT /api/me/username`)은 계정 이름 변경이다(전적·등급 유지). 이미 쓰는 닉네임이면 409

### 전적
- 게임 한 판이 끝날 때 `recordPlayers(game, players, outcomeOf, scoreOf)`(`src/db/stats.js`)로 기록한다. 소켓 플레이어 객체에 실린 `accountId`가 기준이며, 기록 실패는 로그만 남기고 게임 진행을 막지 않는다
- 기록 시점: 악어=물린 사람 패/나머지 승, 폭탄=터뜨린 사람 패/나머지 승, 테트리스=마지막 생존자 승(이탈로 끝난 경우 포함), 끝말잇기=최후 1인 승, 자모=첫 정답자 승(방장은 참여하지 않으므로 제외, 전원 소진이면 무승부)
- 자모 워들 솔플은 소켓이 아니라 HTTP(`POST /api/solo/jamo`)로 기록한다. 게임 키가 `jamoSolo`(자모 워들 솔로)로 멀티(`jamo`)와 분리돼 쌓인다 → 아래 '자모 워들 — 솔로 플레이' 참고
- `game_stats`(게임별 누적) + `game_results`(판별 기록, 유저당 최근 100건만 보관) 두 테이블에 함께 쌓인다

### 등급 (리그 오브 레전드식)
- `src/db/ranking.js`. 절대 점수 구간이 아니라 **전체 유저 중 상위 몇 %인지**로 티어를 나눈다 → 인원이 적어도 위아래가 골고루 갈린다(5명이면 5명이 서로 다른 티어)
- 점수: 승 +25, 패 -10(0 미만은 0). 동점자는 승 → 판수 → 가입순으로 갈라 등급이 겹치지 않게 한다
- 티어 상한(상위 누적 %): 챌린저 0.05 / 그랜드마스터 0.2 / 마스터 1 / 다이아 4 / 에메랄드 12 / 플래티넘 25 / 골드 45 / 실버 65 / 브론즈 85 / 아이언 100. 마스터 이상을 뺀 티어는 구간 내 위치로 IV~I 디비전을 매긴다
- 한 판도 안 한 유저는 언랭크. 등급은 `GET /api/me`·`GET /api/me/stats`에 실려 오고 전체 등급표는 `GET /api/ranking`(상위 100명)
- 홈 화면: 유저바에 티어 배지, `전적 · 등급` 버튼 → 등급 카드 + 게임별 전적표 + 최근 전적 + 전체 등급표 모달

## 파일 구조
```
src/
  config.js              ← 게임별 설정 상수 (인원 제한, 타이머 등)
  db/
    index.js             ← SQLite 연결 + 마이그레이션(user_version 기반, 배열 끝에 추가만)
    users.js             ← 계정(닉네임) 조회/생성/수정
    stats.js             ← 전적 기록(recordPlayers/recordRound) + 조회(getUserStats)
    ranking.js           ← 백분위 기반 등급 티어 계산(getRanking/getUserRank)
    playerCards.js       ← 방 참가자 목록에 실어 보내는 전적 카드(getPlayerCard, 3초 캐시)
    soloStats.js         ← 자모 솔플 전적(난이도별 하루 첫 판만 기록, jamo_solo_daily)
    sessionStore.js      ← express-session SQLite 저장소
  routes/
    auth.js              ← /api/auth, /api/auth/logout, /api/me, /api/me/username,
                           /api/me/avatar, /api/me/stats, /api/ranking
    solo.js              ← /api/solo/jamo (GET 오늘 상태 / POST 솔플 한 판 결과)
  shared/
    roomManager.js       ← 범용 방 관리 팩토리 (createRoomManager)
    socketHandlers.js    ← 공통 소켓 핸들러 등록 (registerCommonHandlers)
  game/{crocodile,bomb,tetris,jamo,wordchain}/
    rooms.js             ← createRoomManager() 호출 + 게임별 설정/함수
    socket.js            ← registerCommonHandlers() + 게임 고유 핸들러만
    jamoLogic.js         ← (jamo 전용) 한글 자모 분해/판정 순수 로직 (decompose, judge, keyboardFromAttempts)
    chainLogic.js        ← (wordchain 전용) 한글 음절 분해/두음법칙/단어 검증 순수 로직 (allowedStarts, validateWord)
    dictionary.js        ← (wordchain 전용) words.txt.gz(표준국어대사전 기반 36만 단어)를 기동 시 Set으로 로드 (hasWord)

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
    wordchain.pug

client/
  js/
    shared/
      screenManager.js  ← showScreen(), $() 헬퍼
      chatManager.js    ← 채팅 전체 (initChat, setChatVisible, appendChatMessage)
      lobbyRenderer.js  ← renderRoomList, renderSpectatorList, renderWaiting
      uiHelpers.js      ← triggerFlash, triggerShake, 카운트다운, aloneOverlay
      authCheck.js      ← /api/me 호출 + 세션 정보 표시
      myRank.js         ← 대기실 '내 등급 · 전적' 패널 (/api/me/stats)
    index.js            ← 홈(로비 선택) 페이지 로직, 각 네임스페이스 방 개수 표시
    online-widget.js    ← 우측 하단 접속자 위젯
    crocodile.js        ← 게임 고유 로직 (이빨 렌더링, 턴 타이머)
    bomb.js             ← 게임 고유 로직 (폭탄 패스, 위험 표시)
    tetris.js           ← 테트리스 엔진 + 게임 고유 UI
    jamo.js              ← 자모 보드/키보드 렌더링, 답 제출
    wordchain.js         ← 끝말잇기 고유 로직 (단어 체인 렌더링, 턴 타이머, 단어 제출)
    utils.js            ← escHtml, showError
  partials/
    crocodile-svg.html  ← 악어 SVG (서버에서 읽어 Pug 변수로 주입)
  scss/{crocodile,bomb,tetris,jamo,wordchain}.scss  ← @use 'components' 공통 임포트
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
- `GET /wordchain` → Pug 렌더링 (`views/pages/wordchain.pug`)
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
  - 끝말잇기: `['🔗','🗣️','💬','📣']`

## 테마 (위장 테마)
- "회사에서 몰래 하는" 컨셉 — 대놓고 게임처럼 안 보이도록 여러 위장 테마를 제공한다.
- 7가지: `green`(기본 그린), `doc`(문서/워드풍 라이트), `sheet`(스프레드시트풍), `excel`(엑셀/오피스 라이트, 엑셀 그린 리본), `code`(VS Code 다크), `vscode`(VS Code 라이트/Light+, 블루 강조), `eclipse`(Eclipse IDE 라이트, 이클립스 퍼플)
- 구현: 색상은 전부 CSS 변수(`var(--x)`)로 통일. `client/scss/_variables.scss`의 `:root`가 기본(그린), `:root[data-theme='doc'|'sheet'|'code']` 블록이 팔레트를 오버라이드
  - `--green-*`는 이름은 그대로지만 각 테마의 **강조색 스케일**로 재정의됨(그린→블루 등). 채팅/서피스용으로 `--sunken`(채팅 패널·입력), `--bubble`(받은 말풍선), `--chip`(옅은 배지) 추가
  - SCSS 컴파일타임 변수(`$green-dark` 등)를 색상 위치에서 쓰면 테마가 안 먹으니 항상 `var(--x)` 사용
- 전환 UI: `client/js/shared/themeManager.js`가 우측 하단 위젯으로 주입. 선택값은 `localStorage('pg-theme')`에 저장하고 `<html data-theme>`로 적용
  - 접속자 위젯(`online-widget.js`)과 테마/투명도 위젯은 공용 도크 `#pg-dock`(우측 하단 가로 flex)에 나란히 놓여 겹치지 않는다. 두 파일 모두 `getDock()`로 도크를 생성/재사용
- **위장 배경(보호색)**: `client/js/shared/camouflage.js`가 게임 UI **뒤에** 실제 업무 앱처럼 보이는 장식 레이어(`#pg-camo`, `position:fixed; inset:0; z-index:-1; pointer-events:none`)를 깐다. 색만 바꾸는 게 아니라 실제 콘텐츠로 채워 흘깃 봐도 게임임을 숨긴다
  - `sheet`/`excel` → 열머리글(A·B·C…)·행번호·격자선 + 수식줄 + 선택 셀 + 시트 탭. 가짜 데이터는 **개발 산출물(테스트케이스 관리대장)** — TC ID/기능/항목/결과/담당 등을 화면 끝까지 꽉 채우고, 결과·재현 열에 엑셀 **조건부 서식 채우기**(Good=연녹 `#c6efce` / Bad=연빨강 `#ffc7ce` / Neutral=연노랑 `#ffeb9c`)를 흩뿌린다. 뷰포트 크기에 맞춰 열/행 수를 계산하고 `resize`에 다시 그린다. 가짜 데이터는 시드 고정 PRNG로 생성해 리빌드/리사이즈해도 흔들리지 않는다
  - **엑셀 카멜레온(`excel` 한정)**: 자모 워들 게임 UI 자체를 스프레드시트 셀로 위장한다(`client/scss/jamo.scss`의 `:root[data-theme='excel']` 오버라이드). 자모 셀·라벨·키보드 키를 배경 격자와 같은 규격(64×21)·플랫 회색 격자선으로 만들고, 채점 색을 위 조건부 서식 팔레트로 바꿔 배경 데이터의 색칠 셀과 섞는다. 카드/그림자/라운드/안내문 제거, 툴바·배너는 흐름에서 빼고(absolute) 보드·키보드를 시트 열/행 경계에 스냅(`padding`으로 정렬)해 **투명도를 낮추지 않아도** 시트 속 강조 범위처럼 묻힌다
  - `code`/`vscode`/`eclipse` → 폴더 트리 사이드바·탭·브레드크럼·줄번호·**IDE별 문법 강조**(`SYNTAX` 팔레트: code=VS Code 다크, vscode=Light+, eclipse=키워드 볼드 퍼플)·우측 미니맵·하단 터미널(npm/sass 출력)·상태바. 코드 줄 수/미니맵/터미널 높이는 뷰포트에 맞춰 계산해 화면을 끝까지 꽉 채운다(`CODE` 풀을 순환)
  - `doc` → 워드풍 리본 + 흰 문서 페이지, `green` → 위장 없음(순수 게임 화면)
  - 색은 대부분 테마 CSS 변수를 그대로 쓰고, 코드 문법색만 IDE별로 JS에 하드코딩. `<html data-theme>` 변경을 MutationObserver로 감지해 자동 갱신
- **게임 화면 흐리기(전경 투명도)**: 테마 버튼 옆 슬라이더로 조절(몰래 하는 컨셉—게임만 덜 눈에 띄게). 이제 `<html>` 전체가 아니라 **전경(게임)만** 흐려지고 위장 배경(`#pg-camo`)·조작 도크(`#pg-dock`)는 또렷하게 유지된다. 구현: 슬라이더 값을 `--pg-fg-opacity` CSS 변수(0.3~1)로 두고 `body > :not(#pg-camo):not(#pg-dock)`에 `opacity` 적용. `localStorage('pg-opacity')`에 저장, 게임 조작 가능하도록 최소 30%로 제한
- 깜빡임 방지: `views/layouts/base.pug`와 `client/index.html`의 `<head>` 인라인 스크립트가 CSS 로드 전에 `data-theme`와 `--pg-fg-opacity`를 먼저 설정
- 모든 페이지에서 `themeManager.js`·`online-widget.js`·`camouflage.js`를 로드(base.pug scripts 블록 + index.html)

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
- 대기실 위쪽에 **내 등급 · 전적 패널**(`#my-rank-panel`)이 뜬다. 게임 시작 전에 자기 티어와 승패를 확인할 수 있게 한 것. `client/js/shared/myRank.js`의 `createMyRankPanel(el, { games })`이 `GET /api/me/stats`를 받아 티어 배지 + 순위/상위 %/점수 + 게임별(자모 워들·자모 워들 솔로) 및 전체 승패를 그린다
  - 마크업은 `+waitingRoom({ showMyRank: true })` 옵션으로 넣는다(다른 게임은 옵션만 켜면 그대로 재사용 가능). 전적이 하나도 없으면 언랭크 배지 + 안내문만 나온다
  - 갱신: 페이지 진입(로그인 확인 직후) 1회 → 이후 대기실을 그릴 때마다(최소 5초 간격). 라운드를 마치고 대기실로 돌아온 순간과 솔플 전적을 기록한 직후에는 간격을 무시하고 바로 다시 조회한다
  - 티어 색 팔레트(`$tier-colors`)와 `.tier-badge`는 홈·대기실 공용이라 `_variables.scss`/`_components.scss`에 있다(예전에는 `index.scss`에만 있었음)
- **방에 있는 사람들의 전적도 서로 볼 수 있다.** 대기실 참가자 목록의 이름 아래에 티어 배지 + `자모 n승 n패` + `전체 n승 n패`가, 관전자 칩에는 티어 배지 + 자모 승패가 붙는다
  - 서버가 `safePlayer`/`safeSpectator`에 `card`(`src/db/playerCards.js`의 `getPlayerCard(accountId, 'jamo')`)를 실어 보낸다. `safeState`는 자주 호출되므로 전체 등급 계산은 3초 TTL로 캐시한다(전적이 바뀌어도 TTL 안에 반영)
  - 관전자도 티어를 보여줘야 하므로 `join_as_spectator`가 관전자 객체에 `accountId`를 넣고, `createRoomManager`에 `safeSpectator` 옵션이 생겼다(기본값은 기존과 동일하게 id/이름/아바타)
  - 클라이언트 렌더는 공용(`lobbyRenderer` + `myRank.js`의 `playerCardHtml`/`tierBadgeHtml`)이라 `card`를 안 보내는 다른 게임은 화면이 그대로다. 게임 이름 라벨은 `renderWaiting`의 `cardGameLabel` 옵션으로 넘긴다

## 끝말잇기 — 게임 규칙
- 최소 2명, 최대 8명. 방장도 게임에 직접 참여한다
- 게임 상태: `lobby` → `playing` → `roundEnd` → (자동 복귀 타이머 후) `lobby`
- 턴제: 라운드마다 첫 차례를 돌아가며 배정(`players[(round-1) % n]`), 이후 players 배열 순서대로 진행. 첫 단어는 자유, 이후 이전 단어의 끝 글자로 시작하는 단어를 이어야 한다
- 제한시간(`WORDCHAIN_TURN_TIMEOUT`, 15초) 안에 단어를 내지 못하면 탈락(`alive: false`, `wordchain_out` 이벤트). 탈락해도 방에는 남아 채팅/관람 가능. 마지막 1명이 남으면 라운드 종료(`wordchain_result`), 우승자 `wins` +1, `WORDCHAIN_RETURN_DELAY`(6초) 후 대기실 자동 복귀
- 단어 검증(`chainLogic.js`의 `validateWord`): 완성형 한글만, 2~15글자, 끝말 규칙(두음법칙 허용: 력→역, 로→노, 녀→여 등 — `allowedStarts`), 같은 라운드 내 중복 단어 금지, **사전 검증**(표준국어대사전 기반 공개 단어 목록 `words.txt.gz` 약 36만 단어, `dictionary.js`가 기동 시 로드). `validateWord`는 순수 로직을 유지하기 위해 사전 체커(`hasWord`)를 인자로 주입받으며, 사전 파일이 없으면 사전 검증만 건너뛰고 게임은 정상 동작한다
- 검증 실패 시 `error_msg`만 보내고 턴/타이머는 유지된다 (제출 실패가 패널티가 아님)
- 자기 차례인 사람이 이탈하면 `onPlayerLeave`가 다음 생존자에게 턴을 넘기고 socket.js가 타이머를 재시작. 생존자가 1명이 되면 즉시 라운드 종료
- `safeState`에 `chain`(단어 목록)/`currentTurn`/`turnDeadline`/`allowedStarts`(두음법칙 포함 시작 가능 글자)/`winner` 포함. 클라이언트 타이머는 `turnDeadline` 기준으로 표시만 담당(판정은 서버)
- 클라이언트 `TURN_TIME`(wordchain.js)은 서버 `WORDCHAIN_TURN_TIMEOUT`과 같은 값으로 유지해야 타이머 바가 정확하다

## 자모 워들 — 솔로 플레이(솔플)
- 로비에서 방을 만들지 않고 난이도(하/중/상)만 골라 바로 시작하는 모드. **채점은 전부 이 브라우저 안에서** 돈다(소켓 없음). 판이 끝났을 때만 전적 기록용으로 서버에 결과를 한 번 보낸다
- 낱말 사전은 `client/js/jamoWords.js`의 `WORD_LIST`(5~12 자모 낱말 513개). 난이도는 저장하지 않고 실제 자모 분해 길이로 그때그때 거른다 → 사전과 채점 기준이 항상 일치
  - **하**: 자모 5개 / **중**: 자모 6~9개 / **상**: 자모 9~12개 (`SOLO_DIFFICULTY`, 9는 중·상이 겹칠 수 있음)
- **하루 1문제/난이도**: '오늘의 낱말'은 `날짜(로컬 YYYY-MM-DD) + 난이도`를 FNV-1a 해시한 인덱스로 결정(무작위 아님) → 같은 날 재접속·재도전해도 항상 같은 낱말이라 중복 출제가 없다
- **하루 1회 클리어 잠금**: 난이도별로 하루 한 번만 클리어 가능. 정답을 맞히면 `localStorage('pg-jamo-solo-cleared')`에 `{ date, diffs }`로 기록하고 다음 날까지 잠금(재진입 시 '이미 클리어' 안내). 실패(6회 소진)는 미클리어이므로 '다시 도전'으로 같은 오늘의 낱말에 재도전 가능
  - 잠금 정본은 서버(`jamo_solo_daily`)에도 있다. 페이지 진입 시 `GET /api/solo/jamo?date=`로 받아 localStorage에 합치므로(`mergeCleared`) 다른 기기·브라우저에서 클리어해도 잠금이 이어지고, 캐시를 지워도 되살아난다

### 솔플 전적
- 판이 끝나면(`solo.done`) `reportSolo()`가 `POST /api/solo/jamo { date, difficulty, solved, attempts }`를 보낸다. 전적 게임 키는 `jamoSolo`(자모 워들 솔로)로 멀티 `jamo`와 분리 — 홈의 `전적 · 등급` 표에 별도 줄로 나오고 등급 점수(승 +25 / 패 -10)에도 함께 반영된다
- **난이도별 하루 첫 판만 기록한다.** 솔플은 클라이언트가 채점하므로 결과를 그대로 믿을 수밖에 없다 → `jamo_solo_daily`가 (유저, 날짜, 난이도)당 한 줄만 허용해 반복 제출로 전적을 부풀리는 것을 막는다(하루 최대 3판). 실패 후 '다시 도전'으로 맞힌 판은 클리어 잠금만 갱신하고 전적은 건드리지 않는다
- 승패: 맞히면 승(점수 = `max(1, 7 - 시도횟수)` → 1회 6점 … 6회 1점), 6회 소진이면 패(0점)
- 날짜는 '오늘의 낱말'과 기준을 맞추려고 클라이언트 로컬 날짜를 쓰되, 서버 날짜와 ±1일(시차 범위)을 벗어나면 서버 날짜로 되돌린다(`resolveDate`) → 날짜를 바꿔가며 여러 판 기록하는 것 방지
- 기록 결과는 솔플 배너 끝에 `📊 …`로 덧붙는다. 전적 기록이 실패해도 솔플 자체는 그대로 돈다
- 서버 상수 `JAMO_SOLO_MAX_ATTEMPTS`·`JAMO_SOLO_DIFFICULTIES`(`src/config.js`)는 클라이언트 `SOLO_MAX_ATTEMPTS`·`SOLO_DIFFICULTY`(`client/js/jamoWords.js`)와 같은 값으로 유지해야 한다
- 시도는 최대 6회(`SOLO_MAX_ATTEMPTS`). 채점/분해 로직(`decompose`/`judge`/`keyboardFromAttempts`)은 서버 `jamoLogic.js`와 동일 규칙을 `client/js/jamo.js`에 그대로 둔다(멀티는 서버가 채점하지만 솔플은 로컬이므로). 멀티용 렌더 함수(`renderAttemptRow`/`renderEmptyRow`/`renderKeyboard`/`updateComposingCells`)와 입력 조합 로직을 그대로 재사용
- 화면: `#screen-solo`(뷰는 `views/pages/jamo.pug`). 로비 진입 버튼은 `+lobby` 블록의 `.solo-diff-btn`(오늘 클리어한 난이도는 `.cleared` + '오늘 클리어 ✅' 표시). `/jamo` 페이지 자체는 닉네임(세션)이 있어야 진입 가능(홈에서 로그인)

## 모바일 대응
- 레이아웃은 대부분 `max-width` + flex-wrap + `%` 기반으로 유동적. 각 게임 scss에 `@media (max-width: 500px)` 보정, 테트리스는 `@media (pointer: coarse)`로 `#mobile-controls`(터치 버튼) 노출
- 테트리스 보드 셀 크기는 `client/js/tetris.js`의 `calcCellSize()`가 뷰포트 기준으로 계산하고 `resize`에 재계산. 악어 이빨 그리드도 `resize`에 `positionTeethGrid()`로 재배치(회전 대응)
- 전역(_base/_components): 입력창 `font-size:16px`(iOS 포커스 확대 방지), `-webkit-text-size-adjust:100%`, `overscroll-behavior-y:contain`(당겨서 새로고침 방지), `body .screen`/`body .page`에 `min-height:100dvh`(주소창 감안, 미지원 시 100vh 폴백)
- `<head>` meta viewport에 `viewport-fit=cover`. 우측 하단 공용 도크(`#pg-dock`)는 `env(safe-area-inset-*)` + `flex-wrap`으로 노치/좁은 화면 대응
- 자모 워들 멀티는 모바일(`≤500px`)에서만 **내 보드를 답 입력 키보드 바로 위**(`#jamo-my-board`)로 분리해 렌더한다. 좁은 화면에서 내가 입력 중인 자모가 다른 참가자 보드에 밀려 안 보이는 문제를 막기 위함. PC에서는 기존대로 내 보드도 `#jamo-boards` 그리드 안에 들어가고 `#jamo-my-board`는 `:empty`로 숨겨진다. 분기는 `jamo.js`의 `mobileLayout` (`matchMedia`, `change`에 재렌더). 모바일에서는 `#jamo-boards`(다른 참가자)를 `max-height:14vh`로 줄여 내 보드+키보드가 한 화면에 들어오게 한다
- **하단 고정 위젯 회피**: 채팅 FAB(좌하단)·공용 도크(우하단)는 `position:fixed`라 화면 아래쪽 UI를 덮는다. 모바일에서 자모 워들 답 입력 키보드의 동작키(지우기/입력)가 가려져 탭이 위젯에 먹히던 문제 → `themeManager.js`가 도크가 실제로 가리는 높이를 `--pg-dock-space`(도크 높이 + 하단 여백 + 안전영역, `ResizeObserver`로 갱신)로 노출하고, `jamo.scss`의 `@media (max-width: 500px)`에서 `#screen-game`/`#screen-solo`에 그만큼 `padding-bottom`을 준다. 채팅 FAB은 52px + `bottom:20px` = 72px 고정이라 `max()`로 함께 계산. 위장 테마가 `padding` 단축 속성으로 덮지 않도록 이 블록은 `jamo.scss` **맨 끝**에 두고 `:root[data-theme='excel']` 선택자도 함께 지정한다. PC는 위젯이 콘텐츠와 겹치지 않아 손대지 않는다

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
