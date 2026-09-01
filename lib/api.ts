import type { GroupId, Place, ProjectPin, Region, SubId } from "./types";
import { CATEGORY_LIKE_TERMS, classifyBiz, isExcludedName, matchesSearch } from "./classify";

// [네트워크 회복탄력성]
// 이 앱은 magazinegreen.co.kr(Webflow) 배포본과 동일한 백엔드를 그대로 재사용한다.
// - Cloudflare Worker: 카카오/네이버 로컬 검색, 국문 관광정보(TourAPI 공원) 프록시
// - Supabase: PostGIS 기반 반경(내 주변) 검색 RPC
// 별도 백엔드를 새로 만들지 않고 기존 인프라를 그대로 소비하는 것이 이번 아키텍처의 핵심 결정이다.
const WORKER_BASE = "https://nongsaro-proxy.chgreena.workers.dev";
const SUPABASE_URL = "https://wxfvhsmelfffpxcktlnt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4ZnZoc21lbGZmZnB4Y2t0bG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5OTgxMDMsImV4cCI6MjEwMjU3NDEwM30.3HmakcS_4EMCpHxRQ7MDph_srgN8BKSAm5XeIVXCQcg";

async function fetchWithRetry(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  // [TanStack Query와 별개의 저수준 재시도]
  // 지수 백오프(Exponential Backoff): 300ms → 900ms. Query 자체의 retry와 이중으로 걸리지 않도록
  // 여기서는 네트워크 계층(타임아웃/일시적 장애)만 담당하고, 스키마 오류 같은 건 그대로 던진다.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
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
  for (const d of docs) {
    const name = stripHtml(d.title || "");
    const category = d.category || "";
    if (!matchesSearch(name, category, keyword)) continue;
    if (isExcludedName(name) || isExcludedName(category)) continue;
    const cls = classifyBiz(`${name} ${category}`);
    if (!cls) continue;
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
}

async function fetchBizV2(region: Region, group: GroupId): Promise<Place[]> {
  const params = new URLSearchParams({ region, group });
  const res = await fetchWithRetry(`${WORKER_BASE}/bizdb-v2?${params}`);
  const data = await res.json();
  const rows: BizV2Row[] = data?.results ?? [];
  return rows
    .filter((r) => parseFloat(r.lat) && parseFloat(r.lng))
    .map((r) => ({
      placeId: `v2-${r.id}`,
      categoryDepth1: r.grp,
      categoryDepth2: r.sub,
      placeName: r.name || "",
      address: r.addr || "",
      contact: r.tel || null,
      coordinates: [parseFloat(r.lng), parseFloat(r.lat)],
      homepage: r.homepage || null,
      homepageDirect: null,
      source: "kakao" as const,
      distanceM: null,
    }));
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

async function fetchOneCode(code: string): Promise<TourItem[]> {
  const MAX_PAGES = 8;
  let collected: TourItem[] = [];
  let pageNo = 1;
  while (pageNo <= MAX_PAGES) {
    const res = await fetchOnePage(code, pageNo);
    collected = collected.concat(res.items);
    const fetchedSoFar = pageNo * 100;
    if (res.items.length !== 100 || fetchedSoFar >= res.totalCount) break;
    pageNo++;
  }
  return collected;
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
  parkCache = all.filter((p) => {
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return Boolean(p.coordinates[0] && p.coordinates[1]);
  });
  return parkCache;
}

function dedupKey(p: Place): string {
  const name = (p.placeName || "").replace(/\s+/g, "");
  const addrShort = (p.address || "").split(" ").slice(0, 3).join("");
  return `${name}|${addrShort}`;
}
function mergeDedup(...lists: Place[][]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const list of lists) {
    for (const p of list) {
      const k = dedupKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
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
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const name = d.place_name || "";
      if (!matchesSearch(name, d.category_name || "", keyword)) continue;
      if (isExcludedName(name) || isExcludedName(d.category_name || "")) continue;
      const cls = classifyBiz(`${name} ${d.category_name || ""}`);
      if (!cls) continue;
      const lat = parseFloat(d.y);
      const lng = parseFloat(d.x);
      if (!lat || !lng) continue;
      out.push(mapKakaoDoc(d, cls.group, cls.sub));
    }
    return out;
  });

  const v2CompanyTask = fetchBizV2(region, "company");
  const v2MaterialTask = fetchBizV2(region, "material");
  const naverTask = fetchNaverIndependent(region, keyword);

  const [kakao, v2Company, v2Material, naver] = await Promise.all([
    kakaoTask, v2CompanyTask, v2MaterialTask, naverTask,
  ]);

  // [조경종합 버킷 안전장치] 예전 대량 수집 당시 오분류된 데이터가 이 버킷에 몰려 있을 위험이 커서,
  // 검색어가 "조경" 계열 카테고리성 단어가 아니면 이 버킷은 DB 결과에서 아예 보여주지 않는다.
  // ("남도" 같은 흔한 단어로 검색했을 때 폐차장·박물관 등이 걸리던 문제의 근본 원인이었다.)
  const isCategoryLikeSearch = CATEGORY_LIKE_TERMS.includes(keyword);
  const v2CompanyFiltered = v2Company.filter(
    (p) =>
      matchesSearch(p.placeName, "", keyword) &&
      !isExcludedName(p.placeName) &&
      (p.categoryDepth2 !== "general" || isCategoryLikeSearch)
  );
  const v2MaterialFiltered = v2Material.filter(
    (p) =>
      matchesSearch(p.placeName, "", keyword) &&
      !isExcludedName(p.placeName) &&
      (p.categoryDepth2 !== "general" || isCategoryLikeSearch)
  );
  const naverCompany = naver.filter((p) => p.categoryDepth1 === "company");
  const naverMaterial = naver.filter((p) => p.categoryDepth1 === "material");
  const kakaoCompany = kakao.filter((p) => p.categoryDepth1 === "company");
  const kakaoMaterial = kakao.filter((p) => p.categoryDepth1 === "material");

  // [최종 안전망] 소스를 막론하고 병원/주유소/아파트 등 명백히 무관한 업종은 한 번 더 걸러낸다.
  const company = sortByRelevance(mergeDedup(kakaoCompany, v2CompanyFiltered, naverCompany), keyword).filter(
    (p) => !isExcludedName(p.placeName)
  );
  const material = sortByRelevance(mergeDedup(kakaoMaterial, v2MaterialFiltered, naverMaterial), keyword).filter(
    (p) => !isExcludedName(p.placeName)
  );

  return [...company, ...material];
}

