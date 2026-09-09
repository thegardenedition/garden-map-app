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
import {
  useBizSearch,
  useParkSearch,
  useNearbySearch,
  useBrowseSearch,
  useProjectPins,
  VIEWPORT_MAX_LEVEL,
  type Viewport,
} from "@/lib/queries";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { fetchNaverHomepage, fetchTourIntro, haversineMeters } from "@/lib/api";
import type { Place } from "@/lib/types";
import { GROUP_LABEL } from "@/lib/types";

/*
 * [위치 옵션 — 기본값을 쓰면 안 되는 이유]
 * getCurrentPosition 을 옵션 없이 부르면 브라우저 기본값이 적용된다.
 *  - enableHighAccuracy: false → Wi-Fi·IP 기반 추정만 쓰고 GPS 를 켜지 않는다. 실내나
 *    데스크톱에서는 수백 m ~ 수 km 오차가 난다. 이 앱은 "반경 5km"를 다루므로 그 오차가
 *    결과를 통째로 바꾼다. 정확도가 떨어진다는 체감의 직접 원인이었다.
 *  - timeout: 무한대 → 위치를 못 잡으면 로딩 표시가 영원히 돈다. 사용자는 앱이 멈춘 줄 안다.
 *  - maximumAge: 0 → 버튼을 누를 때마다 매번 처음부터 다시 잡는다.
 */
const GEO_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 30000,
};

// 지도 중심이 기준점에서 이만큼 멀어져야 "이 근처에서 찾기" 버튼을 띄운다. 예전에는 손가락으로
// 살짝만 밀어도 버튼이 튀어나와 지도를 가렸다.
const PAN_THRESHOLD_M = 800;

