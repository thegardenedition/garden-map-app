import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "가든 핀 등록 | GARDEN MAP",
  description: "지도에 장소를 손쉽게 등록하는 관리자 도구",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
