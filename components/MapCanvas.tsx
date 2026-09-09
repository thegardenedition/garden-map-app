/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */
"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import type { Place, ProjectPin } from "@/lib/types";
import { SUB_DEFS, formatDistance } from "@/lib/types";
import {
  PIN_COMPACT,
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

/*
 * [줌 단계별 핀 크기]
 * 가까이 보면 핀 하나하나가 관심사지만, 넓게 볼수록 궁금한 것은 "어디에 몰려 있는가"로
 * 바뀐다. 그런데 크기가 하나뿐이면 넓게 볼 때 핀이 서로 겹쳐 덩어리로 뭉개지고, 정작
 * 밀집도는 더 안 보인다. 카카오 지도는 레벨 숫자가 클수록 넓게 보이므로,
 *
 *   레벨 5 이하  기본 핀(32×38) — 개별 장소를 고르는 구간
 *   레벨 6~7     작은 핀(24×30) — 여러 곳을 한눈에 훑는 구간
 *   레벨 8 이상  클러스터만     — 개별 핀은 의미가 없고 묶음 크기가 정보가 되는 구간
 *
 * 예전에는 크기가 하나였고 클러스터가 레벨 7부터 나와서, 가운데 구간이 아예 없었다.
 * 가운데를 6~8 로 잡아 봤더니 서울 레벨 7 에서 개별 핀이 259개까지 떠서 6~7 로 줄였다.
 * 클러스터는 짝이 없는 마커까지 묶지는 않으므로, 레벨 8 이상에서도 작은 핀이 몇 개 남는 것은
 * 카카오 클러스터러의 정상 동작이다.
 */
function pinSizeForLevel(level: number): PinSize {
  return level >= 6 ? PIN_COMPACT : PIN_DEFAULT;
}

function placeMarkerImage(kakao: any, place: Place, selected = false, size?: PinSize) {
  const use = selected ? PIN_SELECTED : (size ?? PIN_DEFAULT);
  // 크기를 키에 넣지 않으면 축소용 이미지가 기본 크기로 캐시돼 섞인다.
  const key = `${place.categoryDepth1}|${place.categoryDepth2}|${selected ? "on" : "off"}|${use.width}`;
  return toMarkerImage(kakao, key, placePinSvg(place.categoryDepth1, place.categoryDepth2, selected), use);
}

export interface MapCanvasHandle {
  panTo: (lng: number, lat: number, level?: number) => void;
}

/*
 * [PC 핀 호버 툴팁]
 * 데스크톱에서는 핀을 눌러 상세를 열기 전에 "이게 뭔지"부터 알고 싶다. 지금은 눌러야만 알 수
 * 있어서, 원하는 곳을 찾을 때까지 핀을 하나씩 눌렀다 닫았다 해야 했다.
 *
 * 터치 기기에는 붙이지 않는다. 모바일 브라우저는 탭에도 mouseover 를 쏘기 때문에, 손가락을
 * 뗀 뒤에도 툴팁이 남아 지도를 가린다.
 */
function escapeHtml(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hoverTooltipHtml(place: Place): string {
  const sub = SUB_DEFS[place.categoryDepth1]?.find((d) => d.id === place.categoryDepth2)?.label ?? "";
  const dist = formatDistance(place.distanceM);
  const meta = [sub, dist].filter(Boolean).join(" · ");
  // pointer-events:none 이 중요하다. 툴팁이 마우스를 가로채면 그 즉시 mouseout 이 떠서
  // 툴팁이 깜빡이고, 핀 클릭도 막힌다.
  return (
    '<div style="pointer-events:none;transform:translateY(-46px);max-width:260px;' +
    'background:#fff;color:#06107D;border-radius:12px;padding:9px 12px;' +
    'box-shadow:0 6px 20px rgba(0,0,0,0.22);font-size:12.5px;line-height:1.45;">' +
    '<div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
    escapeHtml(place.placeName) +
    "</div>" +
    (meta ? '<div style="opacity:0.62;font-size:11.5px;margin-top:1px;">' + escapeHtml(meta) + "</div>" : "") +
    (place.address
      ? '<div style="opacity:0.75;font-size:11.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        escapeHtml(place.address) +
        "</div>"
      : "") +
    "</div>"
  );
}

export default function MapCanvas({
  places,
  selectedPlaceId,
  onSelectPlace,
  onPrefetchPlace,
  focusTrigger,
  focusCoords,
  focusAccuracy,
  focusRadius,
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
  focusAccuracy?: number | null; // 브라우저가 알려준 위치 오차(m). 오차 원 크기에 쓴다.
  focusRadius?: number | null; // 반경 검색 중이면 그 반경(m). 지도를 이 범위에 맞춘다.
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
  // 줌이 바뀌면 이미 올려둔 마커의 이미지를 다시 만들어야 한다. 그러려면 마커마다 어떤 장소인지
  // 알아야 하므로 나란히 들고 있는다(markersRef 의 값 모양을 바꾸면 쓰는 곳이 다섯 군데라 위험).
  const markerPlacesRef = useRef<Record<string, Place>>({});
  const pinWidthRef = useRef<number>(PIN_DEFAULT.width);
  const projectMarkersRef = useRef<any[]>([]);
  const isolatedMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);
  const searchCircleRef = useRef<any>(null);
  const hoverOverlayRef = useRef<any>(null);
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

        // [줌 단계가 바뀌면 핀 크기도 바뀐다] 크기 구간이 실제로 넘어갔을 때만 손댄다.
        // 레벨이 한 칸 움직일 때마다 수백 개 마커의 이미지를 다시 만들면 확대가 버벅인다.
        kakao.maps.event.addListener(map, "zoom_changed", () => {
          const size = pinSizeForLevel(map.getLevel());
          if (size.width === pinWidthRef.current) return;
          pinWidthRef.current = size.width;
          for (const [id, marker] of Object.entries(markersRef.current)) {
            const place = markerPlacesRef.current[id];
            if (!place) continue;
            marker.setImage(placeMarkerImage(kakao, place, false, size));
          }
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
          // 레벨 8부터 묶는다. 6~7 은 작은 핀으로 개별 장소를 보여주는 구간이다(pinSizeForLevel).
          minLevel: 8,
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
      if (accuracyCircleRef.current) accuracyCircleRef.current.setMap(null);
      if (searchCircleRef.current) searchCircleRef.current.setMap(null);
      if (hoverOverlayRef.current) hoverOverlayRef.current.setMap(null);
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
    markerPlacesRef.current = {};
    // 지금 보고 있는 축척에 맞는 크기로 만든다. 줌이 바뀌면 위 zoom_changed 가 갈아 끼운다.
    const currentPinSize = pinSizeForLevel(map.getLevel());
    pinWidthRef.current = currentPinSize.width;
    // 호버 중이던 핀이 이번 렌더에서 사라질 수 있다. 그러면 mouseout 이 오지 않아 툴팁만 남는다.
    if (hoverOverlayRef.current) {
      hoverOverlayRef.current.setMap(null);
      hoverOverlayRef.current = null;
    }

    const newMarkers: any[] = [];
    for (const place of places) {
      const [lng, lat] = place.coordinates;
      if (!lat || !lng) continue;
      const image = placeMarkerImage(kakao, place, false, currentPinSize);
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lng), image });
      kakao.maps.event.addListener(marker, "click", () => {
        onSelectPlace(place.placeId);
        onPrefetchPlace?.(place);
      });
      if (isDesktop) {
        kakao.maps.event.addListener(marker, "mouseover", () => {
          if (hoverOverlayRef.current) hoverOverlayRef.current.setMap(null);
          hoverOverlayRef.current = new kakao.maps.CustomOverlay({
            position: marker.getPosition(),
            content: hoverTooltipHtml(place),
            yAnchor: 1,
            zIndex: 100,
          });
          hoverOverlayRef.current.setMap(map);
        });
        kakao.maps.event.addListener(marker, "mouseout", () => {
          if (hoverOverlayRef.current) {
            hoverOverlayRef.current.setMap(null);
            hoverOverlayRef.current = null;
          }
        });
      }
      markersRef.current[place.placeId] = marker;
      markerPlacesRef.current[place.placeId] = place;
      newMarkers.push(marker);
    }
    clusterer.addMarkers(newMarkers);

    return () => {
      // 다음 렌더링 전에 이전 마커 정리(위에서도 하지만, effect cleanup으로 이중 안전망)
    };
  }, [places, onSelectPlace, onPrefetchPlace, isDesktop]);

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
      /*
       * [정확도에 맞춰 확대한다]
       * 예전에는 오차와 무관하게 항상 level 6 으로 바짝 당겼다. 브라우저가 Wi-Fi 로 3km
       * 오차의 위치를 줬을 때도 마찬가지였다. 그러면 엉뚱한 지점을 콕 집어 확대해 놓고
       * 노란 점까지 찍으니, 사용자 눈에는 "지도가 내 위치를 정확히 안다"고 보인다.
       * 실제로는 3km 밖일 수 있다. 거친 값은 거칠게 보여주는 편이 정직하다.
       */
      const acc = typeof focusAccuracy === "number" ? focusAccuracy : null;

      /*
       * [검색한 범위를 그대로 보여준다 — 실측으로 드러난 어긋남]
       * 반경 5km 로 찾아 놓고 화면은 가로 1.7km 만 보여주고 있었다(2026-09-09 배포본 실측).
       * 검색 지름이 10km 이니 화면이 검색 범위의 6분의 1 이었던 셈이다. 목록에는 지도에서
       * 보이지도 않는 곳이 잔뜩 나오고, 사용자는 "왜 이게 여기 있지"를 알 수 없다.
       *
       * 앞선 커밋에서 나는 이 확대 단계를 '위치 오차'로 정했는데, 그건 두 가지를 섞은 것이다.
       * 오차는 '이 점을 얼마나 믿을 수 있나'이고, 화면 범위는 '무엇을 훑었나'이다. 오차가
       * 작을수록 더 당기게 만들어 놨으니 정확한 위치일수록 검색 범위와 더 어긋났다.
       * 반경 검색 중이면 그 반경에 화면을 맞추고, 오차는 아래 원으로만 표현한다.
       */
      if (typeof focusRadius === "number" && focusRadius > 0) {
        const dLat = focusRadius / 111320;
        const dLng = focusRadius / (111320 * Math.max(Math.cos((focusCoords.lat * Math.PI) / 180), 0.01));
        map.setBounds(
          new kakao.maps.LatLngBounds(
            new kakao.maps.LatLng(focusCoords.lat - dLat, focusCoords.lng - dLng),
            new kakao.maps.LatLng(focusCoords.lat + dLat, focusCoords.lng + dLng)
          )
        );
      } else {
        // 검색이 아니라 "현재 위치만 보기"다. 훑은 범위가 없으니 오차만큼만 당긴다.
        const level = acc === null ? 6 : acc <= 200 ? 5 : acc <= 1000 ? 6 : acc <= 5000 ? 7 : 8;
        map.setLevel(level, { animate: true });
      }

      // 훑은 범위를 눈에 보이게 그린다. 목록에 있는데 화면 밖인 곳이 왜 나왔는지 설명해 준다.
      if (searchCircleRef.current) {
        searchCircleRef.current.setMap(null);
        searchCircleRef.current = null;
      }
      if (typeof focusRadius === "number" && focusRadius > 0) {
        searchCircleRef.current = new kakao.maps.Circle({
          center: loc,
          radius: focusRadius,
          strokeWeight: 2,
          strokeColor: "#06107D",
          strokeOpacity: 0.35,
          fillColor: "#06107D",
          fillOpacity: 0.04,
        });
        searchCircleRef.current.setMap(map);
      }

      // 오차 원. 점 하나로 끝내면 얼마나 믿을 값인지 알 길이 없다. 오차가 작을 때는
      // 원이 점에 묻히므로 그리지 않는다.
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.setMap(null);
        accuracyCircleRef.current = null;
      }
      if (acc !== null && acc > 100) {
        accuracyCircleRef.current = new kakao.maps.Circle({
          center: loc,
          radius: acc,
          strokeWeight: 1,
          strokeColor: "#06107D",
          strokeOpacity: 0.45,
          strokeStyle: "shortdash",
          fillColor: "#06107D",
          fillOpacity: 0.07,
        });
        accuracyCircleRef.current.setMap(map);
      }

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
