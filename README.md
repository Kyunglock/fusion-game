# 파티 게임즈

친구들과 함께 실시간으로 즐기는 파티 게임 모음입니다. 방을 만들고 코드로 초대해서 바로 플레이할 수 있습니다.

## 게임 목록

| 게임 | 설명 | 경로 |
|---|---|---|
| 🐊 악어 이빨 뽑기 | 함정 이빨을 피하며 살아남기 | `/crocodile` |
| 💣 폭탄 돌리기 | 터지기 전에 얼른 옆 사람에게 넘기기 | `/bomb` |
| 🧱 테트리스 배틀 | 줄을 지우면 상대에게 쓰레기 줄 전송 | `/tetris` |
| 🔤 자모 워들 | 방장이 낸 제시어를 자모 단위로 맞히기 | `/jamo` |

## 기술 스택

- **백엔드**: Node.js + Express + Socket.IO
- **프론트엔드**: Vanilla JS (ES Modules), SCSS → CSS 빌드
- **뷰 엔진**: Pug (서버사이드 렌더링)
- **세션**: express-session (DB 없이 세션에만 닉네임/아바타 저장, 서버 재시작 시 초기화됨)

## 시작하기

### 1. 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.sample`을 복사해서 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.sample .env
```

| 변수 | 필수 | 설명 |
|---|---|---|
| `SESSION_SECRET` | ✅ | 세션 서명용 비밀 키. 아래 명령으로 랜덤 값을 생성해 채워주세요. |
| `PORT` | ❌ | 서버 포트. 비워두면 `4000`번을 사용합니다. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. 실행

```bash
npm run dev     # 개발 모드 (서버 + SCSS 감시, 자동 재시작)
npm start        # 프로덕션 모드 (CSS 빌드 후 서버 실행)
npm run build:css  # SCSS → CSS만 빌드
```

기본적으로 `http://localhost:4000`에서 접속할 수 있습니다.

## 프로젝트 구조

```
src/
  shared/            공통 방 관리(roomManager)·소켓 핸들러(socketHandlers)
  game/{crocodile,bomb,tetris,jamo}/  게임별 방 상태(rooms.js) + 소켓 로직(socket.js)
  routes/            REST API (인증)
  config.js          게임별 설정 상수

views/               Pug 템플릿 (레이아웃 + 게임별 페이지 + 공통 mixin)

client/
  js/                게임별 클라이언트 로직 + 공통 모듈(client/js/shared)
  scss/              게임별 스타일 + 공통 컴포넌트
```

각 게임은 `createRoomManager()`로 방 상태를 만들고 `registerCommonHandlers()`로 로비/대기실/채팅/관전 등 공통 소켓 이벤트를 등록한 뒤, 게임 고유 로직만 추가로 구현하는 구조입니다. 더 자세한 아키텍처 설명은 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 주요 기능

- 방 생성/참가, 준비(ready) 시스템, 강퇴
- 관전 모드 (방장이 허용 시 진행 중인 방도 관전 가능)
- 실시간 채팅 (플레이어 + 관전자)
- 아바타 업로드, 닉네임 변경
