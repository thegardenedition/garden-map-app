"use client";

import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GroupId, Place, Region, SubId } from "./types";
import { browseByCategory, searchBizPlaces, searchNearby, searchParks, fetchProjectPins } from "./api";

// [디바운스 / 스로틀]
// 텍스트 입력(검색어)은 Debounce 300ms: 타이핑이 끝난 뒤에만 API를 호출해 불필요한 요청을 막는다.
// 지도 Panning은 Throttle 100ms로 별도 처리(MapCanvas 내부)하며, 여기서는 쿼리 트리거만 다룬다.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// [카테고리 탐색을 1급 쿼리로 승격]
// 예전에는 `enabled: keyword.length > 0` 이라 검색어가 없으면 아무것도 조회하지 않았고,
// 카테고리 칩은 이미 받아온 결과를 사후 필터링하는 역할뿐이었다. 그래서 "조경회사 전체를
// 보고 싶다"는 가장 흔한 의도가 아예 표현 불가능했다(칩만 누르면 빈 화면).
// 이제 검색어가 없어도 그룹이 선택돼 있으면 자체 대장에서 그 카테고리를 통째로 연다.
export function useBizSearch(
  region: Region,
  keyword: string,
  group: GroupId | null,
  sub: SubId | null
): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const term = debouncedKeyword.trim();
  const browseMode = term.length === 0 && Boolean(group) && group !== "park";

  return useQuery({
    queryKey: ["biz-places", region, term, browseMode ? group : null, browseMode ? sub : null],
    queryFn: () =>
      browseMode ? browseByCategory(region, group as GroupId, sub) : searchBizPlaces(region, term),
    enabled: term.length > 0 || browseMode,
    // [지수 백오프] TanStack Query 자체 재시도 — 네트워크 계층(api.ts)의 재시도와는 다른 레이어(스키마/서버 오류 대응)
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 60_000,
  });
}

// [속도 개선] 전국 공원 데이터를 다 훑어야 해서 느리다. useBizSearch와 별개 쿼리로 돌려서
// 조경회사/자재 결과가 먼저 뜨도록 하고, 공원은 준비되는 대로 뒤에서 채워진다.
export function useParkSearch(keyword: string, group: GroupId | null): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const term = debouncedKeyword.trim();
  const browseAll = term.length === 0 && group === "park";
  return useQuery({
    queryKey: ["park-places", term, browseAll],
    queryFn: () => searchParks(term, browseAll),
    enabled: term.length > 0 || browseAll,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5 * 60_000,
  });
}

// [내 주변 + 카테고리] 그룹을 쿼리 키와 인자에 함께 넘긴다. 예전에는 반경 결과를 받아온 뒤
// 클라이언트에서 걸렀는데, 반경 안에 조경회사가 200건이고 자재가 3건이면 자재 칩을 눌렀을 때
// 3건만 남는 식이라 "이 근처 자재상 전체"를 볼 수 없었다. 이제 카테고리별로 각각 반경을 조회한다.
export function useNearbySearch(
  coords: { lat: number; lng: number } | null,
  group: GroupId | null
): UseQueryResult<Place[]> {
  return useQuery({
    queryKey: ["nearby", coords?.lat, coords?.lng, group],
    queryFn: () => searchNearby(coords!.lat, coords!.lng, 5000, group),
    enabled: Boolean(coords),
    retry: 2,
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
    retry: 1,
  });
}
