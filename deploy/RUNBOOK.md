# 배포 셋업 런북 — fusion-game CI/CD

main 머지 → GitHub Actions(임시 러너)에서 빌드·테스트·이미지 push → Tailscale VPN
경유 SSH로 홈서버 접속 → 이미지 pull + `docker compose up -d`.

```
 git push main
      │
      ▼
┌─────────────────────────┐   build job (ubuntu-latest, 임시 VM)
│ npm ci → build:css → test│──▶ GHCR push  ghcr.io/kyunglock/fusion-game:<sha>, :latest
└─────────────────────────┘
      │  (environment: production 승인 게이트)
      ▼
┌─────────────────────────┐   deploy job
│ tailscale up (tag:ci)   │──▶ SSH(tailnet) ──▶ 홈서버
│                         │        compose pull → up -d → prune
└─────────────────────────┘
                                   Cloudflare ▶ nginx(8443 TLS) ▶ app(4000)
```

준비는 **A. 홈서버 → B. Tailscale 관리콘솔 → C. GitHub → D. 첫 배포 검증** 순서로 한다.

---

## A. 홈서버 준비

### A-1. 필수 패키지 설치
```bash
# Docker + compose 플러그인
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"      # 재로그인 필요

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
```

### A-2. Tailscale 로그인 (태그 부여)
```bash
sudo tailscale up --ssh=false --advertise-tags=tag:homeserver
```
- `tag:homeserver`는 B-1의 ACL `tagOwners`에 먼저 등록돼 있어야 붙는다.
- MagicDNS 이름 확인: `tailscale status` → `<호스트명>.<tailnet>.ts.net`. 이게 `SSH_HOST` 후보.

### A-3. 배포 전용 사용자 + SSH 키
CI가 쓸 최소 권한 계정을 따로 판다(root 직접 접속 금지).
```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy

# CI용 키페어를 로컬(내 PC)에서 생성 — 개인키는 GitHub Secret으로, 공개키만 서버에
ssh-keygen -t ed25519 -f ./ci_deploy -N "" -C "github-actions"

# 공개키를 홈서버 deploy 계정에 등록
sudo -u deploy mkdir -p /home/deploy/.ssh && sudo -u deploy chmod 700 /home/deploy/.ssh
# ci_deploy.pub 내용을 아래 파일에 추가
sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys < ci_deploy.pub
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```
> `ci_deploy`(개인키) → `SSH_KEY` Secret. `ci_deploy.pub`은 서버에만. 등록 후 로컬 사본은 안전히 폐기.

### A-4. sshd를 tailnet에만 노출 (권장)
공인 IP에 22번을 열지 않는다. `/etc/ssh/sshd_config.d/tailnet.conf`:
```
ListenAddress 100.x.y.z        # tailscale status 로 확인한 이 서버의 tailnet IP
PasswordAuthentication no
PermitRootLogin no
```
```bash
sudo systemctl restart ssh
```

### A-5. 배포 디렉토리 구성
compose 파일 기준 상대경로가 `./deploy/...` 이므로 **디렉토리 구조 그대로** 둔다.
```
/srv/fusion-game/
├── docker-compose.yml        # 레포의 docker-compose.yml
├── .env                      # 서버에만 존재 (아래)
└── deploy/
    ├── nginx.conf
    └── certs/
        ├── origin.crt
        └── origin.key        # chmod 600
```
```bash
sudo mkdir -p /srv/fusion-game/deploy/certs
sudo chown -R deploy:deploy /srv/fusion-game
# 레포에서 docker-compose.yml, deploy/nginx.conf 를 위 구조로 복사
```
> **certs는 레포에 없다**(개인키라 gitignore 처리됨). origin.crt/origin.key 는 홈서버에서
> 직접 생성/배치한다. self-signed 예시:
> ```bash
> sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
>   -keyout /srv/fusion-game/deploy/certs/origin.key \
>   -out    /srv/fusion-game/deploy/certs/origin.crt \
>   -subj "/CN=fusion-game"
> sudo chmod 600 /srv/fusion-game/deploy/certs/origin.key
> ```
> Cloudflare는 SSL **Full**(non-strict)이라 origin 인증서 유효성을 검증하지 않아 이걸로 충분.

### A-6. `.env` 작성 (레포·이미지에 절대 커밋 금지)
```bash
sudo -u deploy tee /srv/fusion-game/.env >/dev/null <<'EOF'
SESSION_SECRET=<openssl rand -hex 32 로 생성한 값>
PORT=4000
NODE_ENV=production
EOF
sudo chmod 600 /srv/fusion-game/.env
```

### A-7. 호스트 키 지문 추출 (중간자 방지)
`SSH_FINGERPRINT` Secret에 넣을 값. 로컬에서:
```bash
ssh-keyscan -t ed25519 <SSH_HOST> | ssh-keygen -lf -
# 출력 예: 256 SHA256:AbCd... <host> (ED25519)
# → "SHA256:AbCd..." 부분을 그대로 사용
```

