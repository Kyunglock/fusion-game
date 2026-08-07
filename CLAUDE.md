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
| `/liar` | 라이어 게임 | `liar_rooms_update` |

**캐치마인드는 소켓을 쓰지 않는다.** 방·턴이 없는 비동기 게임이라 평범한 HTTP(`/api/catchmind/*`)만으로 돈다 → 아래 '캐치마인드' 참고

## 서버(채널) 분리 — 퓨전 서버 · 친구방

앞단에 관문을 하나 두고 **퓨전 서버**(`fusion`)와 **친구방**(`friends`) 둘로 갈랐다. 프로세스·DB를 나눈 **물리적 분리가 아니다** — 같은 앱 안에서 방 목록과 접속자만 서로 안 보이게 한 논리적 분리다. 두 무리가 같은 로비에서 서로의 방을 보지 않게 하는 것이 목적이라 프로세스를 두 벌 띄우고 전적을 쪼갤 이유가 없었다.

- 정의는 `src/servers.js`(`GAME_SERVERS`). **비밀번호도 여기에 그대로 적혀 있다** — 저장소가 공개라 누구나 볼 수 있지만, 이 관문은 아는 사람만 들이려는 잠금이 아니라 두 무리를 갈라놓는 구분선에 가깝다는 판단(주인 결정). 숨겨야 할 때는 환경변수 `SERVER_PASSWORD_FUSION`·`SERVER_PASSWORD_FRIENDS` 가 코드값을 덮는다. 비교는 sha256 해시의 상수시간 비교(`timingSafeEqual`)
- 관문은 **닉네임 로그인보다 앞단**이다: 서버 선택 + 비밀번호 → 닉네임 입력 → 게임 목록. 통과하면 `req.session.serverId` 가 박히고 그때부터 게임 페이지·API·소켓이 열린다
  - `POST /api/auth` 의 세션 재발급(`regenerate`)과 `POST /api/auth/logout` 은 `serverId` 를 그대로 넘겨준다 — 닉네임만 갈아탈 때 다시 비밀번호를 묻지 않기 위함
  - **한 번 고른 서버는 다시 고르지 않는다**(주인 결정). 지금 있는 서버를 알리는 배지도, 바꾸는 버튼도 화면에 두지 않는다 — 두 무리가 각자 한쪽에만 머무는 것이 전제라 매번 확인할 이유가 없다는 판단. `POST /api/servers/leave` 라우트는 남겨두었다(부르면 `serverId` 만 지우고 세션은 유지 → 새로고침하면 다시 서버 선택 화면). 화면에서 다시 부르려면 이 API 를 호출하고 새로고침하면 된다 — 소켓이 들고 있는 세션 스냅샷까지 갈아끼워야 하므로 새로고침이 필요하다
- API: `GET /api/servers`(목록 + 현재), `POST /api/servers/enter { serverId, password }`, `POST /api/servers/leave`(화면에서는 부르지 않음). 비밀번호는 IP당 10분 10회로 시도를 제한한다(`src/routes/servers.js`, 메모리)
- 게이트 미들웨어(`src/routes/servers.js`): 페이지는 `requireServerPage`(홈으로 리다이렉트), API 는 `requireServer`(403). 게임 페이지 7개와 `/api/solo`·`/api/catchmind` 에 걸려 있다
- **방 격리**: 방에 `serverId` 가 박히고(`createRoom`), `getRooms(serverId)` 가 그 서버 방만 준다. 다른 서버의 방은 코드를 알아도 `존재하지 않는 방입니다.` 로 막힌다(`socketHandlers.js` 의 `visible()`) — `join_room`·`join_as_spectator` 공통
  - 방 코드는 서버와 무관하게 전역 유일하게 발급한다(같은 코드가 두 서버에 동시에 생기지 않음)
  - 브로드캐스트는 `io.emit` 이 아니라 **서버 채널별**로 보낸다. 소켓은 접속 시 `srv:<serverId>` 방에 들어가고, `broadcastRoomList(io, manager, roomsEvent)` 가 서버마다 다른 목록을 쏜다. 소켓이 없는 자리(타이머 콜백)에서도 쓰라고 `socketHandlers.js` 에서 export 해 두었다
  - 소켓의 `serverId` 는 **핸드셰이크 시점의 세션 스냅샷**이다. 서버를 바꾸면 페이지를 다시 여는 것이 전제
- 접속자 위젯(`online_users`, 악어 네임스페이스)도 서버별로 나눠 보낸다
- **캐치마인드 그림도 갈린다**: 방이 없는 게임이라 소켓이 아니라 `catchmind_drawings.server_id` 로 가른다 → 아래 '캐치마인드' 참고
- **전적·등급도 갈린다**: `game_stats`·`game_results`에 `server_id` 가 붙어 서버마다 따로 쌓이고, 등급(백분위 티어)도 그 서버 안에서만 매겨진다 → 아래 '계정 · 전적 · 등급' 참고
- **갈리지 않는 것**: 계정(닉네임·아바타)뿐이다. 같은 닉네임은 두 서버에서 같은 계정이고, 프로필을 한 번만 바꾸면 양쪽에 반영된다
- 화면: `client/index.html` 의 `#page-server`(서버 카드 + 비밀번호) → `#page-auth` → `#page-select`. 홈의 방 개수 소켓은 서버가 정해진 뒤에 연결한다(`startRoomCounts`). 서버 이름이 화면에 나오는 곳은 전적 모달 맨 위 한 줄(`.stats-server-note`)뿐이다 — 어느 서버 기준의 전적인지 밝히려는 것이라 남겨두었다

## 계정 · 전적 · 등급 (DB)

### 계정 = 닉네임 (비밀번호 없음)
- 홈에서 닉네임만 입력하면 `POST /api/auth`가 그 닉네임의 계정으로 접속시킨다. 처음 보는 닉네임이면 그 자리에서 계정을 만든다(`loginOrCreate`). 대소문자 구분 없이 같은 닉네임 = 같은 계정(`UNIQUE COLLATE NOCASE`)
- 세션에는 `userId`(`user:<id>` 문자열, 접속자 위젯·방 참가자 식별용), `accountId`(users.id, 전적 기록 기준), `username`, `avatar`를 캐시한다. **정본은 항상 DB**이고 `GET /api/me`가 매번 DB로 세션 캐시를 맞춘다
- 세션은 SQLite(`sessions` 테이블, `src/db/sessionStore.js`)에 저장되므로 서버를 재시작·재배포해도 접속이 유지된다
- 닉네임 변경(`PUT /api/me/username`)은 계정 이름 변경이다(전적·등급 유지). 이미 쓰는 닉네임이면 409

