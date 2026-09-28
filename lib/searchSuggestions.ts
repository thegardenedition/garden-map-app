import { GROUP_LABEL, SUB_DEFS } from "./types";

/**
 * lib/searchSuggestions.ts
 * ------------------------------------------------------------------------
 * 검색창 자동완성 — 호갱노노의 계층적 자동완성(행정동→단지→역→학교)을 벤치마킹했지만,
 * 이 앱은 실시간 업체명 DB가 없어(카카오/투어API를 그때그때 프록시) 실제 업체명까지
 * 자동완성하려면 검색 API를 추가로 호출해야 한다. 1차 범위는 그 비용 없이 프론트엔드
 * 데이터만으로 완결되는 두 가지로 좁힌다: 고정 카테고리 키워드 + 사용자의 최근 검색어
 * (최근 검색어는 TopBar·Sidebar가 같이 보는 상태라 lib/store.ts의 recentSearches에 둔다).
 */

const ALL_CATEGORY_LABELS: string[] = [
  ...Object.values(GROUP_LABEL),
  ...Object.values(SUB_DEFS).flatMap((defs) => defs.map((d) => d.label)),
];

/** query를 포함하는 카테고리 라벨만 반환한다. query가 비어 있으면 카테고리는 보여줄 필요가
 *  없다(검색어를 아직 안 쳤는데 전체 카테고리를 다 늘어놓으면 목록만 길어질 뿐이다). */
export function getCategorySuggestions(query: string): string[] {
  const q = query.trim().replace(/\s+/g, "").toLowerCase();
  if (!q) return [];
  return ALL_CATEGORY_LABELS.filter((label) => label.replace(/\s+/g, "").toLowerCase().includes(q));
}
