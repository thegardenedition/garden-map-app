import type { GroupId, Place, ProjectPin, Region, SubId } from "./types";
import { CATEGORY_LIKE_TERMS, UMBRELLA_SEARCH_TERMS, classifyBiz, isExcludedName, matchesSearch } from "./classify";
import parkRegistryRaw from "./park-registry.json";

// [네트워크 회복탄력성]
// 이 앱은 magazinegreen.co.kr(Webflow) 배포본과 동일한 백엔드를 그대로 재사용한다.
// - Cloudflare Worker: 카카오/네이버 로컬 검색, 국문 관광정보(TourAPI 공원) 프록시,
//   그리고 자체 업체 대장(D1 garden_biz_v2, 전국 6,829건) — 지역·이름·반경 조회를 모두 담당한다.
// 별도 백엔드를 새로 만들지 않고 기존 인프라를 그대로 소비하는 것이 이번 아키텍처의 핵심 결정이다.
//
// [Supabase 제거] 예전에는 "내 주변에서 찾기"만 Supabase PostGIS RPC 를 따로 호출했다. 그런데
// 그 테이블(garden_biz)에는 100행밖에 없고 전부 서울이라, 서울 밖 사용자에게는 항상 0건이었다.
// 같은 데이터가 D1 에 전국 규모로 있으므로 원천을 하나로 합쳤다. 이제 anon key 도 필요 없다.
const WORKER_BASE = "https://nongsaro-proxy.chgreena.workers.dev";

// 상태코드를 들고 다니는 오류. 예전에는 `new Error("HTTP 429")` 로 던져서 재시도할지 말지를
// 판단할 근거가 문자열밖에 없었다. 상태를 필드로 들고 있으면 아래 isRetriableError 와
// TanStack Query 양쪽이 같은 기준으로 판단할 수 있다. Error 를 상속하므로 기존 catch 는 그대로다.
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

/*
 * [4xx 는 다시 보내지 않는다]
 *
 * 2026-09-09 이전에는 상태코드를 가리지 않고 재시도했다. 그런데 워커에 출처 게이트(403)와
 * IP 당 요청 한도(429)가 생기면서 그게 곧바로 문제가 됐다. 아래 재시도 3회와 TanStack Query
 * 의 retry 3회가 곱해져, 429 를 맞은 사용자가 요청을 1번이 아니라 최대 9번 보냈다.
 * 한도를 넘긴 사람이 한도를 더 밀어붙이는 구조였고, 실패를 확정하기까지 8초 넘게 걸렸다.
 *
 * 429 는 서버가 "그만 보내라"고 말하는 것이므로 재시도가 정확히 반대 행동이다. 403 은 다시
 * 보내도 영원히 같다. 반면 5xx 와 네트워크 오류는 진짜 일시적일 수 있으므로 그대로 재시도한다.
 */
export function isRetriableError(err: unknown): boolean {
  if (err instanceof HttpError) return err.status >= 500;
  return true; // 네트워크 오류·타임아웃 등 상태코드가 없는 실패
}

async function fetchWithRetry(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  // [TanStack Query와 별개의 저수준 재시도]
  // 지수 백오프(Exponential Backoff): 300ms → 900ms. 네트워크 계층(타임아웃/일시적 장애)만
  // 담당한다. 위 주석대로 4xx 는 여기서 즉시 포기하고 올려 보낸다 — Query 쪽 retry 도 같은
  // 기준(isRetriableError)을 쓰므로 두 층이 곱해지지 않는다.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new HttpError(res.status);
      return res;
    } catch (err) {
      lastErr = err;
      if (!isRetriableError(err)) throw err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
    }
  }
  throw lastErr;
}

function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]*>/g, "");
}

interface KakaoDoc {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  y: string;
  x: string;
  phone: string;
  place_url: string;
  category_name: string;
}

async function fetchKakaoCombined(region: Region, keyword: string): Promise<KakaoDoc[]> {
  const q = region !== "전국" ? region : "";
  const params = new URLSearchParams({ region: q, keywords: keyword });
  const res = await fetchWithRetry(`${WORKER_BASE}/kakao-search?${params}`);
  const data = await res.json();
  return data?.results ?? [];
}

function mapKakaoDoc(doc: KakaoDoc, group: GroupId, sub: SubId): Place {
  return {
    placeId: `kakao-${doc.id}`,
    categoryDepth1: group,
    categoryDepth2: sub,
    placeName: doc.place_name || "",
    address: doc.road_address_name || doc.address_name || "",
    contact: doc.phone || null,
    coordinates: [parseFloat(doc.x), parseFloat(doc.y)],
    homepage: doc.place_url || null,
    homepageDirect: null,
    source: "kakao",
    distanceM: null,
  };
}

