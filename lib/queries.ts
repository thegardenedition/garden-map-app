"use client";

import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Place, Region } from "./types";
import { searchNearby, searchPlaces } from "./api";

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

export function usePlacesSearch(region: Region, keyword: string): UseQueryResult<Place[]> {
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  return useQuery({
    queryKey: ["places", region, debouncedKeyword],
    queryFn: () => searchPlaces(region, debouncedKeyword),
    enabled: debouncedKeyword.trim().length > 0,
    // [지수 백오프] TanStack Query 자체 재시도 — 네트워크 계층(api.ts)의 재시도와는 다른 레이어(스키마/서버 오류 대응)
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 60_000,
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
