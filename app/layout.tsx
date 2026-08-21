import type { Metadata, Viewport } from "next";
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
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