interface NaverDoc {
  title: string;
  category: string;
  roadAddress: string;
  address: string;
  telephone: string;
  link: string;
  mapx: string;
  mapy: string;
}

async function fetchNaverIndependent(region: Region, keyword: string): Promise<Place[]> {
  const q = region !== "전국" ? `${region} ${keyword}` : keyword;
  const params = new URLSearchParams({ query: q, display: "30", sort: "random" });
  const res = await fetchWithRetry(`${WORKER_BASE}/naver-search?${params}`);
  const data = await res.json();
  const docs: NaverDoc[] = data?.items ?? [];
  const out: Place[] = [];
  const isUmbrellaSearch = UMBRELLA_SEARCH_TERMS.includes(keyword);
  for (const d of docs) {
    const name = stripHtml(d.title || "");
    const category = d.category || "";
    if (isExcludedName(name) || isExcludedName(category)) continue;
    const cls = classifyBiz(`${name} ${category}`);
    if (!cls) continue;
    if (!isUmbrellaSearch && !matchesSearch(name, category, keyword)) continue;
    const lat = parseFloat(d.mapy) / 10000000;
    const lng = parseFloat(d.mapx) / 10000000;
    if (!lat || !lng) continue;
    const link = d.link || "";
    const homepageDirect = link && !link.includes("naver.com") ? link : null;
    out.push({
      placeId: `naver-${name}-${d.address}`,
      categoryDepth1: cls.group,
      categoryDepth2: cls.sub,
      placeName: name,
      address: d.roadAddress || d.address || "",
      contact: d.telephone || null,
      coordinates: [lng, lat],
      homepage: null,
      homepageDirect,
      source: "kakao",
      distanceM: null,
    });
  }
  return out;
}

interface BizV2Row {
  id: number;
  name: string;
  addr: string;
  lat: string;
  lng: string;
  tel: string;
  homepage: string;
  category_path: string;
  grp: GroupId;
  sub: SubId;
  region: string;
  distance_m?: number;
}

interface BizV2Query {
  region?: Region;
  group?: GroupId;
  sub?: SubId;
  /** 상호 부분검색. 서버에서 걸러 내려주므로 1,000건을 받아 브라우저에서 거르지 않아도 된다. */
  q?: string;
  /** 반경 검색. 지정하면 결과가 거리순으로 정렬되고 distanceM 이 채워진다. */
  near?: { lat: number; lng: number; radiusKm: number };
  /** 지도 화면 영역 검색. [minLng, minLat, maxLng, maxLat] */
  bbox?: Bbox;
  limit?: number;
}

/** [minLng, minLat, maxLng, maxLat] */
export type Bbox = [number, number, number, number];

// [자체 대장 조회] 워커의 /bizdb-v2 는 전국 6,829건(garden_biz_v2)을 담고 있다.
// 예전에는 region+group 만 넘길 수 있었고 서버가 LIMIT 1000 을 정렬 없이 잘라서,
// "전국"으로 조회하면 수집 순서상 앞쪽인 서울·부산·대구만 나오고 전남·충남·강원·제주 등은
// 통째로 빠졌다(경기도조차 928건 중 92건만). 이제 서버가 지역순으로 안정 정렬하고
// total 을 함께 돌려주며, 반경/이름 검색도 서버에서 처리한다.
async function fetchBizV2(query: BizV2Query): Promise<Place[]> {
  const params = new URLSearchParams();
  if (query.region) params.set("region", query.region);
  if (query.group) params.set("group", query.group);
  if (query.sub) params.set("sub", query.sub);
  if (query.q) params.set("q", query.q);
  if (query.near) params.set("near", `${query.near.lat},${query.near.lng},${query.near.radiusKm}`);
  if (query.bbox) params.set("bbox", query.bbox.join(","));
  params.set("limit", String(query.limit ?? 500));

  const res = await fetchWithRetry(`${WORKER_BASE}/bizdb-v2?${params}`);
  const data = await res.json();
  const rows: BizV2Row[] = data?.results ?? [];
  return rows
    .filter((r) => parseFloat(String(r.lat)) && parseFloat(String(r.lng)))
    .map((r) => ({
      placeId: `v2-${r.id}`,
      categoryDepth1: r.grp,
      categoryDepth2: r.sub,
      placeName: r.name || "",
      address: r.addr || "",
      contact: r.tel || null,
      coordinates: [parseFloat(String(r.lng)), parseFloat(String(r.lat))],
      homepage: r.homepage || null,
      homepageDirect: null,
      source: "kakao" as const,
      distanceM: typeof r.distance_m === "number" ? r.distance_m : null,
    }));
}

