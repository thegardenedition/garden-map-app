"use client";

import { useEffect, useState } from "react";
import type { Place } from "./types";
import { getKakaoGeocoder, liveGeocodeAddress } from "./liveGeocode.ts";

// [pending 업체를 눌렀을 때만 실시간 주소 변환]
// 선택된 업체의 locationState 가 "pending" 이면 브라우저의 카카오 SDK(services.Geocoder)로 주소를
// 한 번 변환한다. 결과는 이 훅의 상태(화면 메모리)에만 두고, 선택이 바뀌거나 상세를 닫으면 사라진다.
// 저장·캐시 없음 — 같은 업체를 다시 누르면 다시 변환한다.
// SDK 는 MapCanvas 가 비동기로 올리므로 services 가 나타날 때까지 잠깐 기다린다(최대 8초).

export type LiveLocationStatus = "idle" | "loading" | "ok" | "zero" | "error" | "unavailable";

export interface LiveLocation {
  status: LiveLocationStatus;
  coordinates: [number, number] | null;
}

const IDLE: LiveLocation = { status: "idle", coordinates: null };
const WAIT_MS = 8000;
const POLL_MS = 250;

export function useLiveLocation(place: Place | null): LiveLocation {
  const [state, setState] = useState<{ placeId: string | null; value: LiveLocation }>({ placeId: null, value: IDLE });
  const placeId = place?.placeId ?? null;
  const address = place?.address ?? "";
  // 끄는 스위치: NEXT_PUBLIC_LIVE_GEOCODE=off 로 빌드하면 실시간 변환을 하지 않고 「불러오지 못했어요」+ 주소 검색 링크만 보인다.
  const disabled = process.env.NEXT_PUBLIC_LIVE_GEOCODE === "off";
  const needs = place?.locationState === "pending" && !disabled;

  useEffect(() => {
    if (!needs || !placeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    // 로딩 표시는 상태를 따로 넣지 않고 아래 반환부에서 「id 가 아직 안 맞으면 loading」으로 얻는다(이펙트 안 동기 setState 방지)

    const attempt = () => {
      if (cancelled) return;
      const geocoder = getKakaoGeocoder();
      if (!geocoder) {
        if (Date.now() - startedAt >= WAIT_MS) {
          setState({ placeId, value: { status: "unavailable", coordinates: null } });
          return;
        }
        timer = setTimeout(attempt, POLL_MS);
        return;
      }
      void liveGeocodeAddress(address, geocoder).then((r) => {
        if (cancelled) return;
        setState({ placeId, value: r.status === "ok" ? { status: "ok", coordinates: r.coordinates } : { status: r.status, coordinates: null } });
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // 선택이 바뀌거나 상세가 닫히면 결과를 버린다 — 같은 업체를 다시 열면 다시 변환한다(화면 메모리에도 남기지 않는다)
      setState({ placeId: null, value: IDLE });
    };
  }, [needs, placeId, address]);

  // 다른 업체로 바뀐 직후 한 프레임 동안 이전 업체의 결과가 새 업체에 붙지 않도록 id 가 맞을 때만 쓴다.
  if (disabled && place?.locationState === "pending") return { status: "unavailable", coordinates: null };
  if (!needs || !placeId) return IDLE;
  return state.placeId === placeId ? state.value : { status: "loading", coordinates: null };
}