### 전적
- **전적은 서버(채널)별로 갈린다**(마이그레이션 6). `game_stats` 는 PK 가 `(user_id, server_id, game)` 이고 `game_results` 에도 `server_id` 가 붙는다. 계정은 하나인데 퓨전에서 쌓은 승패와 친구방에서 쌓은 승패가 서로 섞이지 않는다. 최근 전적 보관 한도(100건)도 서버마다 따로 센다
- 게임 한 판이 끝날 때 `recordPlayers(serverId, game, players, outcomeOf, scoreOf)`(`src/db/stats.js`)로 기록한다. `serverId` 는 방에 박혀 있는 `room.serverId` 를 넘긴다. 소켓 플레이어 객체에 실린 `accountId`가 기준이며, 기록 실패는 로그만 남기고 게임 진행을 막지 않는다
- 기록 시점: 악어=물린 사람 패/나머지 승, 폭탄=터뜨린 사람 패/나머지 승, 테트리스=마지막 생존자 승(이탈로 끝난 경우 포함), 끝말잇기=최후 1인 승, 자모=첫 정답자 승(방장은 참여하지 않으므로 제외, 전원 소진이면 무승부)
- 캐치마인드도 소켓이 아니라 HTTP로 기록한다. 전적이 쌓이는 서버는 **그 그림이 그려진 서버**(`drawing.server_id`)다. 게임 키 `catchmind`, **한 그림을 처음 끝낼 때 한 번만** — 맞히면 승, 시도를 다 쓰거나 포기하면 패 → 아래 '캐치마인드' 참고
- 자모 워들 솔플도 서버별로 쌓인다. 다만 **'난이도별 하루 한 판' 잠금은 일부러 서버와 무관하게 하나로 둔다** — `jamo_solo_daily` 의 PK 에 `server_id` 를 넣으면 서버를 오가며 하루에 두 배로 기록할 수 있어 반복 제출 방지 장치가 헐거워진다. 소켓이 아니라 HTTP(`POST /api/solo/jamo`)로 기록한다. 게임 키가 `jamoSolo`(자모 워들 솔로)로 멀티(`jamo`)와 분리돼 쌓인다 → 아래 '자모 워들 — 솔로 플레이' 참고
- `game_stats`(게임별 누적) + `game_results`(판별 기록, 유저당 최근 100건만 보관) 두 테이블에 함께 쌓인다

### 등급 (리그 오브 레전드식)
- `src/db/ranking.js`. **등급도 서버별로 매긴다**(`getRanking(serverId)`) — 전적이 갈리므로 당연한 귀결이다. 퓨전에서 챌린저라도 친구방에서는 그곳 전적으로 다시 줄을 선다. 절대 점수 구간이 아니라 **그 서버 유저 중 상위 몇 %인지**로 티어를 나눈다 → 인원이 적어도 위아래가 골고루 갈린다(5명이면 5명이 서로 다른 티어)
- 점수: 승 +25, 패 -10(0 미만은 0). 동점자는 승 → 판수 → 가입순으로 갈라 등급이 겹치지 않게 한다
- 티어 상한(상위 누적 %): 챌린저 0.05 / 그랜드마스터 0.2 / 마스터 1 / 다이아 4 / 에메랄드 12 / 플래티넘 25 / 골드 45 / 실버 65 / 브론즈 85 / 아이언 100. 마스터 이상을 뺀 티어는 구간 내 위치로 IV~I 디비전을 매긴다
- 한 판도 안 한 유저는 언랭크. 등급은 `GET /api/me`·`GET /api/me/stats`에 실려 오고 등급표는 `GET /api/ranking`(그 서버 상위 100명). 셋 다 세션의 `serverId` 기준이라 서버를 바꾸면 다른 숫자가 나온다
- 홈 화면: 유저바에 티어 배지, `전적 · 등급` 버튼 → 등급 카드 + 게임별 전적표 + 최근 전적 + 전체 등급표 모달

