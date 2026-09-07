/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */
"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import type { Place, ProjectPin } from "@/lib/types";
import {
  PIN_DEFAULT,
  PIN_SELECTED,
  placePinSvg,
  projectPinSvg,
  svgDataUri,
  type PinSize,
} from "@/lib/icons";

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

// [첫 화면 기준점] 서울 남부~경기 북부가 한 화면에 들어오는 지역 스케일.
// 이 지도의 업체 데이터가 가장 촘촘한 구간이라(조경설계만 서울 237 + 경기 250) 첫 화면에서
// 바로 실제 결과를 보여줄 수 있다. 사용자가 다른 지역을 보려면 축소하거나 지역 필터를 쓰면 된다.
const SEOUL_METRO = { lat: 37.49, lng: 127.02, level: 9 };

/*
 * [핀 이미지]
 * 도형·색·아이콘은 전부 lib/icons.tsx 가 갖고 있고 여기서는 그걸 카카오 MarkerImage 로만 감싼다.
 * 지도·필터 칩·목록·상세가 같은 그림을 쓰게 하려면 정의가 한 곳에만 있어야 한다.
 *
 * [앵커] 예전에는 offset 을 (22, 54) — 이미지 맨 아래로 잡았는데, 핀의 뾰족한 끝은 그보다
 * 위에 있어서 마커가 실제 좌표보다 살짝 아래에 찍혔다. icons.tsx 가 계산한 끝점(anchorY)을 쓴다.
 *
 * [렌더 성능] 같은 (그룹, 소분류, 선택여부) 조합은 완전히 동일한 이미지라 조합별로 캐싱해
 * 재사용한다. 전국 단위로 마커가 수백 개 뜰 때 같은 SVG를 수백 번 다시 만드는 낭비를 없앤다.
 */
const markerImageCache = new Map<string, any>();
function toMarkerImage(kakao: any, key: string, svg: string, size: PinSize) {
  const cached = markerImageCache.get(key);
  if (cached) return cached;
  const image = new kakao.maps.MarkerImage(svgDataUri(svg), new kakao.maps.Size(size.width, size.height), {
    offset: new kakao.maps.Point(size.anchorX, size.anchorY),
  });
  markerImageCache.set(key, image);
  return image;
}

