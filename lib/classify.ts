import type { GroupId, SubId } from "./types";

// 기존 magazinegreen.co.kr 배포본(Webflow 임베드)에서 실전 검증된 분류 규칙을 그대로 이식한다.
// 병원/미용실/카페/종교시설 등은 상호명에 "조경"이 우연히 포함돼도 걸러야 해서 EXCLUDE가 최우선이다.
const EXCLUDE_KEYWORDS = [
  "축산", "한우", "돈사", "양계", "오리", "버섯", "농약", "농기계", "채소", "축구장",
  "병원", "의원", "한의원", "치과", "피부과", "정형외과", "내과", "외과", "이비인후과", "안과", "산부인과", "비뇨기과", "정신건강",
  "재활의학과", "신경과", "흉부", "성형외과", "한방", "약국", "동물병원",
  "미용실", "헤어", "네일", "피부관리", "에스테틱", "마사지", "사우나", "찜질방",
  "카페", "디저트", "베이커리", "제과", "커피", "음식점", "식당", "분식", "호프", "요리주점", "고깃집", "치킨", "피자", "중국집", "일식", "한식",
  "교회", "성당", "절", "사찰", "성지", "종교",
  "학원", "교습소", "어린이집", "유치원", "과외", "연수원",
  "법무", "세무", "회계", "노무사", "변호사", "변리사",
  "은행", "저축은행", "보험", "증권", "대부업",
  "부동산중개", "공인중개사",
  "숙박", "모텔", "펜션", "호텔", "게스트하우스",
  "자동차정비", "세차", "타이어", "주유소", "폐차장", "폐차",
  "헬스장", "피트니스", "요가", "필라테스", "골프연습장", "당구장", "볼링장",
  "아파트", "오피스텔", "빌라", "콘도", "주상복합",
];
const DESIGN_KEYWORDS = ["설계", "엔지니어링", "디자인", "계획", "건축사", "랜드스케이프"];
const CONSTRUCTION_KEYWORDS = ["시공", "건설", "식재", "시설물", "공사", "개발", "환경", "포장"];
const NURSERY_KEYWORDS = ["농원", "농장", "수목", "묘목", "원예", "화훼", "야생화", "가든", "종묘", "식물"];
const SUPPLY_KEYWORDS = ["석재", "잔디", "자재"];

export const CATEGORY_LIKE_TERMS = ["조경", ...DESIGN_KEYWORDS, ...CONSTRUCTION_KEYWORDS, ...NURSERY_KEYWORDS, ...SUPPLY_KEYWORDS];

// [최종 안전망] 예전 대량 수집 당시 D1/Supabase에 이미 잘못 분류돼 들어간 병원·주유소·아파트·펜션 등이
// 있을 수 있다. 실시간 분류(classifyBiz)를 거치지 않는 DB 조회 결과에도 이 체크를 마지막에 한 번 더
// 적용해, 소스가 무엇이든 상관없이 명백히 무관한 업종은 절대 노출되지 않도록 한다.
export function isExcludedName(name: string): boolean {
  return EXCLUDE_KEYWORDS.some((k) => name.includes(k));
}

export function classifyBiz(text: string): { group: GroupId; sub: SubId } | null {
  if (EXCLUDE_KEYWORDS.some((k) => text.includes(k))) return null;
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