// [카테고리 탐색] 검색어 없이 카테고리만으로 목록을 여는 경로.
// 예전에는 카테고리 칩이 "이미 검색된 결과를 사후 필터링"하는 역할뿐이라, 검색어를 넣지 않으면
// 칩을 눌러도 화면이 비어 있었다. 조경회사/자재는 우리 대장에 다 있으므로 검색어 없이도 바로 연다.
// 카테고리 칩만 눌렀거나(그룹 지정), 아무것도 안 눌렀지만 지도가 축소돼 있을 때(그룹 null)의 조회.
// 서버가 시도별로 균등하게 잘라서 내려주므로 전국 분포가 한눈에 보인다.
export async function browseByCategory(
  region: Region,
  group: GroupId | null,
  sub: SubId | null
): Promise<Place[]> {
  if (group === "park") return searchParks("", true);
  const groups: GroupId[] = group ? [group] : ["company", "material"];
  const lists = await Promise.all(
    groups.map((g) => fetchBizV2({ region, group: g, sub: sub ?? undefined, limit: 500 }))
  );
  return lists.flat().filter((p) => !isExcludedName(p.placeName));
}

// [뷰포트 조회] 지도에 실제로 보이는 영역만 가져온다.
//
// 왜 필요한가: 지역 단위 조회는 아무리 균등 분배를 해도 결국 표본이다. 전국 조경회사 3,141건을
// 500건으로 잘라 시도별 30건씩 보여주면, 사용자가 자기 동네를 확대해도 그 동네 업체가 30건 중
// 하나로만 남아 "우리 동네엔 왜 없냐"가 된다. 화면 영역으로 조회하면 확대할수록 그 안의 업체가
// 전부 나온다 — 실측으로 서울 도심 46건, 경기남부 474건, 제주 89건이 잘림 없이 다 온다.
//
// [공원은 명시적으로 고를 때만] 공원/수목원은 TourAPI 쪽이라 서버 bbox 필터가 없고, 전국 목록을
// 받으려면 코드 11종 x 페이지를 훑는 대량 팬아웃이 한 번 필요하다. 이걸 기본 탐색에 섞으면
// 지도를 켜자마자 수십 번의 요청이 나가므로, "공원/수목원" 칩을 직접 눌렀을 때만 불러온다.
// 그때는 세션 캐시(fetchAllParks)를 화면 영역으로 거르기만 하면 되므로 이후 비용이 없다.
export async function browseByBbox(bbox: Bbox, group: GroupId | null, sub: SubId | null): Promise<Place[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const inBox = (p: Place) =>
    p.coordinates[0] >= minLng &&
    p.coordinates[0] <= maxLng &&
    p.coordinates[1] >= minLat &&
    p.coordinates[1] <= maxLat;

  if (group === "park") {
    const all = await fetchAllParks();
    return all.filter(inBox);
  }

  const groups: GroupId[] = group ? [group] : ["company", "material"];
  const lists = await Promise.all(
    groups.map((g) => fetchBizV2({ bbox, group: g, sub: sub ?? undefined, limit: 500 }))
  );
  return mergeDedup(lists.flat().filter((p) => !isExcludedName(p.placeName)));
}

const PARK_SUB_CODES: Record<string, string[]> = {
  city_park: ["VE030100", "VE030200", "VE030300", "VE030400", "VE030500"],
  natural_park: ["NA040100", "NA040200", "NA040300", "NA040400", "NA040600"],
  garden: ["NA040700"],
};

interface TourItem {
  contentid: string;
  title: string;
  addr1: string;
  addr2: string;
  mapx: string;
  mapy: string;
  tel: string;
}

async function fetchOnePage(code: string, pageNo: number): Promise<{ items: TourItem[]; totalCount: number }> {
  const params = new URLSearchParams({
    numOfRows: "100", pageNo: String(pageNo), arrange: "C", contentTypeId: "12",
    lclsSystm1: code.slice(0, 2), lclsSystm2: code.slice(0, 4), lclsSystm3: code,
  });
  try {
    const res = await fetchWithRetry(`${WORKER_BASE}/tourapi/areaBasedList2?${params}`);
    const data = await res.json();
    const body = data?.response?.body;
    let items = body?.items?.item ?? [];
    if (!Array.isArray(items)) items = items ? [items] : [];
    return { items, totalCount: body?.totalCount ?? 0 };
  } catch {
    return { items: [], totalCount: 0 };
  }
}