## 파일 구조
```
src/
  config.js              ← 게임별 설정 상수 (인원 제한, 타이머 등)
  servers.js             ← 서버(채널) 정의 — 퓨전 서버/친구방, 비밀번호 검증
  db/
    index.js             ← SQLite 연결 + 마이그레이션(user_version 기반, 배열 끝에 추가만)
    users.js             ← 계정(닉네임) 조회/생성/수정
    stats.js             ← 전적 기록(recordPlayers/recordRound) + 조회(getUserStats)
    ranking.js           ← 백분위 기반 등급 티어 계산(getRanking/getUserRank)
    playerCards.js       ← 방 참가자 목록에 실어 보내는 전적 카드(getPlayerCard, 3초 캐시)
    soloStats.js         ← 자모 솔플 전적(난이도별 하루 첫 판만 기록, jamo_solo_daily)
    catchmind.js         ← 캐치마인드 그림 저장소(그림 CRUD, 출제, 정답 시도, 추천·비추천, 평가 목록, 신고 — 전부 server_id 로 서버별 격리)
    sessionStore.js      ← express-session SQLite 저장소
  routes/
    auth.js              ← /api/auth, /api/auth/logout, /api/me, /api/me/username,
                           /api/me/avatar, /api/me/stats, /api/ranking
    servers.js           ← /api/servers (목록·입장·나가기) + requireServer 게이트 미들웨어
    solo.js              ← /api/solo/jamo (GET 오늘 상태 / POST 솔플 한 판 결과)
    catchmind.js         ← /api/catchmind/* (제시어 배정·그림 저장·출제·정답·추천·평가 목록·신고·랭킹·내 그림)
  shared/
    roomManager.js       ← 범용 방 관리 팩토리 (createRoomManager)
    socketHandlers.js    ← 공통 소켓 핸들러 등록 (registerCommonHandlers)
    reconnect.js         ← 재접속 유예 자리 관리 (holdSeat/claimSeat/expireSeat)
  game/{crocodile,bomb,tetris,jamo,wordchain,liar}/
    rooms.js             ← createRoomManager() 호출 + 게임별 설정/함수
    socket.js            ← registerCommonHandlers() + 게임 고유 핸들러만
    jamoLogic.js         ← (jamo 전용) 한글 자모 분해/판정 순수 로직 (decompose, judge, keyboardFromAttempts)
    chainLogic.js        ← (wordchain 전용) 한글 음절 분해/두음법칙/단어 검증 순수 로직 (allowedStarts, validateWord)
    dictionary.js        ← (wordchain 전용) words.txt.gz(표준국어대사전 기반 36만 단어)를 기동 시 Set으로 로드 (hasWord)
    (liar 전용은 별도 순수 로직 파일 없이 socket.js 안에 역할 배정·투표 집계 로직이 있다)
  game/catchmind/        ← 소켓/방이 없는 게임이라 rooms.js·socket.js 가 없다
    words.js             ← 제시어 사전(카테고리별 그릴 수 있는 명사 ~350개) + 배정 로직(pickWord)
    drawingLogic.js      ← 초성 추출·정답 판정·획 데이터 검증 순수 로직 (chosungOf, isCorrect, sanitizeStrokes)

views/
  layouts/base.pug      ← 공통 HTML head, script, 채팅 포함(`hasChat: false` 면 채팅 제외)
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
    liar.pug             ← 방장 진짜/가짜 제시어 입력, 힌트·투표·라이어 최후 추측 UI
    catchmind.pug        ← 홈/그리기/맞히기/평가/랭킹/내 그림 6개 화면 (로비·대기실 믹스인 안 씀, 채팅 없음)

client/
  js/
    shared/
      screenManager.js  ← showScreen(), $() 헬퍼
      chatManager.js    ← 채팅 전체 (initChat, setChatVisible, appendChatMessage)
      lobbyRenderer.js  ← renderRoomList, renderSpectatorList, renderWaiting
      uiHelpers.js      ← triggerFlash, triggerShake, 카운트다운, aloneOverlay
      authCheck.js      ← /api/me 호출 + 세션 정보 표시
      connection.js     ← 소켓 생성 + 재접속/방 복귀 (createSocket, initReconnect, leaveRoom)
      noZoom.js         ← 모바일 확대(핀치·더블탭) 차단
      myRank.js         ← 대기실 '내 등급 · 전적' 패널 (/api/me/stats)
    index.js            ← 홈(로비 선택) 페이지 로직, 각 네임스페이스 방 개수 표시
    online-widget.js    ← 우측 하단 접속자 위젯
    crocodile.js        ← 게임 고유 로직 (이빨 렌더링, 턴 타이머)
    bomb.js             ← 게임 고유 로직 (폭탄 패스, 위험 표시)
    tetris.js           ← 테트리스 엔진 + 게임 고유 UI
    jamo.js              ← 자모 보드/키보드 렌더링, 답 제출
    wordchain.js         ← 끝말잇기 고유 로직 (단어 체인 렌더링, 턴 타이머, 단어 제출)
    liar.js              ← 라이어 게임 고유 로직 (역할·제시어 개인화 렌더링, 힌트·투표 UI)
    catchmind.js         ← 캔버스 그리기 엔진(획 기록·되돌리기·재생) + 그리기/맞히기/평가/내 그림 화면
    utils.js            ← escHtml, showError
  partials/
    crocodile-svg.html  ← 악어 SVG (서버에서 읽어 Pug 변수로 주입)
  scss/{crocodile,bomb,tetris,jamo,wordchain,liar,catchmind}.scss  ← @use 'components' 공통 임포트
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
  - `remapPlayerId(room, oldId, newId)` — 재접속으로 소켓 id가 바뀔 때 게임 상태에 박힌 id 참조 갱신 (폭탄 소유자·현재 차례·승자 등)

### 서버: registerCommonHandlers (src/shared/socketHandlers.js)
- 8개 공통 핸들러 한 번에 등록: `get_rooms`, `create_room`, `join_room`, `join_as_spectator`, `toggle_spectator_allowed`, `kick_player`, `toggle_ready`, `chat_message`
- 여기에 더해 이탈·재접속 핸들러 3개(`disconnect`, `leave_room`, `resume_room`)를 `registerLeaveFlow()`로 등록
- `validateStartGame()`·`registerLeaveFlow()` 유틸 반환 (게임별 socket.js에서 사용)
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
- `GET /liar` → Pug 렌더링 (`views/pages/liar.pug`)
- `GET /catchmind` → Pug 렌더링 (`views/pages/catchmind.pug`, `hasChat: false`)
- 게임 페이지는 모두 `requireServerPage` 뒤에 있다 — 서버(채널)를 고르지 않았으면 홈으로 되돌린다
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
  - 라이어 게임: `['🕵️','🎭','🃏','🎩']`

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
  - 서버가 `safePlayer`/`safeSpectator`에 `card`(`src/db/playerCards.js`의 `getPlayerCard(accountId, 'jamo', room.serverId)`)를 실어 보낸다. 전적이 서버별로 갈리므로 `safePlayer(p, room)`·`safeSpectator(s, room)` 가 방을 함께 받아 `room.serverId` 를 넘긴다(다른 게임은 방을 안 쓰므로 그대로다). `safeState`는 자주 호출되므로 등급 계산은 **서버별로** 3초 TTL 캐시를 둔다(전적이 바뀌어도 TTL 안에 반영)
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

## 라이어 게임 — 게임 규칙
- 최소 3명, 최대 9명. **방장도 끝말잇기처럼 참가자로 함께 플레이한다**(진행 전용 역할이 아니다) — 방장도 라이어가 될 수 있고 힌트·투표에 똑같이 참여한다
- **인지형 라이어**: 라이어는 자신이 라이어라는 사실은 알지만(`role: 'liar'`), 진짜 제시어는 받지 못한다(`word: null`). 힌트를 듣고 눈치껏 그럴듯한 힌트를 내야 한다 — 예전의 '가짜 제시어를 받는 라이어(바보 라이어)' 방식에서 바뀐 것
- 게임 상태(`room.state`)로 라운드의 세부 단계까지 표현한다: `lobby`(대기실 — 전원 준비 완료 후 방장이 게임 시작) → `hint`(순서대로 힌트 제출) → `voteContinue`(한 바퀴 더 vs 라이어 지목 투표) → [`voteLiar`(지목 투표) → `defense`(지목된 사람의 최후 반론) → `confirmAccuse`(그대로 진행 vs 철회 투표) → [`liarGuess`(라이어가 진짜 제시어 맞히기)]] → 다시 `lobby`(결과·직전 라운드 힌트 기록을 대기실에서 공개, 전원 재준비 대기)
- **제시어 자동 배정**: 방장이 `start_game`을 누르면(다른 게임과 동일하게 참가자 전원 준비 완료 + 최소 인원 확인 후) 방장이 직접 입력하지 않고 자모 워들의 낱말 사전(`client/js/jamoWords.js`의 `WORD_LIST`, 513개)에서 서버가 무작위로 하나를 뽑아 즉시 배정한다(`assignNewRound`). 전원(방장 포함) 중 한 명을 무작위로 라이어로 뽑는다
- 참가자의 역할(`role`)·제시어(`word`)는 뷰어별로 감춰야 하므로 `safeState`에는 넣지 않고 `socket.js`의 `emitLiarState`가 개인화된 `liar_state` 이벤트로 따로 보낸다. **참가자(방장 포함)는 자신의 역할·제시어만** 보고, **관전자만 참가자 전원의 역할·제시어를 모두** 본다(방장도 플레이하므로 더 이상 특권이 없다)
- 힌트: 라운드 시작 시 전원(방장 포함)의 순서를 무작위로 섞어(`turnOrder`) 시계방향으로 한 명씩 힌트를 제출한다. 제한시간(`hintTimeout`, 기본 15초 — 방장이 대기실에서 15~60초로 실시간 조절 가능, `set_hint_timeout`) 안에 못 내면 힌트 없이 다음 차례로 넘어간다(`skipped` 힌트로 기록). 전원이 한 바퀴 돌면 자동으로 투표 단계로 전환
- 투표 1(`cast_continue_vote`): '라이어 지목' vs '한 바퀴 더' 중 선택. 과반이 지목이면 `voteLiar`로, 과반이 한 바퀴 더면 같은 순서로 `hint`가 다시 시작된다. 동률이면 투표를 초기화하고 재투표
- 투표 2(`cast_accuse_vote`, `voteLiar` 단계): 누구든(방장 포함) 클릭해 라이어로 지목할 수 있다. 최다 득표자가 유일하면 확정, 동률이면 재투표
  - 지목이 확정되면 바로 결론 내지 않고 **`defense` 단계(기본 1분, `defenseTimeout`)** 로 넘어가 지목된 사람에게 최후 반론 시간을 준다. 지목된 사람에게만 뜨는 토스트 입력창(`submit_defense_line`)에 한 줄씩 적으면 `room.defenseLines`에 쌓여 모두에게 실시간으로 공개된다(일기처럼 여러 줄 남길 수 있음, 최근 20줄만 보관). 지목된 사람이 **'반론 종료'(`end_defense`)** 를 누르면 남은 시간과 무관하게 즉시 다음 단계로 넘어간다
  - 반론이 끝나면(시간 초과 또는 반론 종료) **`confirmAccuse` 투표(`cast_confirm_vote`)** 로 '그대로 진행' vs '철회' 중 선택. 과반이 철회면 지목을 무르고 `hint`로 돌아가 같은 순서로 계속 진행. 과반이 진행이면 `resolveAccusation`으로 실제 결론을 낸다: 지목 대상이 **라이어가 아니면** 그 즉시 **라이어 승리**로 라운드 종료, **라이어가 맞으면** 모두에게 "🚨 OO 검거되었습니다!" 애니메이션(`liar_accuse_result` correct:true)을 띄우고 `liarGuess`로 전환해 라이어에게 마지막 기회로 진짜 제시어를 맞힐 입력창을 준다(`submit_liar_guess`). 라이어가 입력하는 동안 글자를 `submit_guess_typing`/`liar_guess_typing`으로 실시간 중계해 다른 사람들도 미리보기로 본다(제출 전까지는 힌트일 뿐, 최종 판정은 제출 시점의 `submit_liar_guess`로만 한다). 맞히면 라이어 승리, 틀리면 시민 승리. 동률이면 재투표
  - 위 세 투표(`voteContinue`/`voteLiar`/`confirmAccuse`) 모두 `votedIds`(누가 투표했는지)를 `safeState`로 공개해 클라이언트가 참가자별 투표 완료 표시(점 켜짐)를 그린다. 무엇을 투표했는지는 집계 전까지 비공개. **진행 현황(득표 수·투표 완료 표시)은 관전자에게도 똑같이 보이고, 투표 버튼은 참가자(방장 포함)에게만** 있다
  - 동률이면 채팅 시스템 메시지뿐 아니라 화면 상단에 몇 초간 뜨는 토스트 배너로도 알린다 — 그냥 숫자가 0으로 리셋된 것처럼 보여서 오류로 오해하기 쉽기 때문
  - 투표 분모(`votesNeeded`)는 재접속 유예 중(`disconnected`)인 사람을 제외한다 — 안 그러면 끊긴 사람 몫만큼 투표가 영원히 안 채워진 것처럼 보인다. 누군가 끊기는 순간(`disconnect`의 `immediate` 콜백)에도 바로 재집계해서, 그 사람이 마지막 한 표였다면 90초 유예를 기다리지 않고 바로 진행된다
- 라운드 종료(`endRound`)는 결과를 `room.lastResult`(승리 진영/라이어 이름/진짜 제시어/라이어가 맞힌 답)에 저장하고 `lobby`로 돌아간다(끝말잇기처럼 대기실 복귀, 자동 타이머는 없음 — 전원이 다시 준비 완료하고 방장이 게임 시작을 눌러야 다음 라운드가 시작된다). 전적은 `recordPlayers(serverId, 'liar', ...)`로 남기며, 승리 진영에 따라 라이어/시민 각각 win·lose 기록
  - **직전 라운드 힌트 기록(`room.hints`)과 결과(`room.lastResult`)는 `endRound`에서 지우지 않는다.** 대기실로 돌아간 뒤에도 그대로 남아 `safeState`에 실려 대기실 화면(`#liar-hint-log-lobby`/`#liar-result-banner-lobby`)에 계속 보이다가, 다음 라운드가 실제로 시작되는 순간(`assignNewRound`)에 비워진다
