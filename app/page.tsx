"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import MapCanvas from "@/components/MapCanvas";
import TopBar from "@/components/TopBar";
import FilterChips from "@/components/FilterChips";
import BottomSheet from "@/components/BottomSheet";
import PlaceList from "@/components/PlaceList";
import PlaceDetailSheet from "@/components/PlaceDetailSheet";
import Sidebar from "@/components/Sidebar";
import { useGardenMapStore } from "@/lib/store";
import { useBizSearch, useParkSearch, useNearbySearch, useProjectPins } from "@/lib/queries";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { fetchNaverHomepage, fetchTourIntro } from "@/lib/api";
import type { Place } from "@/lib/types";
import { GROUP_LABEL } from "@/lib/types";

export default function Page() {
  const isDesktop = useIsDesktop();
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

  const bizQuery = useBizSearch(region, submittedTerm);
  const parkQuery = useParkSearch(submittedTerm);
  const nearbyQuery = useNearbySearch(nearbyCoords);
  const projectPinsQuery = useProjectPins();

  const isNearbyMode = Boolean(nearbyCoords) && !submittedTerm;
  const rawPlaces = useMemo(() => {
    if (isNearbyMode) return nearbyQuery.data ?? [];
    return [...(bizQuery.data ?? []), ...(parkQuery.data ?? [])];
  }, [isNearbyMode, nearbyQuery.data, bizQuery.data, parkQuery.data]);
  // [체감 속도] 로딩 표시는 빠른 조경회사/자재 쿼리 기준으로만 판단한다. 공원 데이터는 뒤에서
  // 채워지며, 다 로드되기를 기다리지 않고 화면을 먼저 보여준다.
  const isLoading = isNearbyMode ? nearbyQuery.isLoading : bizQuery.isLoading;

  const places: Place[] = useMemo(() => {
    const list = rawPlaces ?? [];
    if (!activeGroup) return list;
    return list.filter((p) => p.categoryDepth1 === activeGroup && (!activeSub || p.categoryDepth2 === activeSub));
  }, [rawPlaces, activeGroup, activeSub]);

  const selectedPlace = places.find((p) => p.placeId === selectedPlaceId) ?? null;
  const hasSearched = isNearbyMode || submittedTerm.length > 0;

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

  // [예측 프리패칭] 마커/리스트 항목을 탭한 순간 상세 패널이 열리기 전에 TanStack Query 캐시를 미리 채운다.
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

  function handleSelect(p: Place) {
    selectPlace(p.placeId);
    onPrefetchPlace(p);
  }

  const activeGroupLabel = activeGroup ? GROUP_LABEL[activeGroup] : null;

  const mapCanvas = (
    <MapCanvas
      places={places}
      selectedPlaceId={selectedPlaceId}
      onSelectPlace={selectPlace}
      onPrefetchPlace={onPrefetchPlace}
      focusTrigger={focusTrigger}
      focusCoords={nearbyCoords ?? locateCoords}
      isDesktop={isDesktop}
      projectPins={projectPinsQuery.data ?? []}
    />
  );

  if (isDesktop) {
    // [데스크탑] 고정 사이드바 + 지도. 시트를 접었다 펴는 동작이 필요 없어 항상 전체 리스트가 보인다.
    return (
      <div className="relative flex h-[100dvh] w-full overflow-hidden bg-[var(--color-deep-blue)]">
        <Sidebar
          onSubmit={runSearch}
          onNearby={handleNearby}
          locating={locating}
          places={places}
          hasSearched={hasSearched}
          isLoading={isLoading}
          activeGroupLabel={activeGroupLabel}
          selectedPlace={selectedPlace}
          region={region}
          onSelectPlace={handleSelect}
          onClosePlace={() => selectPlace(null)}
        />
        <div className="relative h-full flex-1">
          {mapCanvas}
          <button
            onClick={handleLocateOnly}
            aria-label="현재 위치"
            className="absolute bottom-6 right-6 z-[30] flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-[var(--color-deep-blue)] text-lg text-[var(--color-neon-yellow)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
          >
            ◎
          </button>
        </div>
      </div>
    );
  }

  // [모바일] 지도를 전체 화면으로 쓰고, 검색/필터는 지도 위 플로팅 상단바, 결과는 하단 드래그 시트.
  return (
    <div className="relative mx-auto h-[100dvh] w-full overflow-hidden bg-[var(--color-deep-blue)]">
      {mapCanvas}

      <div className="absolute inset-x-3 top-3 z-[20] flex flex-col gap-2">
        <TopBar onSubmit={runSearch} />
        <FilterChips />
      </div>

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
          {isLoading ? "검색 중..." : hasSearched ? `${places.length}곳 표시 중${activeGroupLabel ? ` (${activeGroupLabel})` : ""}` : ""}
        </div>
        <PlaceList places={places} hasSearched={hasSearched && !isLoading} onSelect={handleSelect} />
      </BottomSheet>

      <PlaceDetailSheet place={selectedPlace} region={region} onClose={() => selectPlace(null)} />
    </div>
  );
}
