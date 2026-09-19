import type { Metadata, Viewport } from "next";
import { MotionConfig } from "framer-motion";
import QueryProvider from "@/components/QueryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "정원·조경 지도 | GARDEN MAP",
  description: "지역과 검색어로 조경회사·조경수/자재·공원/수목원을 한번에 찾는 지도",
};

// [모바일 퍼스트] 확대/축소를 막아 네이티브 앱처럼 느껴지도록, notch 안전영역까지 고려
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#06107D",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="h-full">
        {/* [reduced-motion — 2026-09-19] globals.css의 CSS 미디어쿼리는 animation/transition
            "속성"만 짧게 만든다. Framer Motion 애니메이션은 그 속성을 쓰지 않고 자체 엔진으로
            움직이므로 그 규칙이 안 먹는다. reducedMotion="user"는 OS의 "동작 줄이기" 설정을
            Framer Motion 쪽에서 직접 확인해, 켜져 있으면 모든 motion 애니메이션(바텀시트·상세
            시트·필터 칩·플로팅 버튼)을 즉시 전환으로 바꾼다 — 도감 사이트와 같은 원칙. */}
        <MotionConfig reducedMotion="user">
          <QueryProvider>{children}</QueryProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
