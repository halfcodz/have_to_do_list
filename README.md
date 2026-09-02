# 좋됨감지앱

오늘 **반드시** 해야 할 일만 적는 have-to-do 리스트. 마감 시각을 정하면 1시간 / 30분 / 10분 전에
개빡친 개구리가 나타나 다그치고, 마감을 넘기면 완료 체크할 때까지 3분마다 주먹질하러 온다.

## 특징

- **완전 로컬**: 모든 데이터는 브라우저 `localStorage`에만 저장. 서버·계정·네트워크 요청 없음.
- **PWA**: 홈 화면에 설치 가능, 오프라인 동작.
- **미완료 이월**: 오늘 못 끝낸 일은 다음 날 목록에 자동으로 남는다.
- 빌드 도구·프레임워크 없음. 정적 파일뿐.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 앱 전체 (마크업 + CSS + JS 인라인) |
| `manifest.webmanifest` | PWA 설치 정보 |
| `sw.js` | Service Worker (오프라인 캐시, 배포 시 자동 갱신) |
| `assets/` | 앱 아이콘 |
| `worry.png` `doubt.png` `anxiety.png` `punch-2.png` | 알람 화면 이미지 |

## 로컬 실행

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`index.html`을 직접 열어도(`file://`) 리스트·알람은 동작하지만, Service Worker와 알림은
`localhost` 또는 HTTPS에서만 작동한다.

## 배포

정적 호스팅에 루트로 올리면 끝. `main`에 push하면 Cloudflare Pages가 자동 배포한다.
빌드 명령 없음, 출력 디렉터리 `/`.

## 데이터 백업

앱 하단 **백업** 영역에서 JSON 내보내기 / 가져오기. 기기 변경이나 도메인 이전 시 사용.
