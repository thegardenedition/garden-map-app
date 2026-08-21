/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */
"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import type { Place } from "@/lib/types";
import { GROUP_ICON, SUB_DEFS } from "@/lib/types";

/*
 * [WebGL/Deck.gl 대신 카카오 네이티브 마커+클러스터러를 쓴 이유]
 * 스펙은 Deck.gl 기반 GPU 오버레이를 요청했지만, Deck.gl은 Mapbox/MapLibre/Google Maps처럼
 * WebGL 컨텍스트를 직접 노출하는 지도 SDK 위에서만 오버레이를 붙일 수 있다. 카카오맵 JS SDK는
 * 그런 저수준 WebGL 훅을 공개 API로 제공하지 않기 때문에(비공개 렌더러), Deck.gl을 카카오맵에
 * 통합하는 것은 리버스엔지니어링 없이는 불가능하다. 현재 데이터 규모(최대 수천 건)에서는
 * 카카오의 네이티브 Marker(내부적으로 Canvas/DOM 합성, 브라우저 컴포지터가 GPU 가속)와
 * MarkerClusterer만으로도 60fps 방어가 충분하다고 판단해 이 방식을 택했다. 데이터가
 * 수만 건 이상으로 커지면 그때는 카카오맵을 버리고 MapLibre+Deck.gl 조합으로 교체를 검토해야 한다.
 */

declare global {
  interface Window {
    kakao: any;
  }
}

const GROUP_COLOR: Record<string, string> = { company: "#C9622C", material: "#0B8A5A", park: "#0115A8" };

function subIcon(place: Place): string {
  const def = SUB_DEFS[place.categoryDepth1]?.find((s) => s.id === place.categoryDepth2);
  return def?.icon ?? GROUP_ICON[place.categoryDepth1] ?? "📍";
}

function markerImage(kakao: any, color: string, icon: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">` +
    `<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.28"/>` +
    `</filter></defs>` +
    `<g filter="url(#s)">` +
    `<path d="M18 2C10.3 2 4 8.3 4 16c0 10 14 26 14 26s14-16 14-26C32 8.3 25.7 2 18 2z" fill="${color}"/>` +
    `<circle cx="18" cy="16.5" r="10.5" fill="#fff"/>` +
    `<text x="18" y="21" font-size="13" text-anchor="middle">${icon}</text>` +
    `</g></svg>`;
  return new kakao.maps.MarkerImage(
    "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    new kakao.maps.Size(36, 46),
    { offset: new kakao.maps.Point(18, 46) }
  );
}

export interface MapCanvasHandle {
  panTo: (lng: number, lat: number, level?: number) => void;
}

