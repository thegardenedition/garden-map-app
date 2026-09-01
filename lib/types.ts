// [데이터 스키마]
// 사양의 payload 예시를 그대로 반영하되, 조경회사/조경수·자재/공원·수목원 세 그룹을 통합 처리할 수 있도록
// categoryDepth1(그룹)과 categoryDepth2(서브카테고리)를 유지한다.

export type GroupId = "company" | "material" | "park";

export type SubId =
  | "design"
  | "construction"
  | "maintenance"
  | "trendy"
  | "general"
  | "nursery"
  | "supply"
  | "city_park"
  | "natural_park"
  | "garden";

export interface Place {
  placeId: string;
  categoryDepth1: GroupId;
  categoryDepth2: SubId;
  placeName: string;
  address: string;
  contact: string | null;
  coordinates: [number, number]; // [lng, lat] — 스펙 payload 순서를 그대로 따름
  homepage: string | null;
  homepageDirect: string | null; // 네이버 검색으로 이미 확보된 링크면 추가 조회 없이 바로 사용
  source: "kakao" | "tourapi";
  distanceM: number | null; // 내 주변 찾기(반경 검색)일 때만 채워짐
  usetime?: string | null;
  restdate?: string | null;
  parking?: string | null;
}

export const GROUP_LABEL: Record<GroupId, string> = {
  company: "조경회사",
  material: "조경수/자재",
  park: "공원/수목원",
};

export const GROUP_ICON: Record<GroupId, string> = {
  company: "🏢",
  material: "🌱",
  park: "🏞",
};

export const SUB_DEFS: Record<GroupId, { id: SubId; label: string; icon: string }[]> = {
  company: [
    { id: "design", label: "조경설계", icon: "📐" },
    { id: "construction", label: "조경시공", icon: "🚧" },
    { id: "maintenance", label: "유지관리", icon: "🌿" },
    { id: "trendy", label: "공간연출/플랜테리어", icon: "🪴" },
    { id: "general", label: "조경종합", icon: "🌳" },
  ],
  material: [
    { id: "nursery", label: "조경수/농원", icon: "🌱" },
    { id: "supply", label: "자재/잔디/석재", icon: "🧱" },
  ],
  park: [
    { id: "city_park", label: "도시공원", icon: "🏞" },
    { id: "natural_park", label: "자연공원", icon: "⛰" },
    { id: "garden", label: "수목원/정원", icon: "🌷" },
  ],
};

export const REGION_LIST = [
  "전국", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;
export type Region = (typeof REGION_LIST)[number];

export type SheetSnap = "peek" | "half" | "full";

// [프로젝트 연동] 채널그린 프로젝트 사이트(project.magazinegreen.co.kr)의 게시글을 지도 위에
// 항상 표시되는 별도 레이어로 얹는다. 기존 조경회사/자재/공원 taxonomy(GroupId)와는 성격이
// 달라서(검색으로 필터링되지 않고, 클릭하면 우리 상세 시트가 아니라 외부 게시글로 바로 이동)
// 굳이 같은 분류 체계에 억지로 끼워 넣지 않고 독립된 타입으로 둔다.
export interface ProjectPin {
  slug: string;
  title: string;
  category: string;
  location: string;
  lat: number;
  lng: number;
  thumbnail: string;
  url: string;
}
