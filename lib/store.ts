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

  activeGroup: GroupId | null;
  activeSub: SubId | null;
  setActiveGroup: (g: GroupId | null) => void;
  setActiveSub: (s: SubId | null) => void;

  bounds: MapBounds;
  setBounds: (b: Partial<MapBounds>) => void;

  selectedPlaceId: string | null;
  selectPlace: (id: string | null) => void;

  sheetSnap: SheetSnap;
  setSheetSnap: (s: SheetSnap) => void;

  // [장소를 고르기 전에 펼쳐둔 위치를 기억한다]
  // 리스트를 full 까지 열어서 보다가 장소를 하나 탭하면 시트가 peek 으로 강제 축소된다(상세를
  // 볼 공간을 만들려고). 그런데 상세를 닫을 때 무조건 half 로 돌아가 버려서, 애써 full 까지
  // 열어놨던 게 사라졌었다. 선택 직전 위치를 여기 담아뒀다가 닫을 때 그대로 복원한다.
  // null 이면 "지금 기억해둔 위치 없음"이고, 다른 장소로 갈아탈 때는 이미 있는 값을 덮어쓰지 않는다.
  preSelectSnap: SheetSnap | null;

  nearbyMode: boolean;
  setNearbyMode: (v: boolean) => void;

  reset: () => void;
}

const INITIAL_BOUNDS: MapBounds = { center: [127.8, 36.5], level: 13 };

export const useGardenMapStore = create<GardenMapState>((set) => ({
  region: "전국",
  setRegion: (region) => set({ region }),

  searchTerm: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),

  activeGroup: null,
  activeSub: null,
  setActiveGroup: (activeGroup) => set({ activeGroup, activeSub: null }),
  setActiveSub: (activeSub) => set((s) => ({ activeSub: s.activeSub === activeSub ? null : activeSub })),

  bounds: INITIAL_BOUNDS,
  setBounds: (b) => set((s) => ({ bounds: { ...s.bounds, ...b } })),

  selectedPlaceId: null,
  selectPlace: (selectedPlaceId) =>
    set((s) => {
      if (selectedPlaceId) {
        // 이미 다른 장소를 보고 있던 중이라면(갈아타기) 최초에 기억해둔 위치를 덮어쓰지 않는다.
        const preSelectSnap = s.selectedPlaceId ? s.preSelectSnap : s.sheetSnap;
        return { selectedPlaceId, sheetSnap: "peek" as SheetSnap, preSelectSnap };
      }
      return { selectedPlaceId: null, sheetSnap: s.preSelectSnap ?? "peek", preSelectSnap: null };
    }),

  sheetSnap: "peek",
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  preSelectSnap: null,

  nearbyMode: false,
  setNearbyMode: (nearbyMode) => set({ nearbyMode }),

  reset: () =>
    set({
      region: "전국",
      searchTerm: "",
      activeGroup: null,
      activeSub: null,
      bounds: INITIAL_BOUNDS,
      selectedPlaceId: null,
      sheetSnap: "peek",
      preSelectSnap: null,
      nearbyMode: false,
    }),
}));