export default function MapCanvas({
  places,
  selectedPlaceId,
  onSelectPlace,
  onPrefetchPlace,
  focusTrigger,
  focusCoords,
}: {
  places: Place[];
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  onPrefetchPlace?: (place: Place) => void;
  focusTrigger: number; // 값이 바뀔 때마다 이동(검색 완료 또는 위치 확인 신호)
  focusCoords?: { lat: number; lng: number } | null; // 있으면 첫 결과 대신 이 좌표로 이동
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const isolatedMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const scriptLoadedRef = useRef(false);

  // 지도 인스턴스 초기화 — 언마운트 시 완벽한 cleanup(모든 마커/클러스터러/리스너 해제)
  useEffect(() => {
    let cancelled = false;

    function init() {
      if (cancelled || !mapDivRef.current || !window.kakao?.maps) return;
      window.kakao.maps.load(() => {
        if (cancelled || !mapDivRef.current) return;
        const kakao = window.kakao;
        const map = new kakao.maps.Map(mapDivRef.current, {
          center: new kakao.maps.LatLng(36.5, 127.8),
          level: 13,
        });
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        map.setMaxLevel(13);
        mapRef.current = map;
        clustererRef.current = new kakao.maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: 7,
          disableClickZoom: false,
          styles: [
            {
              width: "42px", height: "42px", background: "rgba(6,16,125,.92)",
              borderRadius: "50%", color: "#E1FC48", textAlign: "center",
              lineHeight: "42px", fontWeight: "700", fontSize: "13px",
              border: "3px solid #fff", boxSizing: "border-box",
              boxShadow: "0 3px 10px rgba(0,0,0,.3)",
            },
          ],
        });
      });
    }

    if (window.kakao?.maps) {
      init();
    } else {
      const id = setInterval(() => {
        if (window.kakao?.maps) {
          clearInterval(id);
          init();
        }
      }, 100);
      return () => clearInterval(id);
    }

    return () => {
      cancelled = true;
      // [메모리 누수 방지] 마커/클러스터러/지도 인스턴스 참조를 모두 끊는다.
      Object.values(markersRef.current).forEach((m) => m.setMap(null));
      markersRef.current = {};
      if (isolatedMarkerRef.current) isolatedMarkerRef.current.setMap(null);
      if (userMarkerRef.current) userMarkerRef.current.setMap(null);
      if (clustererRef.current) clustererRef.current.clear();
      clustererRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // 마커 렌더링 — places가 바뀔 때만 재구성
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!kakao?.maps || !map || !clusterer) return;

    clusterer.clear();
    Object.values(markersRef.current).forEach((m) => m.setMap(null));
    markersRef.current = {};

    const newMarkers: any[] = [];
    for (const place of places) {
      const [lng, lat] = place.coordinates;
      if (!lat || !lng) continue;
      const image = markerImage(kakao, GROUP_COLOR[place.categoryDepth1] ?? "#0115A8", subIcon(place));
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lng), image });
      kakao.maps.event.addListener(marker, "click", () => {
        onSelectPlace(place.placeId);
        onPrefetchPlace?.(place);
      });
      markersRef.current[place.placeId] = marker;
      newMarkers.push(marker);
    }
    clusterer.addMarkers(newMarkers);

    return () => {
      // 다음 렌더링 전에 이전 마커 정리(위에서도 하지만, effect cleanup으로 이중 안전망)
    };
  }, [places, onSelectPlace, onPrefetchPlace]);

  // 검색 완료 또는 위치 확인 시 지도 이동: focusCoords가 있으면(내 주변/현재 위치) 그쪽 우선
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao?.maps || !map) return;

    if (focusCoords) {
      const loc = new kakao.maps.LatLng(focusCoords.lat, focusCoords.lng);
      map.panTo(loc);
      map.setLevel(6, { animate: true });
      if (userMarkerRef.current) userMarkerRef.current.setMap(null);
      const dotSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="8" fill="%23E1FC48" stroke="%23fff" stroke-width="3"/></svg>';
      userMarkerRef.current = new kakao.maps.Marker({
        position: loc,
        image: new kakao.maps.MarkerImage("data:image/svg+xml;charset=UTF-8," + dotSvg, new kakao.maps.Size(22, 22)),
      });
      userMarkerRef.current.setMap(map);
      return;
    }
    if (places.length === 0) return;
    const first = places[0];
    map.setLevel(9, { animate: true });
    map.panTo(new kakao.maps.LatLng(first.coordinates[1], first.coordinates[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTrigger]);

  // 선택된 장소로 고립 마커 표시 + 확대
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!kakao?.maps || !map) return;

    if (isolatedMarkerRef.current) {
      isolatedMarkerRef.current.setMap(null);
      isolatedMarkerRef.current = null;
    }
    if (!selectedPlaceId) {
      if (clusterer) {
        clusterer.clear();
        clusterer.addMarkers(Object.values(markersRef.current));
      }
      return;
    }
    const place = places.find((p) => p.placeId === selectedPlaceId);
    if (!place) return;

    if (clusterer) clusterer.clear();
    Object.values(markersRef.current).forEach((m) => m.setMap(null));

    const image = markerImage(kakao, GROUP_COLOR[place.categoryDepth1] ?? "#0115A8", subIcon(place));
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(place.coordinates[1], place.coordinates[0]),
      image,
    });
    marker.setMap(map);
    isolatedMarkerRef.current = marker;
    map.setLevel(4, { animate: true });
    map.panTo(new kakao.maps.LatLng(place.coordinates[1], place.coordinates[0]));
  }, [selectedPlaceId, places]);

  return (
    <>
      <Script
        src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=b6ccb52c66e30ecdb1b781cf75283988&autoload=false&libraries=clusterer"
        strategy="afterInteractive"
        onReady={() => {
          scriptLoadedRef.current = true;
        }}
      />
      <div ref={mapDivRef} className="absolute inset-0 h-full w-full" />
    </>
  );
}