// [속도 개선] 예전엔 1페이지→2페이지→3페이지... 순서대로 하나씩 응답을 기다린 뒤에야 다음 페이지를
// 요청했다. TourAPI는 1페이지 응답에 이미 전체 개수(totalCount)를 함께 내려주므로, 1페이지만 먼저
// 받아서 총 몇 페이지가 필요한지 계산한 다음 나머지 페이지는 한꺼번에 병렬로 요청한다. 예를 들어
// 5페이지가 필요한 카테고리라면 예전엔 요청 5번을 순서대로 기다렸지만, 이제는 1번(1페이지) + 1번
// (2~5페이지 동시) — 총 2번만 기다리면 된다. 페이지가 많이 필요한 카테고리(자연공원 등)일수록
// 체감 속도 개선폭이 크다. 가져오는 데이터 양과 MAX_PAGES 상한은 이전과 동일 — 순서만 바꿨다.
async function fetchOneCode(code: string): Promise<TourItem[]> {
  const MAX_PAGES = 8;
  const first = await fetchOnePage(code, 1);

  if (first.items.length !== 100 || first.totalCount <= 100) {
    return first.items;
  }

  const totalPages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / 100));
  if (totalPages <= 1) return first.items;

  const restPageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const restResults = await Promise.all(restPageNumbers.map((pageNo) => fetchOnePage(code, pageNo)));

  return [first.items, ...restResults.map((r) => r.items)].flat();
}

/*
 * [수목원·정원 대장]
 * 공원 레이어는 원래 한국관광공사 TourAPI 하나만 봤다. 관광 분류라 "정원"으로 묶인 1,300여 곳을
 * 폭넓게 주지만, 입장료·휴관일·반려동물 동반 가능 여부처럼 실제로 찾아가기 전에 알아야 하는
 * 값은 내려주지 않는다. 한국수목원정원관리원 대장(수목원 70 + 정원 80)은 그 값들을 갖고 있고
 * 좌표도 이미 붙어 있어 지오코딩이 필요 없다.
 *
 * 그래서 다른 대장들과 같은 방식으로 융합한다 — 대장을 먼저 깔고, 이름이나 위치가 겹치는
 * TourAPI 항목은 버린다(대장 우선). 겹치지 않는 TourAPI 항목은 그대로 남는다.
 * 대조해 보니 150곳 중 80곳은 TourAPI 에도 있고 70곳은 대장에만 있다(수목원 14 + 정원 56).
 */
interface RegistryPark {
  id: string; name: string; kind: "arboretum" | "garden";
  addr: string; region: string; lat: number; lng: number;
  tel?: string; homepage?: string; restdate?: string; pet?: boolean;
  free?: boolean; fees?: { adult?: number; youth?: number; child?: number; disabled?: number };
  species?: string[];
}

function registryParks(): Place[] {
  return (parkRegistryRaw as RegistryPark[]).map((r) => ({
    placeId: `reg-${r.id}`,
    categoryDepth1: "park" as const,
    categoryDepth2: "garden" as const,
    placeName: r.name,
    address: r.addr,
    contact: r.tel ?? null,
    coordinates: [r.lng, r.lat] as [number, number],
    homepage: r.homepage ?? null,
    // 대장이 홈페이지를 갖고 있으므로 네이버에 다시 물어볼 필요가 없다.
    homepageDirect: r.homepage ?? null,
    source: "registry" as const,
    distanceM: null,
    restdate: r.restdate ?? null,
    fees: r.fees,
    petAllowed: r.pet,
    species: r.species,
  }));
}

