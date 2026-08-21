# 정원·조경 지도 (Garden Map) — Next.js 프로덕션 앱

magazinegreen.co.kr(Webflow) 배포본과 동일한 백엔드(Cloudflare Worker + Supabase)를 그대로 사용하는
Next.js 14 / TypeScript / Tailwind / Zustand / TanStack Query / Framer Motion 기반 지도 앱입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

http://localhost:3000 에서 확인.

## Vercel 배포 (3분)

1. 이 폴더를 GitHub 저장소로 올립니다.
   ```bash
   git init
   git add .
   git commit -m "init"
   git remote add origin <새로 만든 깃허브 저장소 주소>
   git push -u origin main
   ```
2. https://vercel.com 에서 "Add New... → Project" → 방금 올린 저장소 선택 → Import.
3. 프레임워크는 Next.js로 자동 감지됩니다. 별도 환경변수 설정 없이 바로 "Deploy" 누르면 됩니다
   (API 키들은 코드에 이미 포함되어 있음 — 기존 Webflow 배포본과 동일한 방식).
4. 배포가 끝나면 `https://프로젝트명.vercel.app` 같은 주소가 생깁니다.

## ⚠️ 배포 후 반드시 해야 할 것: 카카오 개발자 콘솔에 새 도메인 등록

카카오맵 JS SDK는 **등록된 도메인에서만** 동작합니다. 지금 쓰는 앱키(b6ccb52c66e30ecdb1b781cf75283988)는
magazinegreen.co.kr 용으로 등록되어 있어서, 그대로 두면 새 Vercel 주소에서는 지도가 "인증 실패"로 안 뜹니다.

1. https://developers.kakao.com → 내 애플리케이션 → 해당 앱 선택
2. 앱 설정 → 플랫폼 → Web 플랫폼에 새 Vercel 도메인 추가
   (예: `https://프로젝트명.vercel.app`, 커스텀 도메인을 쓸 거면 그 주소도 같이 추가)
3. 저장하면 몇 분 안에 적용됩니다.

## Webflow에 iframe으로 임베드하기

Webflow 페이지의 원하는 위치에 Embed 요소를 추가하고 아래 코드를 넣으면 됩니다.

```html
<iframe
  src="https://프로젝트명.vercel.app"
  style="width:100%; height:100vh; border:0;"
  loading="lazy"
></iframe>
```

## 아키텍처 메모

- **지도 렌더링**: Deck.gl 대신 카카오 네이티브 Marker + MarkerClusterer 사용
  (이유는 `components/MapCanvas.tsx` 상단 주석 참고 — 카카오맵은 Deck.gl이 필요로 하는 WebGL 훅을 공개하지 않음).
- **백엔드**: 새로 만들지 않고 기존 Cloudflare Worker(`nongsaro-proxy.chgreena.workers.dev`)와
  Supabase(`wxfvhsmelfffpxcktlnt.supabase.co`)를 그대로 재사용.
- **디자인 토큰**: `app/globals.css`에 딥 블루(#06107D)/네온 옐로우(#E1FC48) 컬러 시스템과
  마이크로 타이포그래피 스케일(`.tp-title`, `.tp-body`, `.tp-caption`, `.tp-cta`) 정의.
