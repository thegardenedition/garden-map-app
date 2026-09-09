"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GroupId, Place, Region, SubId } from "./types";
import type { Bbox } from "./api";
import {
  isRetriableError,
  browseByBbox,
  browseByCategory,
  searchBizPlaces,
  searchNearby,
  searchParks,
  fetchProjectPins,
} from "./api";

/*
 * [재시도 기준을 lib/api.ts 와 공유한다]
 * 예전에는 여기 retry 가 상태코드를 가리지 않아서, api.ts 의 저수준 재시도 3회와 곱해져
 * 한 번의 조회가 최대 9번의 요청이 됐다. 워커에 403(출처 게이트)·429(요청 한도)가 생긴 뒤로는
 * 그게 곧 "한도를 넘긴 사용자가 한도를 더 밀어붙이는" 동작이었다. 두 층이 같은 기준을 쓰도록
 * isRetriableError 를 공유한다 - 4xx 는 즉시 포기, 5xx·네트워크 오류만 재시도.
 */

// [디바운스 / 스로틀]
// 텍스트 입력(검색어)은 Debounce 300ms: 타이핑이 끝난 뒤에만 API를 호출해 불필요한 요청을 막는다.
// 지도 이동은 카카오 idle 이벤트가 이미 "멈춤"을 보장하므로 별도 디바운스 없이,
// 아래 snapBbox로 재조회 여부를 판단한다.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// 카카오 줌 레벨은 숫자가 작을수록 확대다. 이 레벨보다 확대돼 있으면 화면 영역(bbox) 조회로,
// 그보다 축소돼 있으면(= 여러 시도가 한 화면에) 전국 균등 표본으로 전환한다.
// 전국 뷰에서 bbox로 조회하면 결국 3,141건 중 500건을 이름순으로 자르는 셈이라
// 특정 지역만 남는 문제가 되돌아오기 때문에, 축소 상태에서는 서버의 지역 균등 분배를 쓴다.
export const VIEWPORT_MAX_LEVEL = 10;

export interface Viewport {
  bbox: Bbox;
  level: number;
}

// [재조회 억제] 지도를 조금 움직일 때마다 네트워크를 때리면 안 된다. 화면 영역을 격자에 스냅해서
// 같은 칸 안에서 움직이는 동안에는 쿼리 키가 그대로 유지되도록 한다(TanStack Query가 캐시로 응답).
// 격자 크기는 현재 화면 폭의 약 절반이고, 화면 폭이 미세하게 흔들려도 칸이 바뀌지 않도록
// 2의 거듭제곱으로 양자화한다. 결과적으로 요청하는 영역은 실제 화면보다 조금 넓어서(패딩),
// 살짝 밀어낸 가장자리 데이터도 이미 손에 들고 있다.
export function snapBbox([minLng, minLat, maxLng, maxLat]: Bbox): Bbox {
  const pow2 = (v: number) => Math.pow(2, Math.round(Math.log2(Math.max(v, 1e-6))));
  const stepLng = pow2((maxLng - minLng) / 2);
  const stepLat = pow2((maxLat - minLat) / 2);
  const round = (v: number) => Number(v.toFixed(5));
  return [
    round(Math.floor(minLng / stepLng) * stepLng),
    round(Math.floor(minLat / stepLat) * stepLat),
    round(Math.ceil(maxLng / stepLng) * stepLng),
    round(Math.ceil(maxLat / stepLat) * stepLat),
  ];
}

export function useBizSearch(region: Region, keyword: string): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const term = debouncedKeyword.trim();
  return useQuery({
    queryKey: ["biz-places", region, term],
    queryFn: () => searchBizPlaces(region, term),
    enabled: term.length > 0,
    // [지수 백오프] TanStack Query 자체 재시도 — 네트워크 계층(api.ts)의 재시도와는 다른 레이어(스키마/서버 오류 대응)
    retry: (count, err) => isRetriableError(err) && count < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 60_000,
  });
}

// [속도 개선] 공원은 전국 데이터를 다 훑어야 해서 느리다. useBizSearch와 별개 쿼리로 돌려서
// 조경회사/자재 결과를 가로막지 않게 한다. fetchAllParks는 세션 내에서 캐시된다.
export function useParkSearch(keyword: string): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const term = debouncedKeyword.trim();
  return useQuery({
    queryKey: ["park-places", term],
    queryFn: () => searchParks(term),
    enabled: term.length > 0,
    retry: (count, err) => isRetriableError(err) && count < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5 * 60_000,
  });
}

// [탐색 조회] 검색어 없이 지도를 보고 있을 때의 데이터 공급원.
// 확대 상태면 화면 영역 전체를, 축소 상태면 전국 균등 표본을 가져온다.
// 이 하나가 켜져 있는 동안 검색 쿼리는 꺼져 있어야 중복 요청이 없다(page.tsx에서 배타 처리).
export function useBrowseSearch(
  region: Region,
  group: GroupId | null,
  sub: SubId | null,
  viewport: Viewport | null,
  enabled: boolean
): UseQueryResult<Place[]> {
  const useBbox = Boolean(viewport) && (viewport as Viewport).level <= VIEWPORT_MAX_LEVEL;
  const snapped = useMemo(
    () => (useBbox && viewport ? snapBbox(viewport.bbox) : null),
    [useBbox, viewport]
  );

  return useQuery({
    queryKey: useBbox
      ? ["browse", "bbox", snapped, group, sub]
      : ["browse", "nationwide", region, group, sub],
    queryFn: () =>
      useBbox && snapped
        ? browseByBbox(snapped, group, sub)
        : browseByCategory(region, group, sub),
    enabled: enabled && (!useBbox || Boolean(snapped)),
    retry: (count, err) => isRetriableError(err) && count < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5 * 60_000,
    // 지도를 움직이는 동안 목록이 빈 화면으로 깜빡이지 않도록 직전 결과를 유지한다.
    placeholderData: (prev) => prev,
  });
}

// [내 주변 + 카테고리] 그룹을 쿼리 키와 인자에 함께 넘긴다. 예전에는 반경 결과를 받아온 뒤
// 클라이언트에서 걸렀는데, 반경 안에 조경회사가 200건이고 자재가 3건이면 자재 칩을 눌렀을 때
// 3건만 남는 식이라 "이 근처 자재상 전체"를 볼 수 없었다. 이제 카테고리별로 각각 반경을 조회한다.
// "내 주변에서 찾기"가 훑는 반경. 지도를 이 범위에 맞춰 보여줘야 하므로 화면 쪽에서도 쓴다.
// 예전에는 이 값이 queryFn 안에만 있어서, 지도는 이 숫자를 모른 채 제멋대로 확대했다.
export const NEARBY_RADIUS_M = 5000;

export function useNearbySearch(
  coords: { lat: number; lng: number } | null,
  group: GroupId | null
): UseQueryResult<Place[]> {
  return useQuery({
    queryKey: ["nearby", coords?.lat, coords?.lng, group],
    queryFn: () => searchNearby(coords!.lat, coords!.lng, NEARBY_RADIUS_M, group),
    enabled: Boolean(coords),
    retry: (count, err) => isRetriableError(err) && count < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 30_000,
  });
}

// [프로젝트 연동] 검색어와 무관하게 항상 로드되는 레이어라 debounce 없이 마운트 시 한 번만 가져온다.
export function useProjectPins() {
  return useQuery({
    queryKey: ["project-pins"],
    queryFn: fetchProjectPins,
    staleTime: 10 * 60_000,
    retry: (count, err) => isRetriableError(err) && count < 1,
  });
}
