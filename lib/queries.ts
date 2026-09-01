"use client";

import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Place, Region } from "./types";
import { searchBizPlaces, searchNearby, searchParks, fetchProjectPins } from "./api";

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

export function useBizSearch(region: Region, keyword: string): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  return useQuery({
    queryKey: ["biz-places", region, debouncedKeyword],
    queryFn: () => searchBizPlaces(region, debouncedKeyword),
    enabled: debouncedKeyword.trim().length > 0,
    // [지수 백오프] TanStack Query 자체 재시도 — 네트워크 계층(api.ts)의 재시도와는 다른 레이어(스키마/서버 오류 대응)
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 60_000,
  });
}

// [속도 개선] 전국 공원 데이터를 다 훑어야 해서 느리다. useBizSearch와 별개 쿼리로 돌려서
// 조경회사/자재 결과가 먼저 뜨도록 하고, 공원은 준비되는 대로 뒤에서 채워진다.
export function useParkSearch(keyword: string): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  return useQuery({
    queryKey: ["park-places", debouncedKeyword],
    queryFn: () => searchParks(debouncedKeyword),
    enabled: debouncedKeyword.trim().length > 0,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5 * 60_000,
  });
}

export function useNearbySearch(coords: { lat: number; lng: number } | null): UseQueryResult<Place[]> {
  return useQuery({
    queryKey: ["nearby", coords?.lat, coords?.lng],
    queryFn: () => searchNearby(coords!.lat, coords!.lng, 5000),
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
