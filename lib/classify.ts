import type { GroupId, SubId } from "./types";

// 기존 magazinegreen.co.kr 배포본(Webflow 임베드)에서 실전 검증된 분류 규칙을 이식하고,
// 실제 운영 중 확인된 오탐/누락 사례를 바탕으로 계속 보강한다.
// 병원/미용실/카페/종교시설 등은 상호명에 "조경"이 우연히 포함돼도 걸러야 해서 EXCLUDE가 최우선이다.
const EXCLUDE_KEYWORDS = [
  // 농축산/1차산업
  "축산", "한우", "돈사", "양계", "오리", "버섯", "농약", "농기계", "채소", "축구장", "비료", "농자재", "철물점",
  // 의료
  "병원", "의원", "한의원", "치과", "피부과", "정형외과", "내과", "외과", "이비인후과", "안과", "산부인과", "비뇨기과", "정신건강",
  "재활의학과", "신경과", "흉부", "성형외과", "한방", "약국", "동물병원",
  // 미용/휴양
  "미용실", "헤어", "네일", "피부관리", "에스테틱", "마사지", "사우나", "찜질방",
  // 외식/숙박
  "카페", "디저트", "베이커리", "제과", "커피", "음식점", "식당", "분식", "호프", "요리주점", "고깃집", "치킨", "피자", "중국집", "일식", "한식", "한정식", "캠핑장",
  "숙박", "모텔", "펜션", "호텔", "게스트하우스",
  // 종교
  "교회", "성당", "절", "사찰", "성지", "종교",
  // 교육
  "학원", "교습소", "어린이집", "유치원", "과외", "연수원",
  // 전문직/금융/부동산
  "법무", "세무", "회계", "노무사", "변호사", "변리사",
  "은행", "저축은행", "보험", "증권", "대부업",
  "부동산중개", "공인중개사",
  // 자동차
  "자동차정비", "세차", "타이어", "주유소", "폐차장", "폐차",
  // 스포츠/여가시설
  "헬스장", "피트니스", "요가", "필라테스", "골프연습장", "당구장", "볼링장",
  // 주거시설(업체가 아니라 아파트 단지 자체)
  "아파트", "오피스텔", "빌라", "콘도", "주상복합",
  // [신규] 장묘/벌초/묘역 관리 — 조경과 무관한 별개 업종
  "벌초", "이장", "납골당", "공원묘원", "묘지", "산소관리",
  // [신규] 중장비/장비 임대 — 시공 역량 없는 단순 장비 대여
  "포크레인", "굴삭기", "중장비",
  // [신규] 건축 기초 골재/단순 채석 — 조경 시설물 시공이 아닌 원자재 유통
  "골재", "쇄석", "채석장",
  // [신규] 청소/방역/관리사무소 — 조경 소독만 대행하거나 조경과 무관한 시설관리
  "청소", "방역", "소독", "물탱크", "관리사무소", "입주자대표",
  // [신규] 단순 꽃집 — 조경·정원·플랜테리어 시공/스타일링이 아닌 절화·화환 소매
  "화환", "절화",
];

const DESIGN_KEYWORDS = ["설계", "엔지니어링", "디자인", "계획", "건축사", "랜드스케이프"];
const CONSTRUCTION_KEYWORDS = ["시공", "건설", "식재", "시설물", "공사", "개발", "환경", "포장"];

// [신규] "유지관리" 서브카테고리(SUB_DEFS.company의 "maintenance") — 필터 칩엔 있었지만 이
// 키워드 목록 자체가 코드에 없어서 실제로는 단 한 업체도 이 카테고리로 분류될 수 없었다(죽은
// 필터). 전정·전지·수목관리 등 관리형 서비스를 전문으로 하는 업체를 여기로 분류한다.
const MAINTENANCE_KEYWORDS = ["유지관리", "전정", "전지", "수목관리", "정원관리", "잔디관리", "가지치기"];

// [신규] "플랜테리어" 서브카테고리(SUB_DEFS.company의 "trendy") — 역시 매칭되는 키워드가 전혀
// 없어서 죽어있던 필터였다. 벽면녹화/실내조경/식물 스타일링 등 플랜테리어 전문 업체를 분류한다.
const TRENDY_KEYWORDS = ["플랜테리어", "그린인테리어", "식물스타일링", "벽면녹화", "수직정원", "그린월", "실내조경", "가드닝"];

