import type { Metadata } from "next";

// app/admin/layout.tsx가 /admin 전체에 "가든 핀 등록" 제목을 걸어 둬서, 그대로 두면 이 페이지도
// 브라우저 탭에 그 제목이 뜬다. 이 라우트만 따로 덮어쓴다(Next.js는 더 깊은 세그먼트의 metadata를
// 우선한다).
export const metadata: Metadata = {
  title: "견적 리드 관리 | GARDEN MAP",
  description: "지도·기사·프로젝트·채널그린에서 들어온 견적 요청을 관리합니다.",
};

export default function AdminLeadsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
