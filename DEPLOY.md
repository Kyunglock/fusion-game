# 배포 가이드 (Docker 이미지 + Tailscale VPN)

CI 가 GitHub 클라우드 러너에서 이미지를 빌드해 **GHCR**에 push 하고,
**Tailscale VPN** 을 통해 홈서버에 SSH 접속해 이미지를 pull·재배포한다.
홈서버의 SSH 포트를 인터넷에 열지 않는다(tailnet 내부에서만 접근).

## 전체 흐름

```
지수짱 PR ─▶ 주인이 main 머지 승인 ─▶ push:main 트리거
   └─▶ [클라우드 러너] 빌드·테스트 ─▶ docker build ─▶ GHCR push
        └─▶ Tailscale 접속 ─▶ (tailnet) SSH ─▶ 홈서버: docker compose pull & up
```

## 최초 1회 준비

### 1) 홈서버
```bash
# 앱 디렉터리
sudo mkdir -p /srv/fusion-game && cd /srv/fusion-game

# 이 저장소의 docker-compose.yml 을 여기에 복사해 둔다.

# 서버 전용 .env 생성 (저장소·이미지에는 절대 넣지 않음)
cat > .env <<'EOF'
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 로 생성>
PORT=4000
EOF
chmod 600 .env

# Docker / compose 플러그인 설치 후, Tailscale 설치·로그인
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

배포 전용 유저(예: `deploy`)를 만들고 docker 그룹에 넣기를 권장한다(루트 배포 지양).

### 2) Tailscale (관리 콘솔)
- **OAuth client** 발급: Settings → OAuth clients → `Devices: write` 스코프, 태그 `tag:ci`
- **ACL** 에서 `tag:ci` 가 홈서버의 SSH(22) 로 접근 가능하도록 허용
  ```jsonc
  "acls": [
    { "action": "accept", "src": ["tag:ci"], "dst": ["<home-server-tag-or-ip>:22"] }
  ]
  ```

### 3) GitHub → Settings → Secrets and variables → Actions
| Secret | 설명 |
|---|---|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client id |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret |
| `SSH_HOST` | 홈서버의 tailnet IP 또는 MagicDNS 이름 |
| `SSH_USER` | 배포 유저 (예: `deploy`) |
| `SSH_KEY` | 배포 유저의 SSH **개인키** 전체 |
| `SSH_FINGERPRINT` | 홈서버 호스트 키 지문 (`ssh-keyscan -t ed25519 <host>` 결과의 지문). 중간자 공격 방지 |

> GHCR 로그인은 워크플로우의 `GITHUB_TOKEN`(packages:write)으로 처리되므로 별도 시크릿이 없다.
> GHCR 패키지가 private 여도 CI 실행 중 발급된 토큰으로 홈서버에서 pull 된다.

### 4) 저장소 거버넌스 (권한 있는 사람도 직접 push 금지)
- `main` 브랜치 보호: **Require a pull request** + **Require review from Code Owners**(CODEOWNERS) + **Do not allow bypassing**
- 배포 승인 게이트가 필요하면 Environment `production` 에 **Required reviewers** 설정

## 매 배포
1. 지수짱이 feature 브랜치 → PR
2. 주인이 CODEOWNERS 리뷰 후 `main` 머지
3. 자동으로 빌드·이미지 push·홈서버 배포 진행
4. Actions 로그에서 성공/실패 확인. 실패 시 홈서버는 이전 이미지 그대로 유지

## 롤백
특정 커밋으로 되돌리려면 홈서버에서:
```bash
cd /srv/fusion-game
IMAGE_TAG=<되돌릴-커밋-SHA> docker compose up -d
```
