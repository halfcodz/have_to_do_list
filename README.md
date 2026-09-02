# 좋됨감지앱

오늘 **반드시** 해야 할 일과, **안 하면 벌어지는 일**을 적는 have-to-do 리스트.
마감 1시간 / 30분 / 10분 전에 개빡친 개구리가 나타나 다그치고, 마감을 넘기면
완료 체크(했어) 하거나 못 했다고 인정(못 했어)할 때까지 3분마다 주먹질하러 온다.

## 특징

- **완전 로컬**: 모든 일정과 기록은 브라우저 `localStorage`에만 저장. 계정·서버 없음.
- **PWA**: 홈 화면에 설치 가능, 오프라인 동작.
- **결과를 적어야 함**: 할 일 + 마감 시각 + "안 하면?" 세 가지를 모두 채워야 추가된다.
- **미완료 이월**: 오늘 못 끝낸 일은 다음 날 목록에 자동으로 남는다.
- **지난 일정**: 완료(해냄)·포기(못 함)한 일이 날짜별로 쌓이고 달성률을 보여준다.
- **(선택) 앱 꺼도 알림**: `push-worker/` 를 Cloudflare에 배포하면 앱을 완전히 종료해도 폰으로 푸시.
- 빌드 도구·프레임워크 없음. 정적 파일뿐.

## 구조

| 경로 | 역할 |
|---|---|
| `index.html` | 앱 전체 (마크업 + CSS + JS 인라인) |
| `manifest.webmanifest` | PWA 설치 정보 |
| `sw.js` | Service Worker (오프라인 캐시 + 푸시 알림 표시) |
| `assets/` | 앱 아이콘 |
| `worry.png` `doubt.png` `anxiety.png` `punch-2.png` | 알람 화면 이미지 |
| `push-worker/` | (선택) 앱을 꺼도 알림을 보내는 Cloudflare Worker + 배포 가이드 |

## 로컬 실행

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`index.html`을 직접 열어도(`file://`) 리스트·알람은 동작하지만, Service Worker와
알림은 `localhost` 또는 HTTPS에서만 작동한다.

## 배포

정적 호스팅에 루트로 올리면 끝. `main`에 push하면 자동 배포된다.
빌드 명령 없음, 출력 디렉터리 `/`. `sw.js` 의 `VERSION` 문자열을 올리면 캐시가 갱신된다.

## 앱을 꺼도 오는 알림

`push-worker/README.md` 참고. 요약:

1. `cd push-worker && node genkeys.mjs` 로 VAPID 키 생성
2. `npx wrangler login` → `npx wrangler secret put VAPID_JWK` → `npx wrangler deploy`
3. `index.html` 상단의 `PUSH_API`, `VAPID_PUBLIC_KEY` 두 상수를 채우고 push
4. 폰에 앱을 설치하고 알림 권한 허용

설정하지 않으면 앱이 열려 있을 때의 알람만 동작한다 (기능 자체는 그대로).
