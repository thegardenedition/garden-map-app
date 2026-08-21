"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import MapCanvas from "@/components/MapCanvas";
import TopBar from "@/components/TopBar";
import FilterChips from "@/components/FilterChips";
import BottomSheet from "@/components/BottomSheet";
import PlaceList from "@/components/PlaceList";
import PlaceDetailSheet from "@/components/PlaceDetailSheet";
import { useGardenMapStore } from "@/lib/store";
import { usePlacesSearch, useNearbySearch } from "@/lib/queries";
import { fetchNaverHomepage, fetchTourIntro } from "@/lib/api";
import type { Place } from "@/lib/types";
import { GROUP_LABEL } from "@/lib/types";

export default function Page() {
  const queryClient = useQueryClient();
  const region = useGardenMapStore((s) => s.region);
  const searchTerm = useGardenMapStore((s) => s.searchTerm);
  const activeGroup = useGardenMapStore((s) => s.activeGroup);
  const activeSub = useGardenMapStore((s) => s.activeSub);
  const selectedPlaceId = useGardenMapStore((s) => s.selectedPlaceId);
  const selectPlace = useGardenMapStore((s) => s.selectPlace);
  const sheetSnap = useGardenMapStore((s) => s.sheetSnap);
  const setSheetSnap = useGardenMapStore((s) => s.setSheetSnap);

  const [submittedTerm, setSubmittedTerm] = useState("");
  const [nearbyCoords, setNearbyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locateCoords, setLocateCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [locating, setLocating] = useState(false);

  const searchQuery = usePlacesSearch(region, submittedTerm);
  const nearbyQuery = useNearbySearch(nearbyCoords);

  const isNearbyMode = Boolean(nearbyCoords) && !submittedTerm;
  const rawPlaces = isNearbyMode ? nearbyQuery.data : searchQuery.data;
  const isLoading = isNearbyMode ? nearbyQuery.isLoading : searchQuery.isLoading;

  const places: Place[] = useMemo(() => {
    const list = rawPlaces ?? [];
    if (!activeGroup) return list;
    return list.filter((p) => p.categoryDepth1 === activeGroup && (!activeSub || p.categoryDepth2 === activeSub));
  }, [rawPlaces, activeGroup, activeSub]);

  const selectedPlace = places.find((p) => p.placeId === selectedPlaceId) ?? null;

  function runSearch() {
    setNearbyCoords(null);
    setLocateCoords(null);
    setSubmittedTerm(searchTerm.trim());
    setFocusTrigger((t) => t + 1);
    setSheetSnap("half");
  }

  function handleNearby() {
    if (!navigator.geolocation) {
      alert("위치 확인이 지원되지 않는 브라우저입니다.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setSubmittedTerm("");
        setLocateCoords(null);
        setNearbyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFocusTrigger((t) => t + 1);
        setSheetSnap("half");
      },
      () => {
        setLocating(false);
        alert("위치를 확인할 수 없습니다. 위치 권한을 확인해주세요.");
      }
    );
  }

  function handleLocateOnly() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocateCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setFocusTrigger((t) => t + 1);
    });
  }

  // [예측 프리패칭] 마커를 탭한 순간(바텀 시트가 열리기 전) TanStack Query 캐시를 미리 채운다.
  const onPrefetchPlace = useCallback(
    (place: Place) => {
      if (place.source === "tourapi") {
        queryClient.prefetchQuery({
          queryKey: ["tourIntro", place.placeId],
          queryFn: () => fetchTourIntro(place.placeId.replace("tour-", "")),
          staleTime: 5 * 60_000,
        });
      } else if (!place.homepageDirect) {
        queryClient.prefetchQuery({
          queryKey: ["naverHomepage", place.placeId],
          queryFn: () => fetchNaverHomepage(place.placeName, region),
          staleTime: 5 * 60_000,
        });
      }
    },
    [queryClient, region]
  );

  const hasSearched = isNearbyMode || submittedTerm.length > 0;

  return (
    <div className="relative mx-auto h-[100dvh] max-w-[520px] overflow-hidden bg-[var(--color-deep-blue)] md:border-x md:border-white/10">
      <MapCanvas
        places={places}
        selectedPlaceId={selectedPlaceId}
        onSelectPlace={selectPlace}
        onPrefetchPlace={onPrefetchPlace}
        focusTrigger={focusTrigger}
        focusCoords={nearbyCoords ?? locateCoords}
      />

      {/* [z-20] 상단 고정 검색바 + 2-Depth 스와이프 필터 칩 */}
      <div className="absolute inset-x-3 top-3 z-[20] flex flex-col gap-2">
        <TopBar onSubmit={runSearch} />
        <FilterChips />
      </div>

      {/* [z-30] 플로팅 컨트롤: 내 주변 찾기 / 현재 위치 */}
      <div className="absolute bottom-[calc(30vh+18px)] right-3.5 z-[30] flex flex-col gap-2.5">
        <button
          onClick={handleNearby}
          disabled={locating}
          aria-label="내 주변에서 찾기"
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[var(--color-deep-blue)] bg-white text-lg text-[var(--color-deep-blue)] shadow-[0_4px_14px_rgba(0,0,0,0.28)] disabled:opacity-50"
        >
          📍
        </button>
        <button
          onClick={handleLocateOnly}
          aria-label="현재 위치"
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-[var(--color-deep-blue)] text-lg text-[var(--color-neon-yellow)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
        >
          ◎
        </button>
      </div>

      <BottomSheet snap={selectedPlaceId ? "peek" : sheetSnap} onSnapChange={setSheetSnap} dragHandleLabel="결과 목록 시트">
        <div className="flex items-center justify-between px-[18px] pt-0.5">
          <span className="tp-caption text-[var(--color-deep-blue)]">
            {isNearbyMode ? "내 위치 · 반경 5km" : region + (submittedTerm ? ` · "${submittedTerm}"` : " · 검색어를 입력해주세요")}
          </span>
        </div>
        <div className="px-[18px] pb-1 pt-1 text-[11px] text-[#8A90B4]">
          {isLoading
            ? "검색 중..."
            : hasSearched
              ? `${places.length}곳 표시 중${activeGroup ? ` (${GROUP_LABEL[activeGroup]})` : ""}`
              : ""}
        </div>
        <PlaceList
          places={places}
          hasSearched={hasSearched && !isLoading}
          onSelect={(p) => {
            selectPlace(p.placeId);
            onPrefetchPlace(p);
          }}
        />
      </BottomSheet>

      <PlaceDetailSheet place={selectedPlace} region={region} onClose={() => selectPlace(null)} />
    </div>
  );
}