// 이름 표기가 조금씩 다르다("정남진수목원" vs "정남진 수목원", "화담숲" vs "곤지암수목원(화담숲)").
// 괄호·공백·가운뎃점을 털어낸 뒤 비교하고, 그래도 안 걸리면 300m 안에서 한쪽 이름이 다른 쪽에
// 포함되는지를 본다. 순수 거리만으로 지우면 한 공원 안의 별개 시설까지 함께 사라진다.
function normalizePlaceName(name: string): string {
  return (name || "").replace(/\(.*?\)|\[.*?\]/g, "").replace(/[\s·・,'"\-—–_/]/g, "");
}
function metersApart(a: Place, b: Place): number {
  const dLat = (a.coordinates[1] - b.coordinates[1]) * 111_000;
  const dLng = (a.coordinates[0] - b.coordinates[0]) * 88_000;
  return Math.hypot(dLat, dLng);
}
function isSamePark(a: Place, b: Place): boolean {
  const na = normalizePlaceName(a.placeName);
  const nb = normalizePlaceName(b.placeName);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return metersApart(a, b) < 300 && (na.includes(nb) || nb.includes(na));
}

let parkCache: Place[] | null = null;
async function fetchAllParks(): Promise<Place[]> {
  if (parkCache) return parkCache;
  const subKeys = Object.keys(PARK_SUB_CODES) as ("city_park" | "natural_park" | "garden")[];
  const bySub = await Promise.all(
    subKeys.map(async (sub) => {
      const results = await Promise.all(PARK_SUB_CODES[sub].map(fetchOneCode));
      return results.flat().map((it) => {
        const lat = parseFloat(it.mapy);
        const lng = parseFloat(it.mapx);
        const addr = `${it.addr1 || ""} ${it.addr2 || ""}`.trim();
        const place: Place = {
          placeId: `tour-${it.contentid}`,
          categoryDepth1: "park",
          categoryDepth2: sub,
          placeName: it.title || "",
          address: addr,
          contact: it.tel || null,
          coordinates: [lng, lat],
          homepage: null,
          homepageDirect: null,
          source: "tourapi",
          distanceM: null,
        };
        return place;
      });
    })
  );
  const all = bySub.flat();
  const seen = new Set<string>();
  const tour = all.filter((p) => {
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return Boolean(p.coordinates[0] && p.coordinates[1]);
  });

  const registry = registryParks();
  const tourOnly = tour.filter((t) => !registry.some((r) => isSamePark(r, t)));
  parkCache = [...registry, ...tourOnly];
  return parkCache;
}

function dedupKey(p: Place): string {
  const name = (p.placeName || "").replace(/\s+/g, "");
  const addrShort = (p.address || "").split(" ").slice(0, 3).join("");
  return `${name}|${addrShort}`;
}
/*
 * [먼저 넘긴 목록이 이긴다]
 * 같은 업체가 여러 소스에 있으면 인자로 먼저 넘긴 목록의 것을 남긴다. 그래서 호출부에서
 * 대장(D1) -> 카카오 -> 네이버 순으로 넘긴다. 대장은 사업자 신고 정보라 상호·주소가 정확하고,
 * 카카오/네이버에는 지점명이나 옛 상호가 섞여 있다. 예전에는 카카오를 먼저 넘겨서 대장 정보가
 * 있는데도 카카오 쪽이 남았다.
 *
 * dedupKey 는 "이름 + 주소 앞 3토큰"이라 같은 곳인데도 소스마다 도로명/지번 표기가 달라
 * 어긋나는 일이 잦았다. 그래서 이름을 정규화해 한 번 더 본다 - 이름이 같고 300m 안이면 같은
 * 곳으로 친다. 좌표만으로 판단하면 한 건물에 입주한 다른 업체까지 지워버린다.
 */
function mergeDedup(...lists: Place[][]): Place[] {
  const seen = new Set<string>();
  const keptByName = new Map<string, Place[]>();
  const out: Place[] = [];
  for (const list of lists) {
    for (const p of list) {
      const k = dedupKey(p);
      if (seen.has(k)) continue;
      const name = normalizePlaceName(p.placeName);
      const kept = keptByName.get(name);
      if (name && kept?.some((q) => metersApart(p, q) < 300)) continue;
      seen.add(k);
      if (name) (kept ?? keptByName.set(name, []).get(name)!).push(p);
      out.push(p);
    }
  }
  return out;
}

function relevanceScore(title: string, term: string): number {
  if (!term) return 3;
  if (title === term) return 0;
  if (title.startsWith(term)) return 1;
  if (title.includes(term)) return 2;
  return 3;
}
function sortByRelevance(items: Place[], term: string): Place[] {
  return [...items].sort((a, b) => relevanceScore(a.placeName, term) - relevanceScore(b.placeName, term));
}

// [속도 개선] 예전엔 검색할 때마다 전국 공원 데이터(최대 15페이지 x 11개 코드)를 다 불러온 뒤에야
// 결과를 보여줬다. 조경회사/자재 결과는 거의 항상 빠르게 끝나므로, 공원 검색을 별도 함수로 분리해서
// 두 개의 독립된 쿼리로 돌린다 — 조경회사/자재는 먼저 뜨고, 공원은 뒤에서 채워진다.
export async function searchBizPlaces(region: Region, keyword: string): Promise<Place[]> {
  if (!keyword) return [];

  const kakaoTask = fetchKakaoCombined(region, keyword).then((docs) => {
    const seen = new Set<string>();
    const out: Place[] = [];
    const isUmbrellaSearch = UMBRELLA_SEARCH_TERMS.includes(keyword);
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const name = d.place_name || "";
      const category = d.category_name || "";
      if (isExcludedName(name) || isExcludedName(category)) continue;
      const cls = classifyBiz(`${name} ${category}`);
      if (!cls) continue;
      // ["조경"/"정원" 우산 검색어] 카테고리가 "인테리어"로만 잡힌 플랜테리어 업체처럼, 이름/
      // 카테고리에 검색어 그대로가 없어도 classifyBiz가 이미 통과시켰다면(cls가 non-null) 그걸로
      // 충분하다고 본다. "잔디"처럼 더 구체적인 검색어는 계속 matchesSearch로 엄격하게 거른다.
      if (!isUmbrellaSearch && !matchesSearch(name, category, keyword)) continue;
      const lat = parseFloat(d.y);
      const lng = parseFloat(d.x);
      if (!lat || !lng) continue;
      out.push(mapKakaoDoc(d, cls.group, cls.sub));
    }
    return out;
  });

  // [서버측 이름 필터] "조경"/"잔디"처럼 업종을 가리키는 우산 검색어는 상호에 그 글자가 없어도
  // 맞는 업체가 많아서(예: "팀펄리가든") 서버에 q 를 넘기면 안 된다. 반대로 특정 상호를 찾는
  // 검색어는 서버에서 걸러야 1,000건을 통째로 받아 브라우저에서 거르는 낭비가 사라진다.
  const isCategoryish =
    CATEGORY_LIKE_TERMS.includes(keyword) || UMBRELLA_SEARCH_TERMS.includes(keyword);
  const serverQ = isCategoryish ? undefined : keyword;

  const v2CompanyTask = fetchBizV2({ region, group: "company", q: serverQ });
  const v2MaterialTask = fetchBizV2({ region, group: "material", q: serverQ });
  const naverTask = fetchNaverIndependent(region, keyword);

  // [장애 격리] 예전엔 Promise.all을 써서, 4개 소스(카카오/자체DB-회사/자체DB-자재/네이버) 중
  // 단 하나만 실패해도(예: 자체 DB API가 502를 내는 경우) 전체 검색이 통째로 실패해 "0곳 표시
  // 중"으로 보였다 — 나머지 소스가 정상 응답했어도 전부 버려졌다. 실제로 이런 장애가 발생한 걸
  // 확인했다(bizdb-v2가 502를 내는 상태). Promise.allSettled로 바꿔서, 죽은 소스는 빈 배열로
  // 취급하고 살아있는 소스의 결과는 그대로 보여준다.
  const [kakaoResult, v2CompanyResult, v2MaterialResult, naverResult] = await Promise.allSettled([
    kakaoTask, v2CompanyTask, v2MaterialTask, naverTask,
  ]);
  const kakao = kakaoResult.status === "fulfilled" ? kakaoResult.value : [];
  const v2Company = v2CompanyResult.status === "fulfilled" ? v2CompanyResult.value : [];
  const v2Material = v2MaterialResult.status === "fulfilled" ? v2MaterialResult.value : [];
  const naver = naverResult.status === "fulfilled" ? naverResult.value : [];
  if (kakaoResult.status === "rejected") console.error("[searchBizPlaces] 카카오 검색 실패:", kakaoResult.reason);
  if (v2CompanyResult.status === "rejected") console.error("[searchBizPlaces] 자체 DB(조경회사) 조회 실패:", v2CompanyResult.reason);
  if (v2MaterialResult.status === "rejected") console.error("[searchBizPlaces] 자체 DB(조경수/자재) 조회 실패:", v2MaterialResult.reason);
  if (naverResult.status === "rejected") console.error("[searchBizPlaces] 네이버 검색 실패:", naverResult.reason);

  // [조경종합 버킷 안전장치] 예전 대량 수집 당시 오분류된 데이터가 이 버킷에 몰려 있을 위험이 커서,
  // 검색어가 "조경" 계열 카테고리성 단어가 아니면 이 버킷은 DB 결과에서 아예 보여주지 않는다.
  // ("남도" 같은 흔한 단어로 검색했을 때 폐차장·박물관 등이 걸리던 문제의 근본 원인이었다.)
  //
  // [버그 수정] 이 필터는 v2 DB 항목에 한해서는 항상 "업체명이 검색어를 포함할 때만" 통과된
  // 상태였다(matchesSearch에 넘기는 categoryText가 빈 문자열이라 카테고리 매칭 경로 자체가 없음).
  // 즉 이름 그대로 검색해도 "조경종합" 버킷 업체는 검색어가 "조경"류 단어가 아닌 한 100% 걸러졌다
  // — "팀펄리가든"처럼 이름에 조경/설계/시공 같은 단어가 없는 정상 업체까지 이름 검색으로 못 찾는
  // 원인이었다. "남도" 같은 짧고 흔한 단어의 우연한 충돌만 막는 게 원래 의도였으므로, 검색어가
  // 어느 정도 구체적인 길이(3자 이상)면 이름 매칭을 통과시킨다.
  const MIN_SPECIFIC_NAME_SEARCH_LEN = 3;
  const isCategoryLikeSearch = CATEGORY_LIKE_TERMS.includes(keyword);
  const isSpecificNameSearch = keyword.length >= MIN_SPECIFIC_NAME_SEARCH_LEN;
  const v2CompanyFiltered = v2Company.filter(
    (p) =>
      matchesSearch(p.placeName, "", keyword) &&
      !isExcludedName(p.placeName) &&
      (p.categoryDepth2 !== "general" || isCategoryLikeSearch || isSpecificNameSearch)
  );
  const v2MaterialFiltered = v2Material.filter(
    (p) =>
      matchesSearch(p.placeName, "", keyword) &&
      !isExcludedName(p.placeName) &&
      (p.categoryDepth2 !== "general" || isCategoryLikeSearch || isSpecificNameSearch)
  );
  const naverCompany = naver.filter((p) => p.categoryDepth1 === "company");
  const naverMaterial = naver.filter((p) => p.categoryDepth1 === "material");
  const kakaoCompany = kakao.filter((p) => p.categoryDepth1 === "company");
  const kakaoMaterial = kakao.filter((p) => p.categoryDepth1 === "material");

  // [최종 안전망] 소스를 막론하고 병원/주유소/아파트 등 명백히 무관한 업종은 한 번 더 걸러낸다.
  const company = sortByRelevance(mergeDedup(v2CompanyFiltered, kakaoCompany, naverCompany), keyword).filter(
    (p) => !isExcludedName(p.placeName)
  );
  const material = sortByRelevance(mergeDedup(v2MaterialFiltered, kakaoMaterial, naverMaterial), keyword).filter(
    (p) => !isExcludedName(p.placeName)
  );

  return [...company, ...material];
}

// [속도 개선] 공원 검색은 전국 데이터를 다 훑어야 해서 느리다. searchBizPlaces와 별도 쿼리로 돌려서
// 조경회사/자재 결과를 가로막지 않게 한다. fetchAllParks 자체는 세션 내에서 캐시되므로 두 번째
// 검색부터는 이 함수도 즉시 끝난다.
// browseAll=true 면 검색어 없이 공원/수목원 카테고리 전체를 연다(카테고리 칩만 눌렀을 때).
export async function searchParks(keyword: string, browseAll = false): Promise<Place[]> {
  if (!keyword && !browseAll) return [];
  const all = await fetchAllParks();
  if (!keyword) return all;
  return sortByRelevance(
    all.filter((p) => p.placeName.includes(keyword)),
    keyword
  );
}

// [내 주변 찾기 + 공원 카테고리] 자체 대장(garden_biz_v2)은 조경회사/자재만
// 갖고 있어서 공원/수목원은 애초에 대상이 아니었다. 공원 카테고리를 선택하고 "내 주변에서 찾기"를
// 눌러도 계속 0건이었던 이유가 이거다. 별도 geo 인덱스를 새로 만드는 대신, 이미 세션에 캐시된
// 전국 공원 좌표(fetchAllParks)를 하버사인 공식으로 직접 거리 계산해서 반경 안의 것만 골라낸다.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchNearbyParks(lat: number, lng: number, radiusM: number): Promise<Place[]> {
  const all = await fetchAllParks();
  return all
    .map((p) => ({ ...p, distanceM: haversineMeters(lat, lng, p.coordinates[1], p.coordinates[0]) }))
    .filter((p) => p.distanceM! <= radiusM)
    .sort((a, b) => a.distanceM! - b.distanceM!);
}