// "가든"과 뜻이 같은 순우리말 "정원"이 빠져 있어 "OO정원"류 업체가 통째로 누락되던 문제를 포함해
// 계속 보강 중인 목록.
const NURSERY_KEYWORDS = ["농원", "농장", "수목", "묘목", "원예", "화훼", "야생화", "가든", "정원", "종묘", "식물"];
const SUPPLY_KEYWORDS = ["석재", "잔디", "자재"];

export const CATEGORY_LIKE_TERMS = [
  "조경",
  ...DESIGN_KEYWORDS,
  ...CONSTRUCTION_KEYWORDS,
  ...MAINTENANCE_KEYWORDS,
  ...TRENDY_KEYWORDS,
  ...NURSERY_KEYWORDS,
  ...SUPPLY_KEYWORDS,
];

// ["조경"/"정원"은 이 서비스 자체의 주제이자 최상위 우산(umbrella) 검색어] 사용자가 이 두
// 단어로 검색하면 "관련 있는 건 다 보여달라"는 의도로 봐야 한다. 그래서 이름·카테고리에 그
// 글자가 그대로 없어도(예: 카카오 카테고리가 "인테리어"로만 잡힌 플랜테리어 업체) classifyBiz가
// 이미 긍정 분류한 업체라면 통과시킨다. 반대로 "잔디"/"석재"/"시공"처럼 더 좁고 구체적인
// 카테고리성 단어는 기존처럼 엄격하게(카테고리 텍스트에 그 단어가 실제로 있어야) 유지한다 —
// 안 그러면 "잔디"로 검색했는데 잔디와 전혀 무관한 설계사무소까지 다 뜨게 된다.
export const UMBRELLA_SEARCH_TERMS = ["조경", "정원"];

// [최종 안전망] 예전 대량 수집 당시 D1/Supabase에 이미 잘못 분류돼 들어간 병원·주유소·아파트·펜션 등이
// 있을 수 있다. 실시간 분류(classifyBiz)를 거치지 않는 DB 조회 결과에도 이 체크를 마지막에 한 번 더
// 적용해, 소스가 무엇이든 상관없이 명백히 무관한 업종은 절대 노출되지 않도록 한다.
export function isExcludedName(name: string): boolean {
  return EXCLUDE_KEYWORDS.some((k) => name.includes(k));
}

// [분류 우선순위] 제외 → 관리(전정 등 고신뢰 특화 서비스) → 플랜테리어 → 설계 → 시공 → 자재 →
// 농원/정원 → "조경" 포함 시 일반 조경회사. 관리/플랜테리어를 설계·시공보다 먼저 검사하는 이유는,
// 상호에 "조경"이 같이 들어있어도(예: "OO조경 유지관리") 실제 주업인 서브카테고리로 정확히
// 보내기 위해서다.
export function classifyBiz(text: string): { group: GroupId; sub: SubId } | null {
  if (EXCLUDE_KEYWORDS.some((k) => text.includes(k))) return null;
  if (MAINTENANCE_KEYWORDS.some((k) => text.includes(k))) return { group: "company", sub: "maintenance" };
  if (TRENDY_KEYWORDS.some((k) => text.includes(k))) return { group: "company", sub: "trendy" };
  if (DESIGN_KEYWORDS.some((k) => text.includes(k))) return { group: "company", sub: "design" };
  if (CONSTRUCTION_KEYWORDS.some((k) => text.includes(k))) return { group: "company", sub: "construction" };
  if (SUPPLY_KEYWORDS.some((k) => text.includes(k))) return { group: "material", sub: "supply" };
  if (NURSERY_KEYWORDS.some((k) => text.includes(k))) return { group: "material", sub: "nursery" };
  if (text.includes("조경")) return { group: "company", sub: "general" };
  return null;
}

// "조경" 같은 업종 카테고리성 검색어는 업체명에 없어도 카카오 업종 분류에 포함되면 인정.
// "그람디자인"처럼 특정 상호명 검색은 정확히 이름에 포함될 때만 인정(과도하게 넓어지는 것 방지).
export function matchesSearch(name: string, categoryText: string, term: string): boolean {
  if (!term) return true;
  if (name.includes(term)) return true;
  if (CATEGORY_LIKE_TERMS.includes(term) && categoryText.includes(term)) return true;
  return false;
}
