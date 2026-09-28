import { create } from "zustand";
import type { GroupId, Region, SheetSnap, SubId } from "./types";

// [상태 관리 아키텍처]
// Zustand로 Viewport(Bounds/Zoom)와 2-Depth 필터(그룹→서브카테고리)를 원자 단위로 관리한다.
// 검색 결과 자체(Place[])는 TanStack Query 캐시에 두고, 이 스토어는 "무엇을 어떻게 보여줄지"만 담당한다.
// 이렇게 분리하면 필터를 바꿔도 네트워크 재요청 없이 로컬에서 즉시 리렌더링할 수 있다.

interface MapBounds {
  center: [number, number]; // [lng, lat]
  level: number; // 카카오맵 줌 레벨(낮을수록 확대)
}

interface GardenMapState {
  region: Region;
  setRegion: (r: Region) => void;

  searchTerm: string;
  setSearchTerm: (t: string) => void;

  // [다중 레이어 필터] 호갱노노의 "여러 데이터 레이어를 동시에 켜고 끄는" 그리드를 벤치마킹해
  // 그룹(조경회사/조경수·자재/공원)은 여러 개를 동시에 켤 수 있게 Set으로 바꿨다. 서브카테고리는
  // 그룹이 정확히 1개일 때만 의미가 있어(그 그룹 안에서만 더 좁히는 것) 단일 선택을 유지한다 —
  // 그룹이 2개 이상이면 activeSub는 항상 null로 취급(비교 자체를 안 함, app/page.tsx 필터링 참고).
  activeGroups: Set<GroupId>;
  activeSub: SubId | null;
  toggleGroup: (g: GroupId) => void;
  clearGroups: () => void;
  setActiveSub: (s: SubId | null) => void;

  bounds: MapBounds;
  setBounds: (b: Partial<MapBounds>) => void;

  selectedPlaceId: string | null;
  selectPlace: (id: string | null) => void;

  sheetSnap: SheetSnap;
  setSheetSnap: (s: SheetSnap) => void;

  nearbyMode: boolean;
  setNearbyMode: (v: boolean) => void;

  // [검색 자동완성 — 최근 검색어] TopBar(모바일)와 Sidebar(데스크탑)가 각자 독립된 훅
  // 인스턴스로 관리하면 한쪽에서 검색해도 다른 쪽 드롭다운에 안 뜬다 — 스토어에 두어
  // 두 컴포넌트가 항상 같은 목록을 본다. localStorage에도 함께 써서 새로고침 후에도 남는다.
  recentSearches: string[];
  addRecentSearch: (term: string) => void;

  reset: () => void;
}

const INITIAL_BOUNDS: MapBounds = { center: [127.8, 36.5], level: 13 };

const RECENT_SEARCHES_KEY = "garden-map-recent-searches";
const RECENT_SEARCHES_MAX = 8;

function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeRecentSearches(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // 저장 실패(프라이빗 모드 등)는 조용히 무시 — 최근 검색어는 편의 기능일 뿐이다.
  }
}

export const useGardenMapStore = create<GardenMapState>((set) => ({
  region: "전국",
  setRegion: (region) => set({ region }),

  searchTerm: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),

  activeGroups: new Set(),
  activeSub: null,
  toggleGroup: (g) =>
    set((s) => {
      const next = new Set(s.activeGroups);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return { activeGroups: next, activeSub: null };
    }),
  clearGroups: () => set({ activeGroups: new Set(), activeSub: null }),
  setActiveSub: (activeSub) => set((s) => ({ activeSub: s.activeSub === activeSub ? null : activeSub })),

  bounds: INITIAL_BOUNDS,
  setBounds: (b) => set((s) => ({ bounds: { ...s.bounds, ...b } })),

  selectedPlaceId: null,
  selectPlace: (selectedPlaceId) => set({ selectedPlaceId, sheetSnap: selectedPlaceId ? "peek" : "half" }),

  sheetSnap: "half",
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),

  nearbyMode: false,
  setNearbyMode: (nearbyMode) => set({ nearbyMode }),

  recentSearches: readRecentSearches(),
  addRecentSearch: (term) =>
    set((s) => {
      const trimmed = term.trim();
      if (!trimmed) return {};
      const next = [trimmed, ...s.recentSearches.filter((t) => t !== trimmed)].slice(0, RECENT_SEARCHES_MAX);
      writeRecentSearches(next);
      return { recentSearches: next };
    }),

  reset: () =>
    // recentSearches는 의도적으로 리셋 대상에서 뺀다 — "새 검색 시작"이 최근 검색 이력까지
    // 지울 이유는 없다.
    set({
      region: "전국",
      searchTerm: "",
      activeGroups: new Set(),
      activeSub: null,
      bounds: INITIAL_BOUNDS,
      selectedPlaceId: null,
      sheetSnap: "half",
      nearbyMode: false,
    }),
}));