- 라이어가 라운드 도중 나가면 정체가 성립하지 않으므로 승패 기록 없이 즉시 `lobby`로 되돌리고(이 경우는 힌트 기록도 함께 비운다) `round_cancelled` 이벤트로 안내한다(자모 워들의 `cancel_round`와 같은 원칙). 인원이 `LIAR_MIN_PLAYERS` 아래로 떨어지면(`createRoomManager`의 공통 로직) 역시 승패 기록 없이 대기실로 돌아간다
- 재접속 대응: `remapPlayerId`가 `liarId`/`currentTurn`/`accusedId`/`turnOrder`/`hints[].playerId`/투표(`continueVotes`·`accuseVotes`·`confirmVotes`) 맵의 키·값을 모두 갱신한다

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

## 캐치마인드 — 게임 규칙 (방 없는 비동기 게임)

다른 게임과 달리 **방도 소켓도 없다.** 혼자 들어와 제시어를 받아 그림을 그려 올려두면, 다른 사람이 아무 때나 들어와 그 그림을 맞힌다. 그래서 서버는 평범한 HTTP 라우터(`src/routes/catchmind.js`) 하나뿐이고, `registerCommonHandlers`·`createRoomManager` 를 쓰지 않는다.

### 제시어
- 사전은 `src/game/catchmind/words.js` 에 직접 큐레이션해 넣었다(카테고리 9종, 약 350개). 기준은 **손으로 30초 안에 그릴 수 있는 것** — 추상어는 넣지 않는다
- 남의 제시어 목록(나무위키의 캐치마인드 문제 목록 등)을 쓰지 않은 이유: CC BY-NC-SA(비영리·동일조건) 라이선스라 나중에 걸림돌이 되고, 원본이 특정 게임사의 DB다. 사전이 작아도 되는 이유는 **콘텐츠가 제시어가 아니라 유저가 그린 그림으로 늘어나기 때문** (같은 '고양이'도 그린 사람이 다르면 다른 문제)
- 배정은 `GET /api/catchmind/word`. 후보 8개를 뽑아 **그림이 가장 적게 쌓인 것**을 준다 → 인기 단어에 그림이 몰리지 않는다. `?refresh=1` 이면 방금 준 제시어는 피한다
- **배정한 제시어는 세션(`req.session.catchmindWord`)에 넣고, 저장할 때 그 값을 쓴다.** 클라이언트가 보낸 제시어를 믿으면 아무 단어나 정답으로 만들 수 있다. 저장 후에는 세션 값을 비워 한 제시어로 두 번 올리지 못하게 한다

