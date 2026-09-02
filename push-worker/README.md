# 좋됨감지앱 푸시 서버

앱을 **완전히 꺼도** 마감 60/30/10분 전과 마감 초과 시 폰으로 알림이 오게 하는
Cloudflare Worker. 전부 무료 티어 안에서 돌아간다.

- 할 일 **내용은 계속 이 기기(localStorage)에만** 저장된다.
- 서버에 올라가는 것: 푸시 구독 정보 + `알림 시각·문구`뿐. 마감이 지나거나 완료하면 앱이 다시 동기화해서 지운다.
- 외부 라이브러리 없음. `wrangler deploy` 한 번이면 끝.

---

## 준비물

- Cloudflare 계정 (무료)
- Node 18+ 설치

## 1. VAPID 키 생성

```bash
cd push-worker
node genkeys.mjs
```

출력이 두 개 나온다:
- **VAPID_JWK** — 아래 3번에서 secret으로 넣음
- **VAPID_PUBLIC_KEY** — 아래 5번에서 앱에 붙여넣음

두 값을 안전한 곳에 복사해 둔다.

## 2. Wrangler 로그인

```bash
npx wrangler login
```

브라우저가 열리면 Cloudflare 계정으로 승인.

## 3. VAPID 비밀키 등록

```bash
npx wrangler secret put VAPID_JWK
```

프롬프트에 **1번의 VAPID_JWK 한 줄**(`{"kty":"EC",...}`)을 그대로 붙여넣고 Enter.

*(선택)* `wrangler.toml` 의 `VAPID_SUBJECT` 를 본인 이메일로 바꿔도 된다. 안 바꿔도 동작.

## 4. 배포

```bash
npx wrangler deploy
```

끝나면 URL이 나온다 → `https://jotdoem-push.<계정>.workers.dev`
이 주소를 복사.

> 처음 배포 시 Durable Object + Cron 이 자동 생성된다. 무료 플랜에서 SQLite 기반 DO와 Cron 모두 사용 가능.

## 5. 앱에 연결

리포지토리 루트 `index.html` 상단의 두 상수를 채운다:

```js
var PUSH_API = "https://jotdoem-push.<계정>.workers.dev";   // 4번 URL
var VAPID_PUBLIC_KEY = "여기에 1번의 VAPID_PUBLIC_KEY";
```

커밋 & 푸시하면 Pages(또는 GitHub Pages)가 재배포된다.

```bash
git add index.html
git commit -m "푸시 서버 연결"
git push
```

## 6. 폰에서 확인

1. 폰에서 앱을 **홈 화면에 설치** (iOS는 설치형 PWA에서만 푸시 허용, iOS 16.4+)
2. 앱 열고 일정 하나 추가 → 알림 권한 **허용**
3. 마감을 **2분 뒤**로 잡고, 앱과 브라우저를 **완전히 종료**
4. 잠시 뒤 폰에 알림이 오면 성공

---

## 동작 방식

```
앱(추가/완료/삭제) ──POST /sync──▶ Worker(Durable Object)
                                    │  reminders를 저장하고
                                    │  가장 이른 시각으로 setAlarm()
                                    ▼
                          alarm() 발화 → 해당 시각 도달분에 대해
                          RFC 8291 aes128gcm + RFC 8292 VAPID 로
                          Web Push 직접 생성 → 푸시 서비스로 전송
                                    ▼
                          Service Worker 'push' 이벤트 → 알림 표시
```

- `test/roundtrip.mjs` — 암복호화·서명 로직이 규격에 맞는지 검증 (`npm test`).
- Cron `*/5 * * * *` 은 놓친 alarm 보정용 안전망.
- 만료된 구독(410/404)은 자동 삭제.

## 비용

개인 사용 기준 무료 티어의 1% 미만.
- Worker 요청: 하루 수십~수백 건 (무료 10만/일)
- Durable Object: 무료 티어 내
- Cron: 5분 간격 (무료)
