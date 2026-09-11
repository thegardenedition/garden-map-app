"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * - enableHighAccuracy: false → Wi-Fi·IP 기반 추정만 쓰고 GPS 를 켜지 않는다. 실내나
 *   데스크톱에서는 수백 m ~ 수 km 오차가 난다. 이 앱은 "반경 5km"를 다루므로 그 오차가
 *   결과를 통째로 바꾼다. 정확도가 떨어진다는 체감의 직접 원인이었다.
 * - timeout: 무한대 → 위치를 못 잡으면 로딩 표시가 영원히 돈다. 사용자는 앱이 멈춘 줄 안다.
 * - maximumAge: 0 → 버튼을 누를 때마다 매번 처음부터 다시 잡는다.
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
  /*
   * [모바일 홈 링크의 하이드레이션 문제]
   * 매거진그린 홈 링크를 상단 스택에 추가한 뒤로 콘솔에 React 하이드레이션 에러(#418)가
   * 뜨기 시작했다. 링크 자체는 정적이라 서버·클라이언트 출력이 다를 이유가 없어야 하는데,
   * useIsDesktop()이 useSyncExternalStore로 브라우저 값을 구독하는 구조라 첫 렌더 직후
   * 트리가 통째로 바뀌는 지점이고, 그 경계 바로 안쪽에 노드를 하나 더 얹은 것만으로 이미
   * 아슬아슬하던 하이드레이션 경계를 건드린 것으로 보인다. 원인을 한 줄로 못 박기보다,
   * 이 링크를 마운트된 뒤에만 그려서 첫 렌더(서버·클라이언트 공통)를 아예 건드리지 않게
   * 만드는 쪽이 확실하다 — 화면에는 마운트 직후 바로 나타나 체감 차이가 없다.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const region = useGardenMapStore((s) => s.region);
  const searchTerm = useGardenMapStore((s) => s.searchTerm);
  const setSearchTerm = useGardenMapStore((s) => s.setSearchTerm);
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
  // [지도에서 보기 딥링크] project.magazinegreen.co.kr 상세 페이지의 "지도에서 보기"가
  // ?lat=..&lng=.. 로 이 앱을 연다. useSearchParams()는 Next.js가 정적 렌더링 시 이
  // 페이지 전체를 Suspense로 감싸길 요구하는데, 마운트 시 한 번만 읽으면 되는 이
  // 용도에는 window.location.search를 직접 읽는 쪽이 구조를 안 건드리고 더 간단하다.
  const [urlFocusCoords, setUrlFocusCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);

  // 값이 없거나 숫자로 못 읽으면 기존 기본 동작(전국 뷰) 그대로다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("lat") ?? "");
    const lng = parseFloat(params.get("lng") ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setUrlFocusCoords({ lat, lng });
      setFocusTrigger((t) => t + 1);
    }
  }, []);

  const [locating, setLocating] = useState(false);
  // [지도만 보기] 검색·필터가 끝난 뒤에도 상단 스택이 계속 지도 위 공간을 차지해 답답하다는
  // 피드백을 받았다. 상단 스택 전체(배지·검색바·칩)를 잠깐 걷어내는 토글이다. 상태는 그대로
  // 두고 화면에서만 숨기므로, 다시 누르면 검색어·필터가 그대로 남아 있다.
  const [mapUiHidden, setMapUiHidden] = useState(false);
  // [검색 중엔 필터 칩을 접어 둔다] 탐색(browse) 모드에서는 칩이 곧 주된 조작 수단이라 항상
  // 펼쳐 두지만, 검색·내 주변 모드로 들어가면 이미 결과가 있는 상태라 칩을 다시 만질 일이
  // 적다. 모드가 바뀌는 순간에만 자동으로 접고 펴며, 그 안에서는 사용자가 직접 눌러
  // 펼치고 접을 수 있다(기능은 그대로 두고 기본 노출만 줄인다).
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  /*
   * [시트가 상단 스택을 덮지 않게]
   * full(90%)로 올리면 시트 윗선이 화면 위 81px 까지 온다. 검색바·필터 칩은 그보다 아래에
   * 있으므로 칩이 통째로 가려졌다 — 필터를 바꾸려면 시트를 도로 내려야 했다. 스택 높이는
   * 소분류 칩이나 홈 링크 때문에 늘었다 줄었다 하므로 상수로 못 박을 수 없다. 실제로 재서
   * 그 아래까지만 올라오게 한다. 못 재면 0 이라 예전과 같이 동작한다.
   */
  const topStackRef = useRef<HTMLDivElement | null>(null);
  const [sheetMinTop, setSheetMinTop] = useState(0);
  // 위치 정확도(m). 브라우저가 알려주는 값으로, 지도 줌과 오차 원을 정하는 데 쓴다.
  const [locateAccuracy, setLocateAccuracy] = useState<number | null>(null);
  // 지도가 멈출 때마다(idle) MapCanvas가 알려주는 현재 화면 영역. 탐색 모드의 조회 범위가 된다.
  const [viewport, setViewport] = useState<Viewport | null>(null);

  // [세 가지 모드는 배타적이다]
  // - 검색: 검색어가 있을 때. 카카오/네이버/자체DB를 합쳐 조회한다.
  // - 내 주변: 위치를 잡았을 때. 반경 5km를 거리순으로.
  // - 탐색: 위 둘 다 아닐 때의 기본값. 지도가 보여주는 것을 그대로 조회한다.
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

  // 모드가 바뀌는 순간에만 칩을 자동으로 접고 편다 — 그 안에서 사용자가 직접 편 상태는
  // 같은 모드에 머무는 동안 건드리지 않는다.
  useEffect(() => {
    setFiltersCollapsed(!isBrowseMode);
  }, [isBrowseMode]);

  useEffect(() => {
    const measure = () => {
      const el = topStackRef.current;
      if (el) setSheetMinTop(Math.round(el.getBoundingClientRect().bottom) + 8);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // mounted: 홈 링크가 마운트된 다음 순간(아래) 스택 높이가 늘어나므로, 그때 한 번 더
    // 재보지 않으면 시트 윗선이 링크와 겹친다. mapUiHidden·filtersCollapsed 도 스택 높이를
    // 바꾸므로 같이 넣는다.
  }, [showResearchHere, activeGroup, activeSub, mounted, mapUiHidden, filtersCollapsed]);

  const bizQuery = useBizSearch(region, submittedTerm);
  const parkQuery = useParkSearch(submittedTerm);
  const nearbyQuery = useNearbySearch(nearbyCoords, activeGroup);
  const browseQuery = useBrowseSearch(region, activeGroup, activeSub, viewport, isBrowseMode);
  const projectPinsQuery = useProjectPins();

  const rawPlaces = useMemo(() => {
    if (isNearbyMode) return nearbyQuery.data?.places ?? [];
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
  /*
   * [모드에서 빠져나오는 길]
   * 검색·내 주변에 한번 들어가면 나오는 길이 "초기화" 하나뿐이었다. 그런데 초기화는
   * 카테고리 필터와 지역까지 전부 되돌리므로, "검색만 그만두고 지금 필터 그대로 지도를
   * 둘러보고 싶다"는 흔한 요구를 들어줄 방법이 없었다. 특히 내 주변은 한번 찍으면 지도를
   * 옮겨도 그 자리 결과에 묶여 있어서 갇힌 느낌을 준다.
   * 이 핸들러는 모드만 벗기고 필터·지역은 그대로 둔다.
   */
  const exitToBrowse = useCallback(() => {
    setSubmittedTerm("");
    setSearchTerm("");
    setNearbyCoords(null);
    setMovedCoords(null);
  }, [setSearchTerm]);

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
        // [간단 핀] 사람이 직접 등록한 장소라 네이버에서 홈페이지를 찾아 줄 대상이 아니다.
        // 이 가지를 빼면 커스텀 핀을 열 때마다 의미 없는 네이버 검색 쿼터가 소모된다.
      } else if (place.source !== "custom" && !place.homepageDirect) {
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
  // 반경은 결과에 맞춰 달라지므로(조밀한 곳은 2km, 한적한 곳은 20km) 실제로 쓴 값을 밝힌다.
  // 적게 나왔을 때 그게 고장이 아니라 "그 반경 안에 정말 없다"는 뜻임을 알 수 있어야 한다.
  const nearbyRadiusKm = nearbyQuery.data ? Math.round(nearbyQuery.data.radiusM / 1000) : null;
  /*
   * [지금 어느 모드인지 이름을 붙인다]
   * 세 모드는 배타적이고 결과가 오는 곳이 서로 다른데, 화면에는 범위만 적혀 있어서 지금
   * 무엇을 보고 있는지 알기 어려웠다. "지금 보이는 지도 영역"과 "내 위치 · 반경 2km"가
   * 어떻게 다른지는 코드를 봐야 알 수 있다. 모드 이름을 앞에 세운다.
   */
  const statusLabel = isNearbyMode
    ? nearbyRadiusKm
      ? `내 주변 · 반경 ${nearbyRadiusKm}km`
      : "내 주변 · 찾는 중"
    : isSearchMode
    ? `검색 · ${region} · "${submittedTerm}"`
    : isViewportScope
    ? "지도 탐색 · 지금 보이는 영역"
    : `지도 탐색 · ${region} 분포 (확대하면 전부 표시)`;

  const mapCanvas = (
    <MapCanvas
      places={places}
      selectedPlaceId={selectedPlaceId}
      onSelectPlace={selectPlace}
      onPrefetchPlace={onPrefetchPlace}
      focusTrigger={focusTrigger}
      focusCoords={nearbyCoords ?? locateCoords ?? urlFocusCoords}
      focusAccuracy={locateAccuracy}
      focusRadius={isNearbyMode ? (nearbyQuery.data?.radiusM ?? null) : null}
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
          onExitMode={isBrowseMode ? undefined : exitToBrowse}
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

      {/* [빈 곳으로는 지도를 만질 수 있어야 한다]
          이 상자는 배지·검색바·칩을 세로로 쌓는 껍데기인데, 눈에는 안 보여도 x 12~381,
          y 12~150 의 직사각형 전체가 터치를 가로챘다. 배지 오른쪽 빈자리도, 검색바와 칩
          사이 8px 틈도 전부 그렇다. 그래서 화면 위 138px 띠에서는 지도를 끌 수도, 그 자리
          마커를 누를 수도 없었다 — 지도는 보이는데 반응하지 않으니 고장으로 느껴진다.
          껍데기는 터치를 흘려보내고, 실제 조작이 필요한 자식만 받는다. */}
      <div ref={topStackRef} className="pointer-events-none absolute inset-x-3 top-3 z-[20] flex flex-col gap-2">
        {!mapUiHidden && (
          <>
            {/* 데스크탑 사이드바에는 브랜드 배지가 있지만 모바일 상단바에는 아예 없었다 —
                지도를 iframe 밖에서 직접 열거나 북마크한 사람은 매거진그린으로 돌아갈 길이
                없었다. 검색창 위에 작은 링크 하나만 얹는다(기존 플로팅 레이아웃 그대로,
                검색 기능을 가리지 않는다).
                target="_top": 이 앱은 magazinegreen.co.kr/garden-map 에서 iframe 으로도
                열린다. target 없이 두면 iframe 안에서 다시 홈페이지를 여는 꼴이 되어 액자
                속 액자처럼 보인다. _top 은 iframe 이 아닐 때는 그냥 현재 창 이동과 같다.
                mounted 로 감싼 이유는 위 [모바일 홈 링크의 하이드레이션 문제] 참고. */}
            {mounted && (
              <a
                href="https://magazinegreen.co.kr"
                target="_top"
                className="tp-caption pointer-events-auto inline-flex w-fit items-center gap-1.5 self-start rounded-2xl bg-[var(--color-deep-blue)]/90 px-3 py-1 text-[var(--color-neon-yellow)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
              >
                ✳ MAGAZINE GREEN
              </a>
            )}
            <div className="pointer-events-auto">
              <TopBar onSubmit={runSearch} />
            </div>
            {/* [검색 중엔 칩을 접어 둔다] 탐색 모드에서만 칩을 곧바로 펼쳐 보여주고, 검색·내
                주변 모드에서는 작은 토글로 접어서 지도 볼 공간을 늘린다. 눌러서 펼치면 필터
                기능은 그대로 다 쓸 수 있다 — 숨기는 건 기본 노출뿐이다. */}
            <div className="pointer-events-auto flex items-start gap-2">
              {!isBrowseMode && (
                <button
                  onClick={() => setFiltersCollapsed((v) => !v)}
                  aria-expanded={!filtersCollapsed}
                  aria-label="필터 펼치기/접기"
                  className="tp-caption flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white px-3 py-2 text-[var(--color-deep-blue)] shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
                >
                  필터{activeGroupLabel ? ` · ${activeGroupLabel}` : ""} {filtersCollapsed ? "▾" : "▴"}
                </button>
              )}
              {(isBrowseMode || !filtersCollapsed) && (
                <div className="min-w-0 flex-1">
                  <FilterChips onReset={handleReset} canReset={canReset} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* [지도만 보기] 검색어·필터는 그대로 두고 상단 스택만 잠깐 걷어낸다. 스택이 사라지든
          말든 항상 같은 자리에 있어야 다시 켜는 길을 잃지 않는다 — topStackRef 바깥의
          독립된 버튼이라 mapUiHidden 이 꺼도 이 버튼만은 계속 보인다. */}
      <button
        onClick={() => setMapUiHidden((v) => !v)}
        aria-label={mapUiHidden ? "검색·필터 다시 보기" : "지도만 보기"}
        className="pointer-events-auto absolute right-3 top-3 z-[21] flex h-10 w-10 items-center justify-center rounded-full bg-white text-[var(--color-deep-blue)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
      >
        {mapUiHidden ? "⌄" : "⌃"}
      </button>

      {/* [재검색은 스택 밖에 띄운다] 예전에는 이 버튼이 상단 스택 안에 있어서, 뜰 때마다 스택이
          한 줄 길어지고 그만큼 지도가 좁아졌다. 홈 링크까지 들어와 스택이 더 길어졌으니 더욱
          그렇다. 지도 위에 겹쳐 띄우면 스택 높이가 변하지 않는다. 데스크톱도 같은 방식이다.
          지도만 보기 중에는 걷어낸 UI를 다시 지도 위에 끌어오는 셈이라 함께 숨긴다. */}
      {showResearchHere && !mapUiHidden && (
        <button
          onClick={handleResearchHere}
          className="tp-caption absolute left-1/2 z-[25] -translate-x-1/2 rounded-full bg-white px-4 py-2.5 text-[var(--color-deep-blue)] shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
          style={{ top: sheetMinTop || 160 }}
        >
          ⟳ 이 근처에서 찾기
        </button>
      )}

      {/* [검색 종료 버튼을 시트 밖으로] 예전엔 바텀시트 안 상태 줄에 있었다. 시트는 peek이어도
          화면의 30%를 차지하므로, 검색만 그만두고 싶을 때도 시트를 먼저 봐야 눈에 들어왔다.
          상단 스택 바로 아래(재검색 버튼과 같은 자리)로 옮겨 지도를 보는 시선 안에 둔다. */}
      {!isBrowseMode && !mapUiHidden && (
        <button
          onClick={exitToBrowse}
          className="tp-caption absolute right-3 z-[25] rounded-full bg-white px-3 py-2 text-[11px] text-[var(--color-deep-blue)]/80 shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
          style={{ top: sheetMinTop || 160 }}
        >
          지도 탐색으로 ✕
        </button>
      )}

      <BottomSheet
        snap={selectedPlaceId ? "peek" : sheetSnap}
        onSnapChange={setSheetSnap}
        dragHandleLabel="결과 목록 시트"
        minTopPx={sheetMinTop}
        floatingActions={
          // [두 버튼을 한 덩어리로] 예전엔 원형 버튼 두 개가 각자 그림자를 지고 따로 떠 있어
          // 지도 위에 얹힌 장치가 하나 더 있는 것처럼 보였다. 기능은 그대로 두고(따로따로
          // 누른다) 테두리 하나 안에 묶어 그림자 하나·경계 하나로 줄인다.
          <div className="pointer-events-auto flex flex-col overflow-hidden rounded-[26px] shadow-[0_4px_14px_rgba(0,0,0,0.28)]">
            <button
              onClick={handleNearby}
              disabled={locating}
              aria-label="내 주변에서 찾기"
              className="flex h-12 w-12 items-center justify-center bg-white text-lg text-[var(--color-deep-blue)] disabled:opacity-50"
            >
              📍
            </button>
            <button
              onClick={handleLocateOnly}
              aria-label="현재 위치"
              className="flex h-12 w-12 items-center justify-center border-t border-white/15 bg-[var(--color-deep-blue)] text-lg text-[var(--color-neon-yellow)]"
            >
              ◎
            </button>
          </div>
        }
      >
        {/* [두 줄을 한 줄로] 손잡이 터치 영역을 44px 로 키운 만큼 목록이 줄어드는데, 상태와
            건수는 원래 따로 있을 이유가 없었다. 합쳐서 그 높이를 되찾는다.
            "지도 탐색으로 ✕"는 위쪽 지도 위 버튼으로 옮겨서 여기서는 뺐다 — 검색만 그만두고
            싶을 때 시트를 열어보지 않아도 바로 눈에 들어오는 자리가 낫다고 판단했다. */}
        <div className="flex flex-shrink-0 items-center gap-2 px-[18px] pb-1.5">
          <span className="tp-caption min-w-0 truncate text-[var(--color-deep-blue)]">
            {statusLabel}
            <span className="ml-1.5 text-[11px] font-normal text-[#8A90B4]">
              {isLoading ? "검색 중..." : hasSearched ? `${places.length}곳${activeGroupLabel ? ` · ${activeGroupLabel}` : ""}` : ""}
            </span>
          </span>
        </div>
        <PlaceList places={places} hasSearched={hasSearched && !isLoading} onSelect={handleSelect} />
      </BottomSheet>

      <PlaceDetailSheet place={selectedPlace} region={region} onClose={() => selectPlace(null)} />
    </div>
  );
}
