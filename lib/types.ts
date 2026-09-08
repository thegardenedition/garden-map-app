// [데이터 스키마]
// 사양의 payload 예시를 그대로 반영하되, 조경회사/조경수·자재/공원·수목원 세 그룹을 통합 처리할 수 있도록
// categoryDepth1(그룹)과 categoryDepth2(서브카테고리)를 유지한다.

export type GroupId = "company" | "material" | "park";

export type SubId =
  | "design"
  // [조경설계 vs 종합엔지니어링] 한국엔지니어링협회 대장에 조경 전문분야로 신고된 1,296곳 중
  // 465곳만 조경 전담이고, 831곳은 도로·철도·구조 같은 분야를 함께 신고한 종합엔지니어링사다.
  // 둘 다 법적으로 조경 엔지니어링을 할 수 있지만 "조경설계사무소를 찾는" 사용자에게는 전혀
  // 다른 정보라 서브카테고리를 나눴다. 워커가 company_type 을 보고 sub 를 갈라서 내려준다.
  | "engineering"
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
  // registry = 한국수목원정원관리원 대장(수목원 70 + 정원 80). 외부 조회 없이 자체 필드로
  // 상세를 채우므로 카카오/투어API 후속 요청을 걸지 않는다.
  source: "kakao" | "tourapi" | "registry";
  distanceM: number | null; // 내 주변 찾기(반경 검색)일 때만 채워짐
  usetime?: string | null;
  restdate?: string | null;
  parking?: string | null;
  // 아래 셋은 대장에만 있는 값이다. 투어API는 입장료·반려동물 동반 여부를 내려주지 않는다.
  fees?: { adult?: number; youth?: number; child?: number; disabled?: number };
  petAllowed?: boolean;
  species?: string[]; // 봄·여름·가을·겨울 대표 수종
}

export const GROUP_LABEL: Record<GroupId, string> = {
  company: "조경회사",
  material: "조경수/자재",
  park: "공원/수목원",
};

// [아이콘] 이모지를 전부 도려냈다. 이모지는 스스로 색을 가져 핀의 그룹 색과 충돌하고,
// OS마다 다른 그림으로 렌더되어 통제할 수 없었다. 같은 규격의 벡터 11개를 lib/icons.tsx 에
// 한 번만 정의해 지도·칩·목록·상세가 같은 그림을 공유한다. 여기엔 id와 label만 남긴다.
// browsable: false 는 "필터 칩으로 내걸지는 않지만 라벨은 필요한" 소분류를 뜻한다.
// 목록·상세는 SUB_DEFS 에서 라벨을 찾아 쓰므로 항목 자체를 지우면 배지가 빈칸이 된다.
export const SUB_DEFS: Record<GroupId, { id: SubId; label: string; browsable?: boolean }[]> = {
  company: [
    { id: "design", label: "조경설계" },
    { id: "engineering", label: "종합엔지니어링" },
    { id: "construction", label: "조경시공" },
    { id: "maintenance", label: "유지관리" },
    { id: "trendy", label: "공간연출/플랜테리어" },
    // [칩에서 뺀 이유] "조경종합"은 대장에서 온 분류가 아니라 classifyBiz 의 마지막 폴백이다 —
    // 이름에 "조경"은 있는데 설계·시공·관리·플랜테리어 어디에도 안 걸리는 카카오/네이버 검색
    // 결과를 담으려고 만든 자리다. 그래서 D1(garden_biz_v2)에는 general 행이 단 한 건도 없고
    // (2026-09-08 확인: construction 2857 / maintenance 510 / trendy 287 / design 102), 기본
    // 탐색 모드에서 이 칩을 누르면 지도가 항상 비어버렸다. 검색 모드에서만 값이 생기는 칩을
    // 다른 소분류와 나란히 두는 건 거짓말이라 칩에서 뺀다. 분류값 자체는 살아 있어서 general 로
    // 잡힌 검색 결과는 "조경회사" 안에 그대로 나오고, 목록·상세 배지도 "조경종합"으로 찍힌다.
    // 나중에 대장에 general 행이 실제로 들어오면 browsable 을 지워 칩을 되살리면 된다.
    { id: "general", label: "조경종합", browsable: false },
  ],
  material: [
    { id: "nursery", label: "조경수/농원" },
    { id: "supply", label: "자재/잔디/석재" },
  ],
  park: [
    { id: "city_park", label: "도시공원" },
    { id: "natural_park", label: "자연공원" },
    { id: "garden", label: "수목원/정원" },
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