---

## B. Tailscale 관리 콘솔 (admin console)

### B-1. ACL 정책 (Access Controls)
러너(`tag:ci`)가 홈서버 22번만 닿도록 최소 권한으로 제한한다.
```jsonc
{
  "tagOwners": {
    "tag:ci":         ["autogroup:admin"],
    "tag:homeserver": ["autogroup:admin"]
  },
  "acls": [
    // CI 러너는 홈서버 SSH(22)만 허용. 그 외 tailnet 접근 없음.
    { "action": "accept", "src": ["tag:ci"], "dst": ["tag:homeserver:22"] }
    // (기존 개인 기기 ↔ 홈서버 규칙이 있으면 그대로 유지)
  ]
}
```

### B-2. OAuth 클라이언트 발급 (Settings → OAuth clients)
- **Scopes**: `Devices → write` (auth key 발급용)
- **Tags**: `tag:ci`
- 발급된 `Client ID` → `TS_OAUTH_CLIENT_ID`, `Client secret` → `TS_OAUTH_SECRET`
- `tailscale/github-action`이 이 OAuth로 매 실행마다 **ephemeral 노드**를 만들고 job 종료 시 자동 삭제한다.

---

## C. GitHub 설정

### C-1. Secrets (Settings → Secrets and variables → Actions)
| 이름 | 값 |
|---|---|
| `TS_OAUTH_CLIENT_ID` | B-2 Client ID |
| `TS_OAUTH_SECRET` | B-2 Client secret |
| `SSH_HOST` | 홈서버 MagicDNS 이름 또는 tailnet IP (A-2) |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | `ci_deploy` **개인키 전체** (`-----BEGIN...` 포함) |
| `SSH_FINGERPRINT` | `SHA256:...` (A-7) |

### C-2. Environment (Settings → Environments)
- `production` 환경 생성.
- **Required reviewers**에 본인 추가 → deploy job이 홈서버에 손대기 직전 수동 승인 게이트가 걸린다. (build/push는 승인 없이 먼저 돌고, 배포만 막힘)
- 이게 "머지 후에도 배포는 한 번 더 확인" 하는 안전장치. 필요 없으면 environment만 만들고 reviewers는 비워도 됨.

### C-3. GHCR pull 권한
- 홈서버는 워크플로우 실행 중 발급되는 `GITHUB_TOKEN`으로 GHCR에 로그인해 pull한다(deploy.yml에 이미 구현). **서버에 별도 PAT 저장 불필요.**
- 첫 push 후 패키지는 repo에 연결된 private가 기본. 그대로 두면 된다.

---

## D. 첫 배포 & 검증

### D-1. 워크플로우 가드 확인
`.github/workflows/deploy.yml`의 `github.repository == 'Kyunglock/fusion-game'`가 실제 레포와 일치해야 job이 돈다(불일치 시 조용히 skip).

### D-2. 실행
1. main에 머지(또는 Actions 탭에서 `workflow_dispatch` 수동 실행).
2. **build** job: `npm ci → build:css → test(스킵) → GHCR push` 통과 확인.
3. **deploy** job: `production` 승인 대기 → 승인 → Tailscale 연결 → SSH 배포 로그 확인.

### D-3. 홈서버에서 상태 확인
```bash
cd /srv/fusion-game
docker compose ps            # app(healthy) + nginx(running)
docker compose logs -f app
curl -k https://127.0.0.1:8443/   # nginx → app 프록시 응답 확인
```

### D-4. 외부 경로
Cloudflare(SSL **Full**) → origin `:8443`. 공유기에서 8443 포워딩하거나 `cloudflared`
터널을 쓴다. 터널을 쓰면 compose의 nginx publish를 `127.0.0.1:8443:8443`으로 좁힐 수 있다.

---

## 트러블슈팅

| 증상 | 원인/조치 |
|---|---|
| deploy job이 SSH에서 timeout | ACL(B-1)에서 `tag:ci → tag:homeserver:22` 누락, 또는 sshd `ListenAddress`가 tailnet IP가 아님 |
| `Host key verification failed` | `SSH_FINGERPRINT` 불일치 — A-7 재추출 |
| `docker login` denied (홈서버) | GHCR 패키지 접근권 문제. repo 연결 확인, 또는 패키지를 public으로 |
| nginx `host not found in upstream fusion-game` | 두 서비스가 같은 `web` 네트워크인지 확인 (compose 최신본 사용) |
| app 계속 unhealthy | `.env`의 PORT와 healthcheck/nginx의 4000 일치 확인, `docker compose logs app` |
| job이 아예 안 뜸 | D-1 레포명 가드, 또는 push가 main 브랜치가 맞는지 |