### 그림 저장 형식 (PNG 아님)
- 그림은 이미지가 아니라 **획 좌표**로 저장한다: `[{ c: 색인덱스, s: 굵기인덱스, e: 0|1(지우개), p: [x,y,x,y,…] }]`
- 이유 셋 — 용량이 이미지의 몇 분의 일이라 SQLite 에 수천 장이 쌓여도 괜찮고, **그린 순서대로 재생**할 수 있고(캐치마인드 재미의 절반), 화면 크기와 무관하게 다시 그릴 수 있다
- 좌표계는 항상 `1000×750`(4:3) 논리 좌표. `sanitizeStrokes`(`drawingLogic.js`)가 모양·범위·개수를 검증하고 어긋나면 통째로 거절한다(획 300개 / 점 12,000개 / JSON 200KB 상한 — `src/config.js`)
- 색 팔레트(`PALETTE`)와 굵기(`SIZES`)는 서버 `drawingLogic.js` 와 클라이언트 `client/js/catchmind.js` 가 **순서까지 같아야 한다**(인덱스로 저장하므로)
- 지우개는 별도 합성 모드가 아니라 **종이색(흰색)으로 긋는 획**이다. 종이는 테마와 무관하게 항상 흰색 — 그린 사람과 맞히는 사람이 같은 그림을 봐야 한다

### 맞히기
- `GET /api/catchmind/quiz` 가 **숨김 아님 + 내 그림 아님 + 내가 아직 끝내지 않은** 그림을 랜덤으로 한 장 준다
  - 제외 기준이 '풀이 기록 없음'이 아니라 `catchmind_plays.finished = 1` 인 것이 중요하다. 열어만 보고 나간 그림까지 빼버리면 다시는 안 나온다
  - 새 그림이 다 떨어지면 아무 그림이나 **복습**(`replay: true`)으로 주되 전적에는 반영하지 않는다
- 처음 주는 힌트는 **글자 수뿐**이다(`length` → 빈 칸 n개). 정답 문자열은 라운드가 끝나기 전엔 어떤 경로로도 클라이언트에 보내지 않는다
- 시도는 `CATCHMIND_MAX_ATTEMPTS`(5회). 다 쓰면 패, `POST …/giveup`(포기)도 패. 정답 비교는 `isCorrect` — 공백·문장부호를 걷어낸 완전 일치
- 전적 키는 `catchmind`. **그 그림을 처음 끝낼 때 한 번만** 기록한다(`catchmind_plays.finished`) → 복습·재도전으로 승수가 부풀지 않는다. 맞히면 `CATCHMIND_SCORE_SOLVE`(3점)

#### 다음에 풀기 (skip)
- `GET /api/catchmind/quiz?skip=<id>` — 지금 그림을 넘기고 다음 그림을 받는다. **포기와 다르다**: 아무것도 기록하지 않으니 패도 아니고, 넘긴 그림은 나중에 다시 나온다
- 넘긴 그림은 **버리는 것이 아니라 뒤로 미루는 것**이라 `catchmind_plays` 를 건드리지 않고 **세션에만** 기억한다(`req.session.catchmindSkipped`, 최근 `CATCHMIND_SKIP_MEMORY`(20)장). 제시어 배정의 `?refresh=1` 과 같은 방식이다
  - DB 쪽은 `pickQuiz(accountId, serverId, skipIds)` 가 `d.id NOT IN (SELECT value FROM json_each(@skip))` 로 빼기만 한다. 기억을 세션에 둔 덕에 컬럼도 표도 늘지 않는다
  - 넘긴 것밖에 안 남으면 한 바퀴 다 돈 것이므로 `exhausted` 를 올려 보내고 라우터가 세션의 넘김 목록을 비운다 → 넘기다 보면 영원히 낼 그림이 없어지는 일이 없다
- **이미 쓴 시도 횟수는 그대로 남는다**(풀이 기록을 건드리지 않으므로). 3번 틀린 뒤 넘겼다면 다시 만났을 때도 2번이 남아 있다 — 넘겨서 시도를 초기화하는 우회로가 되지 않는다
- 화면에서는 `⏭️ 다음에 풀기` 버튼. 판이 끝났거나(정답·소진·포기) 낼 그림이 없으면 숨는다. 넘겼는데 같은 그림이 돌아오면(맞힐 그림이 그것뿐) 배너로 알린다