// 실패 이유마다 할 수 있는 일이 다르다. 예전에는 무엇이든 "위치 권한을 확인해주세요" 였는데,
// 실내에서 시간이 초과된 사람에게는 틀린 안내다.
function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return "위치 권한이 꺼져 있습니다. 주소창의 자물쇠 아이콘에서 위치 권한을 허용해 주세요.";
  }
  if (err.code === err.TIMEOUT) {
    return "위치를 잡는 데 시간이 오래 걸립니다. 실내라면 창가로 옮기거나 잠시 후 다시 시도해 주세요.";
  }
  return "위치를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

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
  const resetStore = useGardenMapStore((s) => s.reset);

  const [submittedTerm, setSubmittedTerm] = useState("");
  const [nearbyCoords, setNearbyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locateCoords, setLocateCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [movedCoords, setMovedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [locating, setLocating] = useState(false);
  // 위치 정확도(m). 브라우저가 알려주는 값으로, 지도 줌과 오차 원을 정하는 데 쓴다.
  const [locateAccuracy, setLocateAccuracy] = useState<number | null>(null);
  // 지도가 멈출 때마다(idle) MapCanvas가 알려주는 현재 화면 영역. 탐색 모드의 조회 범위가 된다.
  const [viewport, setViewport] = useState<Viewport | null>(null);

  // [세 가지 모드는 배타적이다]
  //  - 검색:   검색어가 있을 때. 카카오/네이버/자체DB를 합쳐 조회한다.
  //  - 내 주변: 위치를 잡았을 때. 반경 5km를 거리순으로.
  //  - 탐색:   위 둘 다 아닐 때의 기본값. 지도가 보여주는 것을 그대로 조회한다.
  // 셋이 동시에 켜지면 같은 화면에 두 소스가 겹쳐 중복 마커가 생기므로 반드시 하나만 쓴다.
  const isNearbyMode = Boolean(nearbyCoords) && !submittedTerm;
  const isSearchMode = submittedTerm.length > 0;
  const isBrowseMode = !isNearbyMode && !isSearchMode;

  /*
   * [탐색 모드에서는 재검색 버튼을 숨긴다]
   * 탐색 모드는 지도가 멈출 때마다(idle) 화면 영역을 스스로 다시 조회한다. 그 위에 재검색
   * 버튼을 띄우면 두 가지가 어긋난다. 첫째, 이미 갱신된 결과를 두고 "재검색"을 권하니 안내가
   * 거짓이다. 둘째, 버튼을 누르면 화면 전체가 아니라 중심 반경 5km 로 좁혀지므로 결과가
   * 오히려 줄어든다. 사용자는 새로고침을 기대하고 눌렀다가 목록이 짧아지는 걸 본다.
   * 지도가 스스로 갱신하지 않는 검색·내 주변 모드에서만 띄운다.
   */
  const showResearchHere = Boolean(movedCoords) && !isBrowseMode;

  const bizQuery = useBizSearch(region, submittedTerm);
  const parkQuery = useParkSearch(submittedTerm);
  const nearbyQuery = useNearbySearch(nearbyCoords, activeGroup);
  const browseQuery = useBrowseSearch(region, activeGroup, activeSub, viewport, isBrowseMode);
  const projectPinsQuery = useProjectPins();

  const rawPlaces = useMemo(() => {
    if (isNearbyMode) return nearbyQuery.data ?? [];
    if (isBrowseMode) return browseQuery.data ?? [];
    return [...(bizQuery.data ?? []), ...(parkQuery.data ?? [])];
  }, [isNearbyMode, isBrowseMode, nearbyQuery.data, browseQuery.data, bizQuery.data, parkQuery.data]);

  // [체감 속도] 로딩 표시는 빠른 조경회사/자재 쿼리 기준으로만 판단한다. 공원 데이터는 뒤에서
  // 채워지며, 다 로드되기를 기다리지 않고 화면을 먼저 보여준다.
  const isLoading = isNearbyMode
    ? nearbyQuery.isLoading
    : isBrowseMode
      ? browseQuery.isLoading
      : bizQuery.isLoading;

  const places: Place[] = useMemo(() => {
    const list = rawPlaces ?? [];
    if (!activeGroup) return list;
    return list.filter((p) => p.categoryDepth1 === activeGroup && (!activeSub || p.categoryDepth2 === activeSub));
  }, [rawPlaces, activeGroup, activeSub]);

  const selectedPlace = places.find((p) => p.placeId === selectedPlaceId) ?? null;
  // 이제 지도를 보고 있는 것만으로도 데이터가 흐르므로(탐색 모드) 항상 "조회한 상태"다.
  // "검색어를 입력해주세요" 빈 화면은 더 이상 기본값이 아니다.
  const hasSearched = isNearbyMode || isSearchMode || isBrowseMode;
  const canReset = isNearbyMode || isSearchMode || Boolean(activeGroup) || searchTerm.length > 0;

  // [초기화] 스토어에 reset()이 있었지만 어떤 컴포넌트도 호출하지 않는 죽은 코드였다. 그래서
  // 한번 검색하거나 "내 주변"에 들어가면 브라우저 새로고침 말고는 처음 상태로 돌아갈 방법이
  // 없었다. 스토어 상태(지역/검색어/필터/선택)와 이 컴포넌트의 지역 상태(제출된 검색어,
  // 좌표들)를 한꺼번에 되돌린다 — 둘 중 하나만 지우면 유령 상태가 남는다.
  const handleReset = useCallback(() => {
    resetStore();
    setSubmittedTerm("");
    setNearbyCoords(null);
    setLocateCoords(null);
    setMovedCoords(null);
    setFocusTrigger((t) => t + 1);
  }, [resetStore]);

  function runSearch() {
    setNearbyCoords(null);
    setLocateCoords(null);
    setMovedCoords(null);
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
        setMovedCoords(null);
        setLocateAccuracy(pos.coords.accuracy ?? null);
        setNearbyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFocusTrigger((t) => t + 1);
        setSheetSnap("half");
      },
      (err) => {
        setLocating(false);
        alert(geoErrorMessage(err));
      },
      GEO_OPTS
    );
  }

  function handleLocateOnly() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocateAccuracy(pos.coords.accuracy ?? null);
        setLocateCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFocusTrigger((t) => t + 1);
      },
      // 예전에는 실패 콜백이 아예 없어서, 권한이 꺼져 있으면 버튼을 눌러도 아무 일도
      // 일어나지 않았다. 사용자는 버튼이 고장난 줄 안다.
      (err) => alert(geoErrorMessage(err)),
      GEO_OPTS
    );
  }

  /*
   * [지도를 손으로 옮겼을 때]
   * 예전에는 dragend 마다 무조건 재검색 버튼을 띄웠다. 손가락으로 살짝만 밀어도 버튼이
   * 튀어나와서 지도를 가렸다. 기준점에서 충분히 멀어졌을 때만 띄운다.
   */
  const handleUserPan = useCallback(
    (center: { lat: number; lng: number }) => {
      const from = nearbyCoords ?? locateCoords ?? movedCoords;
      if (from && haversineMeters(from.lat, from.lng, center.lat, center.lng) < PAN_THRESHOLD_M) return;
      setMovedCoords(center);
    },
    [nearbyCoords, locateCoords, movedCoords]
  );

  // ["현 위치에서 재검색"] 사용자가 지도를 손으로 끌어서 다른 지역을 보고 있을 때, 그 화면
  // 중심 좌표를 기준으로 반경 검색을 다시 돌린다. GPS 권한이 필요 없어서 handleNearby보다
  // 훨씬 빠르고, 사용자가 "지금 화면에 보이는 이 동네"를 검색하고 싶어할 때 정확히 맞는다.
  const handleResearchHere = useCallback(() => {
    if (!movedCoords) return;
    setSubmittedTerm("");
    setLocateCoords(null);
    setNearbyCoords(movedCoords);
    setMovedCoords(null);
    setFocusTrigger((t) => t + 1);
    setSheetSnap("half");
  }, [movedCoords, setSheetSnap]);

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
  const isViewportScope = isBrowseMode && Boolean(viewport) && (viewport as Viewport).level <= VIEWPORT_MAX_LEVEL;
  const statusLabel = isNearbyMode
    ? "내 위치 · 반경 5km"
    : isSearchMode
      ? `${region} · "${submittedTerm}"`
      : isViewportScope
        ? "지금 보이는 지도 영역"
        : `${region} · 지역별 분포 (확대하면 전부 표시)`;

  const mapCanvas = (
    <MapCanvas
      places={places}
      selectedPlaceId={selectedPlaceId}
      onSelectPlace={selectPlace}
      onPrefetchPlace={onPrefetchPlace}
      focusTrigger={focusTrigger}
      focusCoords={nearbyCoords ?? locateCoords}
      focusAccuracy={locateAccuracy}
      isDesktop={isDesktop}
      projectPins={projectPinsQuery.data ?? []}
      onUserPan={handleUserPan}
      onViewportChange={setViewport}
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
          statusLabel={statusLabel}
          onReset={handleReset}
          canReset={canReset}
        />
        <div className="relative h-full flex-1">
          {mapCanvas}
          {showResearchHere && (
            <button
              onClick={handleResearchHere}
              className="tp-caption absolute left-1/2 top-4 z-[30] -translate-x-1/2 rounded-full bg-white px-4 py-2.5 text-[var(--color-deep-blue)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
            >
              ⟳ 이 근처에서 찾기
            </button>
          )}
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
        <FilterChips onReset={handleReset} canReset={canReset} />
        {showResearchHere && (
          <button
            onClick={handleResearchHere}
            className="tp-caption mx-auto rounded-full bg-white px-4 py-2.5 text-[var(--color-deep-blue)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
          >
            ⟳ 이 근처에서 찾기
          </button>
        )}
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
          <span className="tp-caption text-[var(--color-deep-blue)]">{statusLabel}</span>
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