// [내 주변에서 찾기]
// 예전에는 Supabase 의 PostGIS RPC(nearby_garden_biz)를 호출했는데, 그 테이블에는 100행밖에
// 없고 전부 서울이었다. 그래서 서울 밖에서 이 버튼을 누르면 조경회사·조경수/자재가 구조적으로
// 0건이었다 — 정작 같은 항목이 D1(garden_biz_v2)에는 전국 6,829건 들어 있는데도.
// 이제 워커의 /bizdb-v2?near= 로 같은 대장을 보고, 공원/수목원은 기존대로 세션 캐시에서 합친다.
export async function searchNearby(
  lat: number,
  lng: number,
  radiusM = 5000,
  group: GroupId | null = null
): Promise<Place[]> {
  const near = { lat, lng, radiusKm: radiusM / 1000 };

  const bizTask = (
    group && group !== "park"
      ? fetchBizV2({ near, group, limit: 200 })
      : Promise.all([
          fetchBizV2({ near, group: "company", limit: 200 }),
          fetchBizV2({ near, group: "material", limit: 200 }),
        ]).then((lists) => lists.flat())
  ).then((places) => places.filter((p) => !isExcludedName(p.placeName)));

  const parkTask = group && group !== "park" ? Promise.resolve([]) : fetchNearbyParks(lat, lng, radiusM);

  const [bizResult, parkResult] = await Promise.allSettled([bizTask, parkTask]);
  const bizPlaces = bizResult.status === "fulfilled" ? bizResult.value : [];
  const parkPlaces = parkResult.status === "fulfilled" ? parkResult.value : [];
  if (bizResult.status === "rejected") console.error("[searchNearby] 자체 DB 반경 조회 실패:", bizResult.reason);
  if (parkResult.status === "rejected") console.error("[searchNearby] 공원 반경 조회 실패:", parkResult.reason);

  return [...bizPlaces, ...parkPlaces].sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

interface TourIntro {
  usetime?: string;
  restdate?: string;
  parking?: string;
  infocenter?: string;
}
function cleanIntroText(t: string | undefined): string | null {
  if (!t) return null;
  return t
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s*※\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}
export async function fetchTourIntro(contentId: string): Promise<{ usetime: string | null; restdate: string | null; parking: string | null; tel: string | null }> {
  const params = new URLSearchParams({ contentId, contentTypeId: "12" });
  const res = await fetchWithRetry(`${WORKER_BASE}/tourapi/detailIntro2?${params}`);
  const data = await res.json();
  const body = data?.response?.body;
  let item: TourIntro | TourIntro[] = body?.items?.item;
  if (Array.isArray(item)) item = item[0];
  const intro = (item || {}) as TourIntro;
  return {
    usetime: cleanIntroText(intro.usetime),
    restdate: cleanIntroText(intro.restdate),
    parking: cleanIntroText(intro.parking),
    tel: cleanIntroText(intro.infocenter),
  };
}

export async function fetchNaverHomepage(title: string, region: Region): Promise<string | null> {
  async function tryQuery(query: string): Promise<string | null> {
    const params = new URLSearchParams({ query });
    const res = await fetchWithRetry(`${WORKER_BASE}/naver-search?${params}`);
    const data = await res.json();
    const items: NaverDoc[] = data?.items ?? [];
    const match = items.find((n) => {
      const nTitle = stripHtml(n.title);
      return nTitle.includes(title) || title.includes(nTitle);
    });
    let link = match?.link ?? null;
    if (link && link.includes("naver.com")) link = null;
    return link;
  }
  const withRegion = region !== "전국" ? `${title} ${region}` : title;
  return (await tryQuery(withRegion)) ?? (await tryQuery(title));
}

export function kakaoDirLink(name: string, lat: number, lng: number): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;
}

// [프로젝트 연동] projects.magazinegreen.co.kr(별도 Next.js 배포)의 /api/projects 엔드포인트를
// 불러와 지도 위 항상-표시 레이어로 얹는다. 검색어와 무관하게 항상 로드되며, 실패해도 지도
// 자체의 조경회사/자재/공원 검색에는 영향을 주지 않도록 조용히 빈 배열로 폴백한다.
const PROJECTS_API = "https://projects.magazinegreen.co.kr/api/projects";

export async function fetchProjectPins(): Promise<ProjectPin[]> {
  try {
    const res = await fetchWithRetry(PROJECTS_API);
    const data = await res.json();
    const results = data?.results;
    if (!Array.isArray(results)) return [];
    return results.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  } catch {
    return [];
  }
}
