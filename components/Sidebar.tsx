"use client";

import { REGION_LIST, type Region, type Place } from "@/lib/types";
import { useGardenMapStore } from "@/lib/store";
import FilterChips from "./FilterChips";
import PlaceList from "./PlaceList";
import DetailContent from "./DetailContent";

// [데스크탑 레이아웃] 모바일의 플로팅 상단바+드래그 바텀시트 대신, 검색/필터/리스트가 항상
// 한눈에 보이는 고정 사이드바를 쓴다. 화면 공간이 넉넉한 데스크탑에서 굳이 시트를 접었다 펴게
// 만들 이유가 없고, 실제 지도 데스크탑 앱(카카오맵/네이버맵 PC판)도 이 패턴을 쓴다.
export default function Sidebar({
  onSubmit,
  onNearby,
  locating,
  places,
  hasSearched,
  isLoading,
  activeGroupLabel,
  selectedPlace,
  region,
  onSelectPlace,
  onClosePlace,
  statusLabel,
}: {
  onSubmit: () => void;
  onNearby: () => void;
  locating: boolean;
  places: Place[];
  hasSearched: boolean;
  isLoading: boolean;
  activeGroupLabel: string | null;
  selectedPlace: Place | null;
  region: Region;
  onSelectPlace: (p: Place) => void;
  onClosePlace: () => void;
  statusLabel: string; // "내 위치 · 반경 5km" 또는 "전국 · 검색어를 입력해주세요" 등, 실제 검색 상태 기준
}) {
  const storeRegion = useGardenMapStore((s) => s.region);
  const setRegion = useGardenMapStore((s) => s.setRegion);
  const searchTerm = useGardenMapStore((s) => s.searchTerm);
  const setSearchTerm = useGardenMapStore((s) => s.setSearchTerm);

  return (
    <div className="relative z-[20] flex h-full w-[400px] flex-shrink-0 flex-col bg-[var(--color-deep-blue)] text-white">
      <div className="flex-shrink-0 px-6 pb-3.5 pt-6">
        <span className="tp-caption inline-flex items-center gap-1.5 rounded-2xl border-[1.5px] border-[var(--color-neon-yellow)] px-3.5 py-1 text-[var(--color-neon-yellow)]">
          ✳ GARDEN MAP
        </span>
        <h1 className="tp-title mt-2.5">정원·조경 지도</h1>
        <p className="tp-body mt-1 text-[var(--color-muted)]">
          지역과 검색어를 입력하면 조경회사·조경수/자재·공원/수목원 결과가 한번에 표시됩니다.
        </p>
      </div>

      <div className="flex-shrink-0 px-6">
        <div className="flex items-center gap-1.5 rounded-2xl bg-white/10 p-2">
          <select
            value={storeRegion}
            onChange={(e) => setRegion(e.target.value as Region)}
            className="min-h-[40px] flex-shrink-0 rounded-xl bg-white/10 px-3 text-[13px] font-bold text-white outline-none"
            style={{ maxWidth: 82 }}
          >
            {REGION_LIST.map((r) => (
              <option key={r} value={r} className="text-[var(--color-deep-blue)]">
                {r}
              </option>
            ))}
          </select>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder="예: 조경, 잔디, 수목원..."
            className="tp-body min-h-[40px] min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/40"
          />
          <button
            onClick={onSubmit}
            aria-label="검색"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-neon-yellow)] text-lg text-[var(--color-deep-blue)]"
          >
            ⌕
          </button>
        </div>
        <button
          onClick={onNearby}
          disabled={locating}
          className="tp-caption mt-2 w-full rounded-xl border-[1.5px] border-[var(--color-neon-yellow)] py-2.5 text-[var(--color-neon-yellow)] disabled:opacity-50"
        >
          📍 내 주변에서 찾기
        </button>
      </div>

      <div className="mt-3 flex-shrink-0 px-6">
        <FilterChips />
      </div>

      <div className="mt-3 flex flex-shrink-0 items-center justify-between px-6">
        <span className="tp-caption text-[var(--color-neon-yellow)]">{statusLabel}</span>
      </div>
      <div className="px-6 pb-2 pt-1 text-[11px] text-white/50">
        {isLoading ? "검색 중..." : hasSearched ? `${places.length}곳 표시 중${activeGroupLabel ? ` (${activeGroupLabel})` : ""}` : ""}
      </div>

      <div className="mt-1.5 flex flex-1 flex-col overflow-hidden rounded-t-[20px] bg-white text-[#0A0A23]">
        {selectedPlace ? (
          <div className="flex-1 overflow-y-auto px-5 pt-5 pb-6">
            <button
              onClick={onClosePlace}
              className="tp-caption mb-3 inline-flex items-center gap-1 text-[var(--color-deep-blue)]"
            >
              ← 목록으로
            </button>
            <DetailContent place={selectedPlace} region={region} />
          </div>
        ) : (
          <PlaceList places={places} hasSearched={hasSearched && !isLoading} onSelect={onSelectPlace} />
        )}
      </div>
    </div>
  );
}