### 초성 힌트 — 4번 틀리면 공개
- **`CATCHMIND_HINT_AFTER_ATTEMPTS`(4)번 틀리면** 그 사람에게 초성이 보인다. 마지막 한 번을 남겨두고 주는 구제책이라 동의·투표 같은 절차가 없다
- 조건은 **사람마다 따로** 센다(`catchmind_plays.attempts`). 남이 4번 틀렸다고 내 화면에 초성이 뜨지는 않는다
- 조건을 못 채웠으면 초성을 **아예 응답에 싣지 않는다**(`chosung: null`) — 보내놓고 화면에서만 가리면 개발자 도구로 다 보인다
- 4번째 오답의 `guess` 응답에 `chosung` 을 함께 실어 보내므로 클라이언트가 다시 조회할 필요가 없다

### 추천 · 비추천
- `POST …/vote { value: 1 | -1 | 0 }`. 한 사람이 한 그림에 한 표(`catchmind_votes`), 같은 값을 다시 보내면 취소되고 반대쪽을 보내면 바뀐다
- 합계는 목록에서 매번 세지 않도록 `catchmind_drawings.likes` / `dislikes` 에 함께 적어둔다
- 신고와 달리 **출제 여부에는 영향을 주지 않는다** — '잘 그렸다/못 그렸다'는 평가일 뿐이다. 그림을 내리는 것은 신고 쪽 몫

### 그림 평가하기 (`GET /api/catchmind/rated?filter=all|solved|missed`)
- 맞히기 화면에서는 **지금 풀고 있는 한 장**에만 표를 던질 수 있어서 지나간 그림은 다시 평가할 방법이 없었다. 홈의 `🖐️ 그림 평가하기` 메뉴(`#screen-rate`)가 그 자리를 메운다
- 대상은 **내가 이미 끝낸 그림**뿐이다 — `catchmind_plays.finished = 1`, 즉 맞혔거나 시도를 다 썼거나 포기한 것. 아직 손대지 않은 그림을 끼우면 목록에 정답이 그대로 새어 나가고, 어차피 안 본 그림은 평가할 근거도 없다. 내가 그린 그림은 표를 던질 수 없으므로(라우터 `loadQuiz` 와 같은 규칙) 목록에서도 뺀다
- 필터는 `all`(전체) / `solved`(맞힌 그림) / `missed`(틀린 그림) / `unrated`(아직 평가 안 한 그림) 넷. 랭킹의 `sort` 와 같은 이유로 조건절을 미리 만들어 두고 **키로만 고른다**(`RATE_FILTERS`). `unrated` 는 목록 쿼리가 이미 내 표를 LEFT JOIN 해 두었으므로 `v.value IS NULL` 한 줄로 갈린다
  - `unrated` 목록에서 표를 던진 카드는 더 이상 그 조건이 아니지만 **자리를 바로 없애지 않는다** — 취소하려는데 사라져 버리면 곤란하다. 흐리게(`.is-rated`)만 두고 목록을 다시 부를 때 빠진다
- 이미 끝낸 그림만 나오므로 **제시어를 가리지 않는다**. 카드에는 정답·그린 사람·내 결과 배지(맞힘 n회 / 틀림 n회 / 포기)가 함께 뜬다. 못 맞혔는데 시도를 다 쓰지도 않았다면 중간에 포기한 것 — 시도를 다 써야만 포기 없이 패가 되므로 이 둘은 확실히 갈린다
- 카드(썸네일)를 누르면 **그린 순서대로 다시 재생**한다. 평가하려면 그림을 다시 봐야 하니까
- 표는 기존 `POST …/vote` 를 그대로 쓴다(새 엔드포인트를 만들지 않았다). 응답으로 합계·내 표가 오므로 목록 전체를 다시 부르지 않고 그 카드의 버튼 줄만 다시 그린다
- 안내문에 쓰는 `played`(평가할 수 있는 장수)·`unrated`(아직 표를 안 던진 장수)는 필터와 무관한 전체 기준이라 목록에서 셀 수 없다 → 서버가 함께 내려주고(`GET …/rated`·`GET …/summary`), 표를 던질 때는 생겼는지 없어졌는지에 따라 클라이언트가 숫자를 옮긴다
- 그림이 서버(채널)별로 갈리므로 이 목록도 따라 갈린다 — 퓨전에서 맞힌 그림은 친구방에 들어가 있는 동안에는 평가할 수 없다

### 그림 랭킹 (`GET /api/catchmind/board?sort=likes|dislikes|misses`)
- 세 가지 순서로 준다 — `likes`(추천 많은 순) / `dislikes`(비추천 많은 순) / `misses`(사람들이 많이 틀린 순). `sort` 는 미리 만들어둔 `ORDER BY` 를 키로만 고르게 해서 입력이 SQL 에 끼어들 여지를 없앴다
- **오답 수는 따로 세어두지 않는다.** `catchmind_plays` 에서 `SUM(attempts - solved)` 로 그때그때 합산한다(맞힌 판의 마지막 한 번은 정답이므로 빼준다). 목록이 수십 줄이라 부담이 없고, 컬럼을 늘려 실제 기록과 어긋날 여지를 만들지 않는 쪽을 택했다
- **정답은 내가 이미 끝낸 그림(과 내가 그린 그림)만 실어 보낸다.** 기준이 '맞힘'이 아니라 `catchmind_plays.finished` 인 이유 — 맞혔든 틀렸든 끝냈다면 그 자리에서 정답을 봤으니 목록에서 가릴 이유가 없다. 아직 손대지 않은 그림만 `word: null` 로 내려가고 화면에는 글자 수(`○○○`)만 뜬다
- 그림·추천 수·오답 수·정답 수는 모두에게 보인다. 가리는 것은 제시어 하나뿐이다