// [속도 개선] 공원 검색은 전국 데이터를 다 훑어야 해서 느리다. searchBizPlaces와 별도 쿼리로 돌려서
// 조경회사/자재 결과를 가로막지 않게 한다. fetchAllParks 자체는 세션 내에서 캐시되므로 두 번째
// 검색부터는 이 함수도 즉시 끝난다.
export async function searchParks(keyword: string): Promise<Place[]> {
  if (!keyword) return [];
  const all = await fetchAllParks();
  return sortByRelevance(
    all.filter((p) => p.placeName.includes(keyword)),
    keyword
  );
}

interface SupabaseNearbyRow {
  id: number;
  name: string;
  addr: string;
  lat: number;
  lng: number;
  tel: string;
  category_path: string;
  homepage: string;
  grp: GroupId;
  sub: SubId;
  region: string;
  distance_m: number;
}

// [내 주변 찾기 + 공원 카테고리] Supabase의 반경 검색 RPC는 조경회사/자재(garden_biz 테이블)만
// 갖고 있어서 공원/수목원은 애초에 대상이 아니었다. 공원 카테고리를 선택하고 "내 주변에서 찾기"를
// 눌러도 계속 0건이었던 이유가 이거다. 별도 geo 인덱스를 새로 만드는 대신, 이미 세션에 캐시된
// 전국 공원 좌표(fetchAllParks)를 하버사인 공식으로 직접 거리 계산해서 반경 안의 것만 골라낸다.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

export async function searchNearby(lat: number, lng: number, radiusM = 5000): Promise<Place[]> {
  const bizTask = fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/nearby_garden_biz`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ center_lat: lat, center_lng: lng, radius_m: radiusM, filter_grp: null, limit_count: 60 }),
  })
    .then((res) => res.json())
    .then((rows: SupabaseNearbyRow[]) =>
      (Array.isArray(rows) ? rows : []).map((r) => {
        const homepageLink = r.homepage || "";
        const isKakaoLink = homepageLink.includes("place.map.kakao.com");
        return {
          placeId: `sb-${r.id}`,
          categoryDepth1: r.grp,
          categoryDepth2: r.sub,
          placeName: r.name || "",
          address: r.addr || "",
          contact: r.tel || null,
          coordinates: [r.lng, r.lat] as [number, number],
          homepage: isKakaoLink ? homepageLink : null,
          homepageDirect: !isKakaoLink && homepageLink ? homepageLink : null,
          source: "kakao" as const,
          distanceM: r.distance_m,
        };
      })
    );

  const parkTask = fetchNearbyParks(lat, lng, radiusM);

  const [bizPlaces, parkPlaces] = await Promise.all([bizTask, parkTask]);
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