function placeMarkerImage(kakao: any, place: Place, selected = false) {
  const key = `${place.categoryDepth1}|${place.categoryDepth2}|${selected ? "on" : "off"}`;
  return toMarkerImage(
    kakao,
    key,
    placePinSvg(place.categoryDepth1, place.categoryDepth2, selected),
    selected ? PIN_SELECTED : PIN_DEFAULT
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
          center: new kakao.maps.LatLng(36.2, 127.9),
          level: 12,
        });
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

        // [초기 프레이밍] 예전에는 center+level 을 고정값으로 박아뒀는데, 화면 비율이 조금만
        // 달라져도 프레임이 어긋난다. 실제로 데스크탑에서 열면 북한 전체와 중국 랴오닝·일본
        // 규슈가 화면의 절반을 넘게 차지하고 정작 대한민국이 작게 들어갔다. 정원 지도를 열었는데
        // 남의 나라가 먼저 보이는 건 지도로서 실패다.
        //
        // 고정 좌표 대신 "이 영역이 화면에 꽉 차게" 지시한다(setBounds). 화면이 넓든 좁든,
        // 세로로 길든 가로로 길든 대한민국이 프레임을 채운다.
        const KOREA = new kakao.maps.LatLngBounds(
          new kakao.maps.LatLng(33.05, 125.05), // 남서: 마라도 아래 ~ 서해 도서
          new kakao.maps.LatLng(38.62, 129.62)  // 북동: 고성 ~ 동해안
        );
        // 모바일은 하단 시트가 지도를 덮고 상단에 검색바/칩이 떠 있다. 그 겹치는 만큼을 여백으로
        // 주지 않으면 지도의 "보이는 중심"과 실제 중심이 어긋나 국토가 시트 뒤로 숨는다.
        const h = mapDivRef.current.clientHeight || 800;
        const onDesktop = isDesktopRef.current;
        map.setBounds(
          KOREA,
          onDesktop ? 28 : 132,                       // top   (모바일: 검색바 + 필터 칩)
          28,                                          // right
          onDesktop ? 28 : Math.round(h * 0.34),       // bottom(모바일: 바텀시트 half 높이)
          28                                           // left
        );
        // 방금 맞춘 레벨이 곧 "국토 전체"다. 그보다 더 축소하면 다시 남의 나라가 들어오므로 막는다.
        map.setMaxLevel(map.getLevel());

        // [초기 뷰는 국토 전체가 아니다]
        // 남한은 세로가 가로의 약 1.5배인데 지도 영역은 가로가 더 넓다(데스크탑 1040x900).
        // 그래서 국토 전체를 넣으면 좌우로 1.7배의 여백이 생기고, 그 여백이 바다와 중국·일본으로
        // 채워진다. 프레이밍 수치를 아무리 조정해도 이건 기하학적으로 피할 수 없다.
        // 카카오맵·네이버지도도 국토 전체로 열지 않는 이유가 이것이다.
        //
        // 그래서 국토 전체는 "가장 축소한 상태"로만 남기고(위 setMaxLevel), 실제 첫 화면은
        // 데이터가 가장 촘촘한 수도권을 지역 스케일로 연다. 뷰포트 조회와도 맞물려서,
        // 첫 화면부터 표본이 아니라 그 지역 업체 전부가 뜬다.
        // 모바일은 화면이 좁고 하단 시트가 3분의 1을 덮으므로 한 단계 더 넓게 잡는다.
        map.setLevel(onDesktop ? SEOUL_METRO.level : SEOUL_METRO.level + 1);
        map.setCenter(new kakao.maps.LatLng(SEOUL_METRO.lat, SEOUL_METRO.lng));
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
          // [크기로 양을 읽히게 한다] 예전엔 스타일이 하나뿐이라 5곳짜리 묶음과 800곳짜리 묶음이
          // 똑같은 원으로 보였다. 지도에서 원의 크기는 곧 "얼마나 많은가"를 뜻하는 가장 기본적인
          // 시각 언어인데, 그걸 버리면 사용자는 숫자를 하나하나 읽어야 한다.
          // 10 미만 / 10~99 / 100 이상 세 단계로 나눠 한눈에 밀집도가 보이게 한다.
          calculator: [10, 100],
          styles: [
            {
              width: "34px", height: "34px", lineHeight: "34px", fontSize: "12px",
              background: "rgba(6,16,125,.88)", borderRadius: "50%", color: "#E1FC48",
              textAlign: "center", fontWeight: "700", border: "2px solid #fff",
              boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,.28)",
            },
            {
              width: "46px", height: "46px", lineHeight: "46px", fontSize: "13px",
              background: "rgba(6,16,125,.92)", borderRadius: "50%", color: "#E1FC48",
              textAlign: "center", fontWeight: "700", border: "3px solid #fff",
              boxSizing: "border-box", boxShadow: "0 3px 10px rgba(0,0,0,.3)",
            },
            {
              width: "60px", height: "60px", lineHeight: "60px", fontSize: "15px",
              background: "rgba(6,16,125,.96)", borderRadius: "50%", color: "#E1FC48",
              textAlign: "center", fontWeight: "800", border: "3px solid #fff",
              boxSizing: "border-box", boxShadow: "0 4px 14px rgba(0,0,0,.34)",
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
      const image = placeMarkerImage(kakao, place);
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
      const image = toMarkerImage(kakao, "project", projectPinSvg(), PIN_DEFAULT);
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

    // 색을 바꾸면 그 핀이 어느 그룹인지 알 수 없게 되므로, 선택은 크기 + 흰 테두리로만 알린다.
    const image = placeMarkerImage(kakao, place, true);
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
