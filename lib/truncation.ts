/**
 * lib/truncation.ts
 * ------------------------------------------------------------------------
 * 서버(/bizdb-v2)는 한 번에 최대 limit(500)건만 내려주고, 조건에 맞는 전체 수를 total 로 함께 준다.
 * 예전에는 이 total 을 버려서 500건을 넘는 지역에서 업체가 말없이 빠져도 화면은 알 수 없었다
 * (서울 중심 확대 화면: 조경회사 604곳 중 500곳만 표시). 여기서는 「못 받은 건수」를 계산하고
 * 화면에 보여 줄 안내 문구를 만든다. React·네트워크에 의존하지 않는 순수 함수라서 단독으로 시험한다.
 */

export interface PageCount {
  /** 서버가 알려 준 조건에 맞는 전체 건수 */
  total: number;
  /** 실제로 받은 행 수(좌표 필터 등을 거치기 전) */
  fetched: number;
}

/** 여러 조회(조경회사·자재 등)에서 limit 때문에 받지 못한 행의 합. 음수는 0 으로 본다. */
export function countMissing(pages: PageCount[]): number {
  return pages.reduce((sum, p) => sum + Math.max(0, p.total - p.fetched), 0);
}

/** 「약 N곳」으로 보여 줄 때 쓰는 값: 10 미만은 그대로, 그 이상은 10 단위로 반올림한다. */
export function approxCount(n: number): number {
  return n < 10 ? n : Math.round(n / 10) * 10;
}

/** 지도 탐색(화면 영역 조회) 모드의 안내. 못 받은 게 없으면 null. */
export function browseNotice(missing: number): string | null {
  if (!(missing > 0)) return null;
  const more = missing < 10 ? "몇 곳이" : `약 ${approxCount(missing).toLocaleString("ko-KR")}곳이`;
  return `이 영역에는 지금 보이는 곳 말고도 ${more} 더 있어요. 지도를 확대하면 더 보여요.`;
}

/** 검색 모드의 안내. 검색은 서버 쪽 필터와 클라이언트 쪽 필터가 섞여 정확한 개수를 말할 수 없어 숫자는 쓰지 않는다. */
export function searchNotice(missing: number): string | null {
  if (!(missing > 0)) return null;
  return "검색 결과가 많아 일부만 보여요. 지역을 고르거나 검색어를 더 구체적으로 입력해 보세요.";
}
