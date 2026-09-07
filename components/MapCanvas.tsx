/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */
"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import type { Place, ProjectPin } from "@/lib/types";
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

// [터치 영역] 모바일 최소 터치 타겟(44x44px) 기준을 만족하도록 44x54로 키웠다.
// [렌더 성능] 같은 그룹/서브카테고리는 색상+아이콘이 동일하므로, 마커마다 SVG 문자열을 새로
// 만드는 대신 (color, icon) 조합별로 MarkerImage를 캐싱해 재사용한다. 전국 단위로 마커가
// 수백 개씩 뜨는 상황에서 동일한 이미지를 수백 번 다시 만드는 낭비를 없애 초기 렌더링을 가볍게 한다.
const markerImageCache = new Map<string, any>();
function markerImage(kakao: any, color: string, icon: string) {
  const key = `${color}|${icon}`;
  const cached = markerImageCache.get(key);
  if (cached) return cached;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 44 54">` +
    `<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#000" flood-opacity="0.28"/>` +
    `</filter></defs>` +
    `<g filter="url(#s)">` +
    `<path d="M22 3C13.2 3 6 10.2 6 19c0 11.5 16 30 16 30s16-18.5 16-30C38 10.2 30.8 3 22 3z" fill="${color}"/>` +
    `<circle cx="22" cy="19.5" r="12.5" fill="#fff"/>` +
    `<text x="22" y="25" font-size="15" text-anchor="middle">${icon}</text>` +
    `</g></svg>`;
  const image = new kakao.maps.MarkerImage(
    "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    new kakao.maps.Size(44, 54),
    { offset: new kakao.maps.Point(22, 54) }
  );
  markerImageCache.set(key, image);
  return image;
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
  isDesktop = false,
  projectPins = [],
  onUserPan,
  onViewportChange,
}: {
  places: Place[];
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  onPrefetchPlace?: (place: Place) => void;
  focusTrigger: number; // 값이 바뀔 때마다 이동(검색 완료 또는 위치 확인 신호)
  focusCoords?: { lat: number; lng: number } | null; // 있으면 첫 결과 대신 이 좌표로 이동
  isDesktop?: boolean; // 데스크탑에서는 Ctrl+스크롤로만 확대/축소되도록 제스처를 가로챈다
  projectPins?: ProjectPin[]; // 채널그린 프로젝트 게시글 — 검색과 무관하게 항상 표시
  onUserPan?: (center: { lat: number; lng: number }) => void; // 사용자가 지도를 손으로 드래그해서 옮겼을 때만 호출("현 위치에서 재검색" 버튼 트리거용). panTo() 같은 프로그램적 이동에는 호출되지 않는다.
  // [뷰포트 조회] 이동/줌이 멈출 때마다(idle) 현재 화면 영역을 알려준다. dragend와 달리
  // 프로그램적 이동(panTo, 검색 결과로 자동 이동)에도 발생해야 한다 — 어떤 이유로 화면이
  // 바뀌었든 그 영역의 데이터를 다시 받아야 하기 때문이다.
  onViewportChange?: (viewport: { bbox: [number, number, number, number]; level: number }) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const projectMarkersRef = useRef<any[]>([]);
  const isolatedMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const scriptLoadedRef = useRef(false);
  const isDesktopRef = useRef(isDesktop);
  const onUserPanRef = useRef(onUserPan);
  const onViewportChangeRef = useRef(onViewportChange);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isDesktopRef.current = isDesktop;
  }, [isDesktop]);

  useEffect(() => {
    onUserPanRef.current = onUserPan;
  }, [onUserPan]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  // [제스처 충돌 방지] 데스크탑에서만 Kakao 기본 줌을 끄고, Ctrl+스크롤일 때만 우리가 직접 확대/축소한다.
  // 맨 스크롤(Ctrl 없이)은 막아서 페이지가 튀지 않게 하고, 대신 안내 힌트를 잠깐 보여준다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoomable(!isDesktop);
  }, [isDesktop]);

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
        map.setZoomable(!isDesktopRef.current);
        mapRef.current = map;

        // ["현 위치에서 재검색"] dragend는 사용자가 손으로 지도를 끌었을 때만 발생하고,
        // panTo() 같은 프로그램적 이동(검색 결과로 자동 이동 등)에는 발생하지 않는다. 그래서
        // "사용자가 직접 지도를 옮겼다"를 감지하는 용도로 정확히 들어맞는다.
        kakao.maps.event.addListener(map, "dragend", () => {
          const center = map.getCenter();
          onUserPanRef.current?.({ lat: center.getLat(), lng: center.getLng() });
        });

        // [뷰포트 조회] idle은 드래그·줌·panTo가 모두 끝나 지도가 멈춘 뒤 한 번 발생한다.
        // 이동 중에 계속 쏘지 않으므로 여기서 별도 스로틀을 걸 필요가 없고, 실제 재조회 여부는
        // 상위(useViewportSearch)에서 bbox를 격자에 스냅해 판단한다 — 조금 움직였다고 매번
        // 네트워크를 때리면 안 되기 때문이다.
        const emitViewport = () => {
          const b = map.getBounds();
          if (!b) return;
          const sw = b.getSouthWest();
          const ne = b.getNorthEast();
          onViewportChangeRef.current?.({
            bbox: [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()],
            level: map.getLevel(),
          });
        };
        kakao.maps.event.addListener(map, "idle", emitViewport);
        emitViewport(); // 최초 1회 — 지도가 처음 그려진 직후의 화면도 조회 대상이다.

        // [제스처 충돌 방지] 데스크탑: 일반 스크롤은 페이지가 튀지 않게 막고 힌트만 보여준다.
        // Ctrl+스크롤일 때만 우리가 직접 지도 줌 레벨을 바꾼다. 모바일에서는 그대로 두어
        // 핀치줌/패닝이 Kakao 기본 동작대로 작동하게 한다(touch-action:none으로 페이지 스크롤과의
        // 충돌만 막는다).
        mapDivRef.current.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            if (!isDesktopRef.current) return;
            e.preventDefault();
            if (!e.ctrlKey) {
              if (hintRef.current) {
                hintRef.current.style.opacity = "1";
                if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
                hintTimerRef.current = setTimeout(() => {
                  if (hintRef.current) hintRef.current.style.opacity = "0";
                }, 1100);
              }
              return;
            }
            const current = map.getLevel();
            map.setLevel(e.deltaY < 0 ? current - 1 : current + 1, { animate: true });
          },
          { passive: false }
        );
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
      projectMarkersRef.current.forEach((m) => m.setMap(null));
      projectMarkersRef.current = [];
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

  // [프로젝트 연동] 검색/필터와 무관하게 항상 떠 있는 별도 레이어. 클러스터러에는 섞지 않고
  // (개수가 적고 항상 눈에 띄어야 하므로) 별도 마커로 직접 얹는다. 클릭하면 이 지도 앱의
  // 상세 시트가 아니라 project.magazinegreen.co.kr의 실제 게시글을 새 탭으로 바로 연다.
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao?.maps || !map) return;

    projectMarkersRef.current.forEach((m) => m.setMap(null));
    projectMarkersRef.current = [];

    for (const pin of projectPins) {
      if (!pin.lat || !pin.lng) continue;
      const image = markerImage(kakao, "#E1FC48", "📰");
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(pin.lat, pin.lng), image });
      kakao.maps.event.addListener(marker, "click", () => {
        window.open(pin.url, "_blank", "noopener,noreferrer");
      });
      marker.setMap(map);
      projectMarkersRef.current.push(marker);
    }
  }, [projectPins]);

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
      {/* [제스처 충돌 방지] 지도 영역 안에서는 패닝/핀치줌이 페이지 스크롤보다 우선하도록 touch-action을 잠근다 */}
      <div ref={mapDivRef} className="absolute inset-0 h-full w-full" style={{ touchAction: "none" }} />
      <div
        ref={hintRef}
        className="pointer-events-none absolute left-1/2 top-1/2 z-[45] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-[13px] font-bold text-white opacity-0 transition-opacity duration-200"
      >
        Ctrl 키를 누르고 스크롤하면 확대/축소됩니다
      </div>
    </>
  );
}
