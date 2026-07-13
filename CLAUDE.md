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

## 파일 구조
```
src/
  shared/
    roomManager.js      ← 범용 방 관리 팩토리 (createRoomManager)
    socketHandlers.js   ← 공통 소켓 핸들러 등록 (registerCommonHandlers)
  game/{crocodile,bomb,tetris}/
    rooms.js            ← createRoomManager() 호출 + 게임별 설정/함수
    socket.js           ← registerCommonHandlers() + 게임 고유 핸들러만

views/
  layouts/base.pug      ← 공통 HTML head, script, 채팅 포함
  mixins/
    lobby.pug           ← +lobby() 로비 화면
    waiting.pug         ← +waitingRoom() 대기실
    chat.pug            ← 채팅 패널 + FAB
    overlays.pug        ← +aloneOverlay(), +resultOverlay(), +spectatorGame
  pages/
    crocodile.pug       ← extends base + 게임 고유 UI
    bomb.pug
    tetris.pug

client/
  js/
    shared/
      screenManager.js  ← showScreen(), $() 헬퍼
      chatManager.js    ← 채팅 전체 (initChat, setChatVisible, appendChatMessage)
      lobbyRenderer.js  ← renderRoomList, renderSpectatorList, renderWaiting
      uiHelpers.js      ← triggerFlash, triggerShake, 카운트다운, aloneOverlay
      authCheck.js      ← /api/me 호출 + 세션 정보 표시
    crocodile.js        ← 게임 고유 로직 (이빨 렌더링, 턴 타이머)
    bomb.js             ← 게임 고유 로직 (폭탄 패스, 위험 표시)
    tetris.js           ← 테트리스 엔진 + 게임 고유 UI
    utils.js            ← escHtml, showError
  partials/
    crocodile-svg.html  ← 악어 SVG (서버에서 읽어 Pug 변수로 주입)
  scss/{crocodile,bomb,tetris}.scss  ← @use 'components' 공통 임포트
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
- 기존 정적 HTML 파일은 제거 가능 (Pug로 대체됨)

## 관전 시스템
- 방 생성 시 `allowSpectators: true` 기본값
- 로비에서 방장이 토글 가능 (`toggle_spectator_allowed` 이벤트)
- 게임 중인 방에 `join_as_spectator`로 입장 → `spectate_start` 수신
- 관전자는 `spectators[]` 배열에 별도 저장 (players[]와 분리)
- CSS 클래스 `is-spectating` (악어/폭탄) 또는 `spectating` (테트리스) 로 인터랙션 비활성화
- `member_joined` 이벤트 → 채팅 시스템 메시지로 표시 (`chat-system-msg`)
- 방 목록에 게임 중인 방도 표시 (관전 허용된 것만)

## 채팅
- 플레이어 + 관전자 모두 채팅 가능
- 아바타 없는 유저는 `playerAvatarEmojis` Map으로 임시 이모지 부여
  - 악어/폭탄: `['🐊','🦁','🐸','🦊']`
  - 테트리스: `['🟦','🟧','🟥','🟩']`

## 테트리스 — 멀티플레이어 규칙
- 최소 2명, 최대 4명
- **콤보 시스템**: 연속으로 라인 클리어 시 콤보 증가, 실패 시 초기화
  - 콤보별 쓰레기 줄: 1→0, 2→1, 3→1, 4→2, 5→2, 6→3, 7→3, 8→4, 9→4, 10+→5
  - 1~2콤보: 효과 없음 (클라이언트에서 표시 없음)
  - 3콤보 이상: 보드 위 콤보 카운터 표시 (녹색→노랑→빨강)
- **홀드 (좌측 Ctrl)**: 현재 블럭을 보관, 다시 불러오기 가능 (한 블럭당 1회)
- 탈락자는 보드 페이드, 마지막 1명이 우승
- 관전자는 보드·컨트롤 숨김 (`#screen-game.spectating`)

## CSS 빌드
```bash
npm run build:css   # SCSS → CSS 컴파일 (변경 시 반드시 실행)
```

## 중요 패턴
- `createRoomManager(config)` — 게임별 방 관리를 config 주입으로 통합
- `registerCommonHandlers(io, socket, manager, opts)` — 8개 공통 소켓 핸들러 일괄 등록
- `safeState(room)` — 클라이언트에 보내는 직렬화된 방 상태 (순환참조 제거)
- `getRoomOf(socketId)` — socketId로 플레이어가 있는 방 찾기
- `getRoomOfSpectator(socketId)` — socketId로 관전자가 있는 방 찾기
- disconnect 시 관전자 먼저 확인, 없으면 플레이어 처리