### 서버(채널)별 분리
- 그림은 **그린 서버에서만** 출제·랭킹에 나온다(`catchmind_drawings.server_id`, 마이그레이션 5). 퓨전 서버 그림은 퓨전 사람들끼리, 친구방 그림은 친구들끼리
- **그림에만 컬럼을 붙였다.** 풀이(`catchmind_plays`)·추천(`catchmind_votes`)·신고(`catchmind_reports`)는 전부 `drawing_id` 를 타고 달리므로 그림이 갈리면 따라서 갈린다
- 갈리는 지점: 출제(`pickQuiz`)·남은 장수(`remainingCount`)·랭킹(`leaderboard`)·내 그림(`myDrawings`)·홈 요약(`mySummary`), 그리고 제시어 배정의 쏠림 계산(`drawingCounts`)까지. 서버가 다른 그림은 **id 를 알아도** `loadQuiz` 가 404 로 막는다(방과 같은 원칙)
- '내 그림'도 지금 들어와 있는 서버의 것만 보인다 — 목록에 뜨는 조회·정답 수가 그 서버에서 일어난 일과 어긋나지 않게 하려는 것. 따라서 퓨전에서 그린 그림은 친구방에 들어가 있는 동안에는 내릴 수 없다
- **전적은 갈리지 않는다.** 게임 키는 그대로 `catchmind` 하나라 양쪽에서 맞힌 것이 한 줄에 쌓인다
- 분리 이전에 그려둔 그림은 마이그레이션이 전부 `fusion` 으로 몰아준다(친구방은 이때 새로 생긴 서버라 그린 그림이 없다)

### 신고 · 내 그림
- `POST …/report` 신고가 `CATCHMIND_REPORTS_TO_HIDE`(3)회 쌓이면 `hidden = 1` 로 자동 전환되어 출제에서 빠진다(한 사람 1표, `catchmind_reports`)
- 내 그림은 `GET /api/catchmind/mine` 에서 조회수·정답 수와 함께 보고, `DELETE /api/catchmind/drawings/:id` 로 내린다. **삭제가 아니라 `hidden` 플래그**다 — 이미 그 그림을 푼 사람의 전적과 어긋나면 안 되기 때문
- 홈 화면 안내문은 `GET /api/catchmind/summary`(조회 전용)를 쓴다. 홈에서 `/quiz` 를 부르면 그림이 열람 처리되어 버린다

### 화면 (`views/pages/catchmind.pug` + `client/js/catchmind.js`)
- 로비·대기실 믹스인을 쓰지 않고 `#screen-home` / `#screen-draw` / `#screen-quiz` / `#screen-rate` / `#screen-board` / `#screen-mine` 6개 화면을 자체 전환한다. 방이 없으니 채팅도 없다(`hasChat: false` → `base.pug` 가 채팅 믹스인을 빼고 렌더)
- 캔버스 엔진 `createCanvas(el, { interactive })` 하나로 그리기·맞히기 재생·목록 썸네일을 모두 그린다. 획 배열을 들고 있으므로 되돌리기가 공짜이고, `ResizeObserver` 로 크기가 바뀌면 다시 그린다
- 마이그레이션 3의 `hint_votes` · `hint_revealed` 컬럼과 `catchmind_hint_votes` 표는 초성 3인 동의제를 걷어내면서 쓰지 않게 됐다. **이미 배포된 마이그레이션은 고치지 않는 것이 원칙**이라 지우지 않고 남겨두었다(읽지도 쓰지도 않음)
- 이 페이지는 요소를 `hidden` 속성으로 감춘다. `.btn` 처럼 `display` 를 지정한 클래스가 브라우저 기본 `[hidden]` 규칙을 이기므로 `catchmind.scss` 맨 위에 `[hidden] { display: none !important; }` 를 못 박아 뒀다

## 연결 유지 · 재접속 (모바일 절전 / 앱 전환)

휴대폰 화면이 꺼지거나 다른 앱으로 잠깐 넘어가면 브라우저가 얼어붙어 ping에 답하지 못하고 OS가 소켓을 닫는다. 예전에는 그 즉시 `disconnect` → 방에서 제거였기 때문에 돌아오면 판이 사라져 있었다. 세 겹으로 막는다.

1. **잠깐 멈춘 정도로는 끊지 않는다** — `SOCKET_PING_INTERVAL`(25초) / `SOCKET_PING_TIMEOUT`(60초). 세 상수 모두 환경변수(`SOCKET_PING_INTERVAL`·`SOCKET_PING_TIMEOUT`·`RECONNECT_GRACE_MS`)로 조절 가능
2. **연결이 복구되면 그대로 이어붙인다** — Socket.IO `connectionStateRecovery`. 소켓 id·방·놓친 패킷까지 복구된다. 세션 미들웨어를 다시 태워야 하므로 `skipMiddlewares: false`
3. **그래도 끊겼다면 자리를 붙잡아 둔다** — `SOCKET_RECONNECT_GRACE_MS`(90초) 동안 방에서 빼지 않고 `disconnected: true` 표시만 하고 기다린다. 유예가 끝나야 원래의 이탈 처리가 돈다

### 서버 흐름 (`src/shared/reconnect.js` + `registerLeaveFlow`)
- 게임별 socket.js는 `socket.on('disconnect')`를 직접 달지 않고 **이탈 처리 함수 `leaveRoom(id)`를 `registerLeaveFlow(leaveRoom, { immediate, onResume })`에 넘긴다**. `leaveRoom`은 소켓 id를 인자로 받아야 한다(유예 만료 시점에는 소켓이 이미 사라졌으므로 `socket.id`를 쓰면 안 된다)
  - `immediate` — 유예 없이 disconnect 즉시 할 일 (악어의 접속자 위젯 정리 등)
  - `onResume(room, socket)` — 재접속 성공 시 게임별 개인화 상태 재전송 (자모의 `emitGameState`, 테트리스의 상대 보드)
- 자리는 `${네임스페이스}:${cid}`로 관리한다. `cid`는 **브라우저 탭마다 하나씩** 발급돼 `socket.handshake.auth.cid`로 온다 (소켓 id는 재접속 때 바뀌므로 기준이 될 수 없다). `cid`가 없는 클라이언트는 예전처럼 즉시 이탈 처리
- 복귀(`resume_room`)는 `manager.rebind()`로 붙잡아 둔 자리에 새 소켓 id를 연결한다. 이때 `chatHistory`의 `senderId`와 게임별 id 참조(`remapPlayerId`)도 함께 옮겨야 '내 메시지'·폭탄 소유자·현재 차례가 어긋나지 않는다
- **명시적 퇴장(`leave_room`)은 유예 없이 즉시 뺀다.** '나가기'를 눌렀는데 90초간 유령이 남으면 안 되기 때문. `create_room`/`join_room`/`join_as_spectator`도 붙잡아 둔 이전 자리를 먼저 정리한다
- `reapDisconnected`는 `disconnected` 플레이어를 살아 있는 자리로 취급한다 (유예 중인 방이 유령 방으로 지워지면 안 됨)

### 클라이언트 흐름 (`client/js/shared/connection.js`)
- 게임 클라이언트는 `io(ns)` 대신 **`createSocket(ns)` + `initReconnect(socket, ns, { onResumed, onLost })`** 를 쓴다
- 지금 있는 방 코드는 `sessionStorage('pg-room:<ns>')`에 기억한다 → 새로고침이나 탭 복원으로 페이지가 다시 떠도 복귀한다. 복귀할 자리가 없으면 서버가 `resume_failed`를 보내고 클라이언트는 `onLost`로 로비로 돌아간다
- 화면이 돌아오면(`visibilitychange`·`pageshow(persisted)`·`online`) 재접속 백오프를 기다리지 말고 바로 붙는다. **단 최초 연결 중에는 건드리면 안 된다** — 진행 중인 핸드셰이크를 망가뜨려 engine.io가 400(Session ID unknown)을 뱉는다. `everConnected` 플래그로 막는다
- '나가기' 버튼은 `socket.disconnect()/connect()` 대신 `leaveRoom(socket, ns)`를 부른다. 강퇴는 서버가 `socketsLeave`로 방에서 빼주므로 클라이언트가 소켓을 다시 맺을 필요가 없다
- UI: 끊긴 사람은 참가자 목록에 `연결 끊김` 배지(`.badge-offline` + `li.is-offline`), 끊긴 본인에게는 상단 재연결 배너(`#pg-reconnect`), 같은 방 사람들에게는 채팅 시스템 메시지(`member_connection`)

## 모바일 대응
- 레이아웃은 대부분 `max-width` + flex-wrap + `%` 기반으로 유동적. 각 게임 scss에 `@media (max-width: 500px)` 보정, 테트리스는 `@media (pointer: coarse)`로 `#mobile-controls`(터치 버튼) 노출
- 테트리스 보드 셀 크기는 `client/js/tetris.js`의 `calcCellSize()`가 뷰포트 기준으로 계산하고 `resize`에 재계산. 악어 이빨 그리드도 `resize`에 `positionTeethGrid()`로 재배치(회전 대응)
- 전역(_base/_components): 입력창 `font-size:16px`(iOS 포커스 확대 방지), `-webkit-text-size-adjust:100%`, `overscroll-behavior-y:contain`(당겨서 새로고침 방지), `body .screen`/`body .page`에 `min-height:100dvh`(주소창 감안, 미지원 시 100vh 폴백)
- **확대(줌) 차단**: 게임 중 실수로 화면이 확대되면 조작이 어긋나므로 세 겹으로 막는다 — meta viewport의 `maximum-scale=1, user-scalable=no`, `html { touch-action: manipulation }`(더블탭 줌), `client/js/shared/noZoom.js`(iOS는 `user-scalable=no`를 무시하므로 `gesturestart/change/end`·멀티터치·더블탭을 스크립트로 차단). `noZoom.js`는 `base.pug`의 scripts 블록과 `client/index.html`에서 모두 로드한다. 입력 요소(input/textarea/select)의 더블탭은 커서 조작을 위해 그대로 둔다
- `<head>` meta viewport에 `viewport-fit=cover`. 우측 하단 공용 도크(`#pg-dock`)는 `env(safe-area-inset-*)` + `flex-wrap`으로 노치/좁은 화면 대응
- 자모 워들 멀티는 모바일(`≤500px`)에서만 **내 보드를 답 입력 키보드 바로 위**(`#jamo-my-board`)로 분리해 렌더한다. 좁은 화면에서 내가 입력 중인 자모가 다른 참가자 보드에 밀려 안 보이는 문제를 막기 위함. PC에서는 기존대로 내 보드도 `#jamo-boards` 그리드 안에 들어가고 `#jamo-my-board`는 `:empty`로 숨겨진다. 분기는 `jamo.js`의 `mobileLayout` (`matchMedia`, `change`에 재렌더). 모바일에서는 `#jamo-boards`(다른 참가자)를 `max-height:14vh`로 줄여 내 보드+키보드가 한 화면에 들어오게 한다
- **방장·관전자는 입력 UI가 없으므로 레이아웃을 분기한다.** 위 `14vh`/`20vh` 제한은 아래에 내 보드+답 입력 키보드가 오는 참가자 기준이라, 그 둘이 없는 방장·관전자에게 그대로 적용하면 없는 입력창 자리만큼 화면이 비고 참가자 보드만 잘려 보인다 → `renderBoards`가 `#screen-game`에 `is-viewer` 클래스를 토글(`isSpectator || iAmHost`)하고, `jamo.scss`는 `#screen-game:not(.is-viewer)`에만 모바일 높이 제한을 걸고 `is-viewer`에는 `max-height:none`(PC는 `78vh`)로 화면을 다 내준다. 하단 위젯 회피 여백(`--pg-dock-space`)은 방장·관전자에게도 그대로 필요하므로 유지
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
- 이탈 처리는 관전자 먼저 확인, 없으면 플레이어 처리 (`leaveRoom(id)` — socket.id가 아니라 인자로 받은 id를 쓴다)
- `registerLeaveFlow(leaveFn, opts)` — disconnect를 재접속 유예로 감싸고 `leave_room`/`resume_room`을 함께 등록
- `recordPlayers(serverId, game, ...)` / `getRanking(serverId)` / `getPlayerCard(accountId, game, serverId)` — 전적·등급은 언제나 서버(채널)를 함께 받는다
- `broadcastRoomList(io, manager, roomsEvent)` — 방 목록을 서버(채널)별로 갈라 보낸다 (socket 이 없는 타이머 콜백에서도 사용)
- `reapDisconnected(liveIds)` — 방 목록을 낼 때(`get_rooms`/`broadcastRooms`) 해당 네임스페이스에 연결된 소켓만 남기고, 연결이 끊긴 소켓만 있는 유령 방을 삭제. `liveIds`는 네임스페이스의 실제 연결 소켓 집합(기본 ns는 `io.sockets.sockets`, 그 외는 `io.sockets`)
