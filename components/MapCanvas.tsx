/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 JS SDK는 공식 타입 정의가 없는 전역 스크립트라 any가 불가피하다 */
"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { Place, ProjectPin } from "@/lib/types";
import { SUB_DEFS, formatDistance } from "@/lib/types";
import {
  PIN_ACCENT_COLOR,
  PIN_COMPACT,
  PIN_DEFAULT,
  PIN_HERO,
  PIN_SELECTED,
  placePinSvg,
  projectPinSvg,
  scalePinSize,
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
 *   레벨 3 이하  히어로 핀(42×50) — 거리 수준까지 당겨 보는 구간, 가장 크게
 *   레벨 4~5     기본 핀(36×43)   — 개별 장소를 고르는 구간
 *   레벨 6~7     작은 핀(28×34)   — 여러 곳을 한눈에 훑는 구간
 *   레벨 8 이상  클러스터만       — 개별 핀은 의미가 없고 묶음 크기가 정보가 되는 구간
 *
 * 예전에는 크기가 기본/축소 두 단계뿐이라 아무리 당겨도 레벨 4 크기에서 멈췄다. 네이버·카카오
 * 자체 지도는 확대할수록 POI 마커가 계속 커지는 쪽에 가깝다는 점을 참고해 가장 가까운 구간에
 * 한 단계를 더했다(2026-09-16) — 축소→기본→히어로 세 걸음이 되어 확대가 "더 커진다"는
 * 반응을 계속 준다. 가운데 구간(6~8)은 서울 레벨 7 개별 핀 259개 실측을 반영한 값 그대로다.
 * 클러스터는 짝이 없는 마커까지 묶지는 않으므로, 레벨 8 이상에서도 작은 핀이 몇 개 남는 것은
 * 카카오 클러스터러의 정상 동작이다.
 */
function pinSizeForLevel(level: number): PinSize {
  if (level >= 6) return PIN_COMPACT;
  if (level <= 3) return PIN_HERO;
  return PIN_DEFAULT;
}

/*
 * [넓은 화면에서는 마커를 아예 만들지 않는다 — 성능]
 * 레벨 8 이상은 클러스터러가 결국 전부 뭉쳐서 숫자 원으로만 보여준다(위 표 참고). 그런데
 * 마커 수가 많은 화면(전국 축소 상태 등, 수백~천 개)에서는 어차피 안 보일 낱개 마커를
 * 계속 만들어 카카오 지도가 매 팬/줌 프레임마다 그 위치를 다시 계산하게 했다 — 손으로
 * 지도를 옮기면 느리다는 체감의 실제 원인이었다.
 *
 * 이 레벨·개수 조건을 만족하면 낱개 Marker+MarkerClusterer 대신, 화면을 격자로 나눠 칸별
 * 개수만 세어 우리가 직접 원 뱃지(kakao.maps.CustomOverlay)를 그린다 — 스타일은 아래
 * MarkerClusterer의 styles를 그대로 재사용해 두 경로가 레벨 8 경계를 넘나들 때도 같은
 * 것으로 보이게 한다. 개수는 실제로 가져온 places 전체를 세므로 정확하다 — 서버 요청량은
 * 그대로이고, 뱃지 숫자가 줄어들거나 거짓이 되지 않는다. 줄어드는 것은 오직 "실제로
 * 만드는 마커 개수"뿐이다. 레벨이 8 미만으로 내려가 개별 핀이 다시 의미를 갖는 순간
 * 원래 방식(낱개 마커 + 네이티브 클러스터러)으로 되돌아간다.
 */
const CLUSTER_ONLY_LEVEL = 8; // 아래 MarkerClusterer의 minLevel과 반드시 같은 값이어야 한다.
const SYNTHETIC_CLUSTER_THRESHOLD = 150; // 이보다 적으면 원래 방식도 이미 가볍다.

function clusterTier(count: number): number {
  return count < 10 ? 0 : count < 100 ? 1 : 2;
}

// [뱃지 배경 — 평면 → 방사형 그라디언트] 왼쪽 위에 살짝 밝은 점을 둬 유리구슬 같은 입체감을
// 낸다. 아래 네이티브 MarkerClusterer의 styles 배열과 시각적으로 동일해야 하므로 두 곳이 같은
// 세 문자열을 쓴다.
const CLUSTER_BG = [
  "radial-gradient(circle at 35% 30%, rgba(32,44,172,.95), rgba(6,16,125,.9) 72%)",
  "radial-gradient(circle at 35% 30%, rgba(34,46,176,.96), rgba(6,16,125,.94) 72%)",
  "radial-gradient(circle at 35% 30%, rgba(36,48,180,.98), rgba(6,16,125,.97) 72%)",
];

// 카카오 MarkerClusterer의 styles 배열과 시각적으로 동일한 원 뱃지 DOM을 직접 만든다.
function clusterBadgeElement(count: number): HTMLDivElement {
  const tier = clusterTier(count);
  const size = [34, 46, 60][tier];
  const font = [12, 13, 15][tier];
  const border = [2, 3, 3][tier];
  const weight = tier === 2 ? 800 : 700;
  const shadow = [
    "0 2px 8px rgba(0,0,0,.28)",
    "0 3px 10px rgba(0,0,0,.3)",
    "0 4px 14px rgba(0,0,0,.34)",
  ][tier];
  const el = document.createElement("div");
  el.textContent = String(count);
  el.style.cssText =
    `cursor:pointer;width:${size}px;height:${size}px;line-height:${size}px;font-size:${font}px;` +
    `background:${CLUSTER_BG[tier]};border-radius:50%;color:#E1FC48;text-align:center;font-weight:${weight};` +
    `border:${border}px solid #fff;box-sizing:border-box;box-shadow:${shadow};` +
    // [등장 트랜지션] 우리가 직접 그리는 격자 뱃지라 진짜 DOM이다 — 작게 시작해 살짝 오버슈트
    // 하며 자리 잡도록, 만든 직후 다음 프레임에서 목표 상태로 바꿔 트랜지션을 태운다.
    `opacity:0;transform:scale(.5);transition:opacity .2s ease,transform .2s cubic-bezier(.34,1.56,.64,1);`;
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "scale(1)";
  });
  return el;
}

interface ClusterBucket {
  lat: number;
  lng: number;
  count: number;
}

// 현재 화면 범위를 cols×cols 격자로 나눠 장소를 칸별로 묶는다. 격자 칸 수를 화면 범위에
// 비례해 정하므로(절대 위경도 크기로 고정하지 않으므로), 확대 정도와 무관하게 뱃지 개수가
// 비슷한 수준으로 유지된다.
function computeClusterBuckets(
  places: Place[],
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  cols = 16
): ClusterBucket[] {
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 1e-6);
  const spanLng = Math.max(bounds.maxLng - bounds.minLng, 1e-6);
  const cellLat = spanLat / cols;
  const cellLng = spanLng / cols;
  const cells = new Map<string, { sumLat: number; sumLng: number; count: number }>();
  for (const place of places) {
    const [lng, lat] = place.coordinates;
    if (!lat || !lng) continue;
    const cy = Math.floor((lat - bounds.minLat) / cellLat);
    const cx = Math.floor((lng - bounds.minLng) / cellLng);
    const key = cy + "_" + cx;
    const cell = cells.get(key);
    if (cell) {
      cell.sumLat += lat;
      cell.sumLng += lng;
      cell.count += 1;
    } else {
      cells.set(key, { sumLat: lat, sumLng: lng, count: 1 });
    }
  }
  return Array.from(cells.values()).map((c) => ({
    lat: c.sumLat / c.count,
    lng: c.sumLng / c.count,
    count: c.count,
  }));
}

function placeMarkerImage(kakao: any, place: Place, selected = false, size?: PinSize) {
  const use = selected ? PIN_SELECTED : (size ?? PIN_DEFAULT);
  // 크기를 키에 넣지 않으면 축소용 이미지가 기본 크기로 캐시돼 섞인다.
  const key = `${place.categoryDepth1}|${place.categoryDepth2}|${selected ? "on" : "off"}|${use.width}`;
  return toMarkerImage(kakao, key, placePinSvg(place.categoryDepth1, place.categoryDepth2, selected), use);
}

/*
 * [일반 핀의 팝인·호버 — 이미지 몇 장을 빠르게 갈아 끼우는 "스프라이트" 애니메이션]
 * 네이버 지도 API는 마커 표시 자체를 BOUNCE/DROP 애니메이션으로 제공한다 — "나타남"이 그냥
 * 순간이 아니라 정보라는 뜻이다. 카카오 Marker+MarkerImage는 내부 DOM을 못 건드려 CSS
 * 트랜지션을 못 쓰지만, 이미 캐시해 둔 이미지를 몇 단계 다른 크기로 짧은 간격을 두고
 * setImage()로 갈아 끼우면 같은 효과를 흉내 낼 수 있다(플립북과 같은 원리).
 *
 * 마커별로 진행 중인 애니메이션에 순번(job)을 매겨 두고, 매 프레임 자기 순번이 아직
 * 최신인지 확인한 뒤에만 이미지를 바꾼다. 그 사이 확대/축소가 일어나거나 마우스가 이미
 * 떠나 새 애니메이션이 시작됐으면 순번이 바뀌어 있으므로 오래된 프레임은 스스로 멈춘다 —
 * 그러지 않으면 호버로 커진 핀을 확대 이벤트가 원래 크기로 되돌린 직후, 지연됐던 마지막
 * 호버 프레임이 다시 덮어써 크기가 뒤엉킬 수 있다.
 */
const POP_IN_FRAMES = [0.42, 1.16, 0.93, 1.03, 1] as const;
const HOVER_LIFT_FRAMES = [1.06, 1.15] as const;
const HOVER_DROP_FRAMES = [1.06, 1] as const;

function animateMarkerFrames(
  kakao: any,
  marker: any,
  place: Place,
  base: PinSize,
  frames: readonly number[],
  jobMap: Record<string, number>,
  placeId: string,
  stepMs: number
) {
  const job = (jobMap[placeId] = (jobMap[placeId] ?? 0) + 1);
  let i = 0;
  const step = () => {
    if (jobMap[placeId] !== job) return; // 그 사이 재줌·재호버로 새 애니메이션이 시작됨 — 폐기
    const factor = frames[i];
    marker.setImage(placeMarkerImage(kakao, place, false, factor === 1 ? base : scalePinSize(base, factor)));
    i++;
    if (i < frames.length) setTimeout(step, stepMs);
  };
  step();
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
  // [현재 기준 크기] pinWidthRef가 폭 숫자만 들고 있어 팝인/호버 애니메이션이 스케일 계산에
  // 쓸 PinSize 전체(앵커 포함)가 필요할 때마다 다시 찾아야 했다. 같은 값을 객체로도 들고 있는다.
  const pinSizeRef = useRef<PinSize>(PIN_DEFAULT);
  // [핀 리사이즈 작업 취소 토큰] 아래 zoom_changed 핸들러가 청크 단위로 나눠 처리하는 도중
  // 사용자가 다시 확대/축소하면, 진행 중이던 이전 작업은 이 값이 바뀐 것으로 감지해 스스로
  // 멈춘다 — 그러지 않으면 오래된 작업과 새 작업이 뒤섞여 마커 크기가 잘못 남을 수 있다.
  const pinResizeJobRef = useRef(0);
  // [마커별 애니메이션 순번] 팝인·호버 리프트가 동시에 여러 마커에서 돌 수 있어 마커 하나로는
  // 부족하다 — placeId별로 순번을 매겨 오래된 애니메이션 프레임이 새 것을 덮어쓰지 못하게 한다.
  const markerAnimJobRef = useRef<Record<string, number>>({});
  // [합성 클러스터 오버레이] CLUSTER_ONLY_LEVEL 이상 + 장소가 많을 때 낱개 마커 대신 그리는
  // 격자별 원 뱃지들. 실제 Marker/클러스터러와는 별개 레이어라 따로 추적해야 걷어낼 수 있다.
  const syntheticClusterRef = useRef<any[]>([]);
  const projectMarkersRef = useRef<any[]>([]);
  const isolatedMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);
  const searchCircleRef = useRef<any>(null);
  const hoverOverlayRef = useRef<any>(null);
  // [호버 툴팁 깜빡임 방지] 마커 위에 뜬 툴팁(CustomOverlay)이 실제 화면에서 마커의 픽셀
  // 영역과 살짝 겹치면, 마우스가 전혀 움직이지 않아도 브라우저가 "지금 가장 위에 있는
  // 요소"를 다시 계산하면서 마커에 mouseout이 뜨고 → 툴팁이 사라지고 → 마커가 다시
  // 최상단이 되어 mouseover가 다시 뜨는 식으로 끝없이 되풀이될 수 있다(핀 크기가 커질수록
  // 겹칠 여지도 커진다). mouseout에서 곧바로 지우지 않고 짧게 미뤘다가, 그 사이 같은 핀에
  // mouseover가 다시 오면(바로 이 되풀이 상황) 취소해서 화면을 그대로 둔다 — 진짜로 다른
  // 곳으로 마우스가 떠난 경우에만 실제로 사라진다.
  const hoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredPlaceIdRef = useRef<string | null>(null);
  const scriptLoadedRef = useRef(false);
  const isDesktopRef = useRef(isDesktop);
  const zoomControlRef = useRef<any>(null);
  const onUserPanRef = useRef(onUserPan);
  const onViewportChangeRef = useRef(onViewportChange);
  // [마커 재사용] 아래 마커 렌더링 effect가 이제 마커를 매번 다시 만들지 않고 재사용하므로,
  // 클릭/호버 핸들러를 마커 생성 시점의 onSelectPlace/onPrefetchPlace로 그대로 캡처해 두면
  // 이 두 props가 나중에 바뀌어도(예: region 변경으로 onPrefetchPlace가 새로 만들어짐) 오래
  // 살아남은 마커는 계속 예전 함수를 부르게 된다. ref로 감싸 항상 최신 함수를 부르게 한다.
  const onSelectPlaceRef = useRef(onSelectPlace);
  const onPrefetchPlaceRef = useRef(onPrefetchPlace);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // [합성 클러스터 전환 판단용] ref는 값이 바뀌어도 아래 마커 렌더링 effect를 다시 돌리지
  // 못한다(그 effect는 places/isDesktop 변경에만 반응했다) — 레벨 8 경계를 넘나드는 순간을
  // 놓치지 않으려면 state로도 들고 있어야 한다.
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);

  useEffect(() => {
    isDesktopRef.current = isDesktop;
  }, [isDesktop]);

  useEffect(() => {
    onUserPanRef.current = onUserPan;
  }, [onUserPan]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onSelectPlaceRef.current = onSelectPlace;
  }, [onSelectPlace]);

  useEffect(() => {
    onPrefetchPlaceRef.current = onPrefetchPlace;
  }, [onPrefetchPlace]);

  /*
   * [선택 핀 전용 CSS — 한 번만 주입] 일반 핀은 카카오 Marker+MarkerImage(통짜 <img> 교체)라
   * CSS 트랜지션을 못 쓰지만, 아래 "선택된 장소" 효과의 고립 마커는 클러스터러 밖에서 항상
   * 하나뿐이라 CustomOverlay(진짜 DOM)로 만든다 — 그래서 여기만 진짜 keyframe 애니메이션을
   * 쓸 수 있다. 네이버 지도 API가 마커에 기본 제공하는 DROP(떨어져 안착)을 본떠, 핀 끝(지도
   * 좌표)은 고정한 채 몸통만 위에서 튕기듯 내려앉게 한다(transform-origin을 끝점에 둔다).
   * 여러 번 선택해도 style 태그가 중복되지 않도록 처음 한 번만 넣는다.
   */
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("gm-pin-styles")) return;
    const style = document.createElement("style");
    style.id = "gm-pin-styles";
    style.textContent = `
@keyframes gmPinDrop {
  0%   { transform: translateY(-26px) scale(.4); opacity: 0; }
  55%  { transform: translateY(0) scale(1.14); opacity: 1; }
  75%  { transform: translateY(0) scale(.94); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes gmPinGlow {
  0%, 100% { opacity: .22; transform: scale(1); }
  50%      { opacity: .5; transform: scale(1.1); }
}
.gm-pin-selected-body { transform-origin: 50% 100%; animation: gmPinDrop .48s cubic-bezier(.34,1.56,.64,1) both; }
.gm-pin-selected-glow { animation: gmPinGlow 2.2s ease-in-out infinite; filter: blur(3px); }
`;
    document.head.appendChild(style);
  }, []);

  // [제스처 충돌 방지] 데스크탑에서만 Kakao 기본 줌을 끄고, Ctrl+스크롤일 때만 우리가 직접 확대/축소한다.
  // 맨 스크롤(Ctrl 없이)은 막아서 페이지가 튀지 않게 하고, 대신 안내 힌트를 잠깐 보여준다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoomable(!isDesktop);

    // 폭이 860px 경계를 넘나들면 줌 컨트롤도 따라와야 한다. 지도 생성 시점에 한 번만 붙이면
    // 데스크톱에서 창을 좁혔을 때 컨트롤이 남아 칩 줄과 겹친 채로 있는다.
    const kakao = window.kakao;
    if (!kakao?.maps) return;
    if (isDesktop && !zoomControlRef.current) {
      zoomControlRef.current = new kakao.maps.ZoomControl();
      map.addControl(zoomControlRef.current, kakao.maps.ControlPosition.RIGHT);
    } else if (!isDesktop && zoomControlRef.current) {
      map.removeControl(zoomControlRef.current);
      zoomControlRef.current = null;
    }
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
        /*
         * [줌 컨트롤은 데스크톱에만]
         * 모바일 393×852 에서 재 보니 이 컨트롤이 x 358~390 을 차지해서, "공원/수목원" 칩
         * (x 271~374)과 16px 겹치고 검색바 위로도 뚫고 올라왔다. 화면 오른쪽 위가 그것 때문에
         * 어수선했다. 게다가 모바일에서는 핀치로 확대·축소하므로 쓸 일도 없다.
         * 데스크톱은 다르다 — 거기서는 Ctrl+스크롤로만 확대되게 막아 뒀으므로(아래 wheel 처리)
         * 이 컨트롤이 유일하게 마우스로 줌하는 길이다. 그래서 데스크톱에만 붙인다.
         */
        if (isDesktopRef.current) {
          zoomControlRef.current = new kakao.maps.ZoomControl();
          map.addControl(zoomControlRef.current, kakao.maps.ControlPosition.RIGHT);
        }

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
        setZoomLevel(map.getLevel());

        // ["현 위치에서 재검색"] dragend는 사용자가 손으로 지도를 끌었을 때만 발생하고,
        // panTo() 같은 프로그램적 이동(검색 결과로 자동 이동 등)에는 발생하지 않는다. 그래서
        // "사용자가 직접 지도를 옮겼다"를 감지하는 용도로 정확히 들어맞는다.
        kakao.maps.event.addListener(map, "dragend", () => {
          const center = map.getCenter();
          onUserPanRef.current?.({ lat: center.getLat(), lng: center.getLng() });
        });

        // [줌 단계가 바뀌면 핀 크기도 바뀐다] 크기 구간이 실제로 넘어갔을 때만 손댄다.
        //
        // [청크로 나눠 처리 — 2026-09-16] 마커가 수백~천 개인 화면(전국 축소 상태)에서는
        // 이 루프 하나가 한 프레임 안에서 다 돌면서 메인 스레드를 수백 ms씩 막았다. 핀치줌
        // 도중 이게 걸리면 확대 애니메이션이 뚝뚝 끊겨 보인다. requestAnimationFrame으로
        // 한 번에 80개씩만 처리하고 다음 프레임에 이어서, 전체 작업을 여러 프레임에 걸쳐
        // 나눠 부담을 흩뜨린다 — 결과(모든 마커의 최종 크기)는 그대로다.
        kakao.maps.event.addListener(map, "zoom_changed", () => {
          // 합성 클러스터 전환은 핀 크기 구간과 무관하게 매 레벨 변화마다 판단해야 하므로,
          // 아래 크기-구간 조기 반환보다 먼저 state를 갱신한다.
          setZoomLevel(map.getLevel());
          const size = pinSizeForLevel(map.getLevel());
          if (size.width === pinWidthRef.current) return;
          pinWidthRef.current = size.width;
          pinSizeRef.current = size;
          const job = ++pinResizeJobRef.current;
          const entries = Object.entries(markersRef.current);
          const CHUNK = 80;
          let i = 0;
          const step = () => {
            if (job !== pinResizeJobRef.current) return; // 그 사이 다시 확대/축소함 — 이 작업은 폐기
            const end = Math.min(i + CHUNK, entries.length);
            for (; i < end; i++) {
              const [id, marker] = entries[i];
              const place = markerPlacesRef.current[id];
              if (!place) continue;
              // 이 마커에서 진행 중이던 팝인/호버 애니메이션은 여기서 순번을 올려 폐기한다 —
              // 그러지 않으면 지연된 옛 프레임이 방금 맞춘 크기를 뒤늦게 덮어쓸 수 있다.
              markerAnimJobRef.current[id] = (markerAnimJobRef.current[id] ?? 0) + 1;
              marker.setImage(placeMarkerImage(kakao, place, false, size));
            }
            if (i < entries.length) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
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
          /*
           * [클러스터 클릭 확대를 직접 만든다 — 2026-09-10]
           * disableClickZoom 기본값(false)은 카카오가 클러스터 범위에 맞춰 줌 레벨을 한 번에
           * 점프시킨다 — 애니메이션이 없다. 그 직후 idle → 새 화면 영역 재조회 → 응답이 와야
           * 개별 핀이 뜨는 지연까지 겹쳐서 "클릭 → 순간 이동 → 잠깐 멈춤 → 핀 팝인"으로 두 번
           * 끊겨 보였다. disableClickZoom:true로 기본 동작을 끄고, 아래 clusterclick에서
           * 직접 한 단계씩 부드럽게 확대한다 — 최소한 확대 자체는 하나의 이어지는 동작이 된다.
           */
          disableClickZoom: true,
          // [크기로 양을 읽히게 한다] 예전엔 스타일이 하나뿐이라 5곳짜리 묶음과 800곳짜리 묶음이
          // 똑같은 원으로 보였다. 지도에서 원의 크기는 곧 "얼마나 많은가"를 뜻하는 가장 기본적인
          // 시각 언어인데, 그걸 버리면 사용자는 숫자를 하나하나 읽어야 한다.
          // 10 미만 / 10~99 / 100 이상 세 단계로 나눠 한눈에 밀집도가 보이게 한다.
          calculator: [10, 100],
          // [뱃지 배경은 clusterBadgeElement의 CLUSTER_BG와 같은 값] 낱개 마커 화면(레벨 8
          // 미만, 이 네이티브 클러스터러)과 합성 클러스터 화면(레벨 8 이상, 우리가 직접 그리는
          // clusterBadgeElement)이 레벨 경계를 오갈 때 뱃지가 다른 것으로 안 보이도록 맞춘다.
          styles: [
            {
              width: "34px", height: "34px", lineHeight: "34px", fontSize: "12px",
              background: CLUSTER_BG[0], borderRadius: "50%", color: "#E1FC48",
              textAlign: "center", fontWeight: "700", border: "2px solid #fff",
              boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,.28)",
            },
            {
              width: "46px", height: "46px", lineHeight: "46px", fontSize: "13px",
              background: CLUSTER_BG[1], borderRadius: "50%", color: "#E1FC48",
              textAlign: "center", fontWeight: "700", border: "3px solid #fff",
              boxSizing: "border-box", boxShadow: "0 3px 10px rgba(0,0,0,.3)",
            },
            {
              width: "60px", height: "60px", lineHeight: "60px", fontSize: "15px",
              background: CLUSTER_BG[2], borderRadius: "50%", color: "#E1FC48",
              textAlign: "center", fontWeight: "800", border: "3px solid #fff",
              boxSizing: "border-box", boxShadow: "0 4px 14px rgba(0,0,0,.34)",
            },
          ],
        });
        // [한 단계씩만 확대] 클러스터 범위 전체를 한 번에 맞추려면 몇 레벨을 뛸지 그때그때
        // 다르고, 카카오 애니메이션은 레벨 차가 2 넘으면 아예 무효화된다(공식 문서). 그래서
        // 큰 클러스터든 작은 클러스터든 항상 1레벨씩만, 클러스터 중심을 기준으로 부드럽게
        // 확대한다 — 큰 뭉치는 두세 번 눌러야 다 풀리지만, 매번 확실히 애니메이션이 붙는다.
        kakao.maps.event.addListener(clustererRef.current, "clusterclick", (cluster: any) => {
          map.setLevel(map.getLevel() - 1, { anchor: cluster.getCenter(), animate: true });
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
      if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
      if (hoverOverlayRef.current) hoverOverlayRef.current.setMap(null);
      syntheticClusterRef.current.forEach((o) => o.setMap(null));
      syntheticClusterRef.current = [];
      projectMarkersRef.current.forEach((m) => m.setMap(null));
      projectMarkersRef.current = [];
      if (clustererRef.current) clustererRef.current.clear();
      clustererRef.current = null;
      mapRef.current = null;
    };
  }, []);

  /*
   * [마커 렌더링 — 사라진/새로 생긴 placeId만 반영]
   * 예전에는 places가 바뀔 때마다(모바일에서 손으로 지도를 옮길 때마다 idle → bbox
   * 재조회 → places 갱신) 화면에 이미 떠 있던 마커까지 전부 지우고 수백 개를 처음부터
   * 다시 만들었다. 화면이 겹치는 팬(pan)에서도 매번 전체를 다시 만드는 셈이라, 모바일
   * 기기에서는 판을 뗄 때마다 메인 스레드가 수백 ms씩 멎어 "지도 이동 반응이 느리다"는
   * 체감으로 이어졌다. 이제 이번 렌더에서 사라진 placeId만 지우고, 새로 나타난
   * placeId만 새로 만든다 — 인접한 영역으로 이동할수록 겹치는 장소가 많아 다시 만들
   * 마커는 몇 개 안 된다.
   *
   * 마커를 재사용하므로 클릭/호버 핸들러 안에서 place 객체를 직접 캡처하지 않는다.
   * 캡처해 두면 나중에 같은 장소의 정보가 갱신돼도(예: mergeDedup의 연락처 채움) 이
   * 마커는 만들어질 때의 옛 데이터로 계속 응답한다. 대신 placeId(안 변하는 값)만
   * 캡처하고, 이벤트가 실제로 발생한 시점에 markerPlacesRef에서 최신 데이터를 찾는다.
   * onSelectPlace/onPrefetchPlace도 같은 이유로 ref를 통해서만 부른다(위 두 useEffect).
   */
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!kakao?.maps || !map || !clusterer) return;

    const level = zoomLevel ?? map.getLevel();
    const wantsSyntheticClusters = level >= CLUSTER_ONLY_LEVEL && places.length > SYNTHETIC_CLUSTER_THRESHOLD;

    if (wantsSyntheticClusters) {
      // 방금 이 레벨로 넘어왔다면 낱개 마커가 아직 남아 있을 수 있다 — 어차피 안 보일
      // 것들이니 전부 걷어낸다.
      if (Object.keys(markersRef.current).length) {
        clusterer.clear();
        Object.values(markersRef.current).forEach((m: any) => m.setMap(null));
        markersRef.current = {};
        markerPlacesRef.current = {};
      }

      syntheticClusterRef.current.forEach((o) => o.setMap(null));
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const buckets = computeClusterBuckets(places, {
        minLat: sw.getLat(),
        maxLat: ne.getLat(),
        minLng: sw.getLng(),
        maxLng: ne.getLng(),
      });
      syntheticClusterRef.current = buckets.map((bucket) => {
        const content = clusterBadgeElement(bucket.count);
        const position = new kakao.maps.LatLng(bucket.lat, bucket.lng);
        // 실제 클러스터 클릭과 같은 동작: 이 칸 중심을 기준으로 한 단계만 부드럽게 확대한다.
        content.addEventListener("click", () => {
          map.setLevel(map.getLevel() - 1, { anchor: position, animate: true });
        });
        const overlay = new kakao.maps.CustomOverlay({ position, content, zIndex: 10 });
        overlay.setMap(map);
        return overlay;
      });
      return;
    }

    // 합성 클러스터 모드에서 벗어났다면(확대해서 개별 핀이 다시 의미 있어졌다면) 걷어낸다.
    if (syntheticClusterRef.current.length) {
      syntheticClusterRef.current.forEach((o) => o.setMap(null));
      syntheticClusterRef.current = [];
    }

    // 지금 보고 있는 축척에 맞는 크기로 만든다. 줌이 바뀌면 위 zoom_changed 가 갈아 끼운다.
    const currentPinSize = pinSizeForLevel(level);
    pinWidthRef.current = currentPinSize.width;
    pinSizeRef.current = currentPinSize;

    const nextIds = new Set(places.map((p) => p.placeId));

    // 화면에서 사라진 장소의 마커만 지운다.
    const toRemove: any[] = [];
    for (const [id, marker] of Object.entries(markersRef.current)) {
      if (nextIds.has(id)) continue;
      toRemove.push(marker);
      delete markersRef.current[id];
      delete markerPlacesRef.current[id];
      // 지워지는 마커가 마침 호버 중이었다면(마우스가 그대로 있는데 데이터에서만 사라진
      // 경우) 툴팁이 고아로 남지 않도록 같이 정리한다.
      if (hoveredPlaceIdRef.current === id) {
        if (hoverHideTimerRef.current) {
          clearTimeout(hoverHideTimerRef.current);
          hoverHideTimerRef.current = null;
        }
        if (hoverOverlayRef.current) {
          hoverOverlayRef.current.setMap(null);
          hoverOverlayRef.current = null;
        }
        hoveredPlaceIdRef.current = null;
      }
    }
    if (toRemove.length) {
      clusterer.removeMarkers(toRemove);
      toRemove.forEach((m) => m.setMap(null));
    }

    // 이미 떠 있는 장소는 마커를 새로 만들지 않되, 참조 데이터는 최신으로 갱신한다.
    const toAdd: any[] = [];
    for (const place of places) {
      markerPlacesRef.current[place.placeId] = place;
      if (markersRef.current[place.placeId]) continue;

      const [lng, lat] = place.coordinates;
      if (!lat || !lng) continue;
      const placeId = place.placeId;
      // [팝인] 최종 크기로 바로 만들지 않고 작게 시작한다 — 곧바로 popInMarker가 목표 크기까지
      // 튀어오르듯 키운다. 최종 프레임이 항상 currentPinSize 그대로이므로, 애니메이션이 어떤
      // 이유로든 중간에 폐기돼도(줌 변경 등) 마커가 이상한 크기로 멈추지 않는다.
      const image = placeMarkerImage(kakao, place, false, scalePinSize(currentPinSize, POP_IN_FRAMES[0]));
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lng), image });
      kakao.maps.event.addListener(marker, "click", () => {
        const current = markerPlacesRef.current[placeId];
        if (!current) return;
        onSelectPlaceRef.current(current.placeId);
        onPrefetchPlaceRef.current?.(current);
      });
      if (isDesktop) {
        kakao.maps.event.addListener(marker, "mouseover", () => {
          // [호버 시 핀이 떨리는 문제 — 2026-09-16]
          // 예전엔 mouseout에서 리프트 되돌리기(HOVER_DROP_FRAMES)를 곧바로 실행했다. 그런데
          // setImage()로 마커 이미지를 몇 단계 다른 크기로 갈아 끼우는 동안 커서 아래 요소가
          // 바뀌면서 브라우저가 mouseout/mouseover를 다시 쏠 수 있고(호버 툴팁 깜빡임과 같은
          // 근본 원인), 그때마다 "당겨 내리기 시작 → 곧바로 취소하지만 이미 한 프레임 내려간
          // 채로 다시 올리기" 가 반복되면 핀이 커졌다 작아졌다 떨리는 것처럼 보였다.
          // 되돌리기는 아래 mouseout에서 툴팁과 같은 80ms 유예를 거친 뒤에만 시작하게 옮기고,
          // 대신 리프트는 (이미 켜져 있어도) 매번 다시 걸어 되풀이 상황에서도 항상 "켜진 상태"로
          // 수렴하게 한다 — animateMarkerFrames의 job 토큰이 오래된 되돌리기 프레임을 알아서
          // 무효화한다.
          if (hoverHideTimerRef.current) {
            clearTimeout(hoverHideTimerRef.current);
            hoverHideTimerRef.current = null;
          }
          const current = markerPlacesRef.current[placeId];
          if (!current) return;
          if (!(hoveredPlaceIdRef.current === placeId && hoverOverlayRef.current)) {
            if (hoverOverlayRef.current) hoverOverlayRef.current.setMap(null);
            hoverOverlayRef.current = new kakao.maps.CustomOverlay({
              position: marker.getPosition(),
              content: hoverTooltipHtml(current),
              yAnchor: 1,
              zIndex: 100,
            });
            hoverOverlayRef.current.setMap(map);
            hoveredPlaceIdRef.current = placeId;
          }
          // [호버 리프트] 툴팁만으로는 "지금 이걸 가리키고 있다"는 확인이 약하다. 핀 자체를
          // 살짝 키워 데스크톱 카카오맵 자체의 POI 호버 반응과 같은 언어를 쓴다.
          animateMarkerFrames(kakao, marker, current, pinSizeRef.current, HOVER_LIFT_FRAMES, markerAnimJobRef.current, placeId, 45);
        });
        kakao.maps.event.addListener(marker, "mouseout", () => {
          // 곧바로 지우지 않고 짧게 미룬다 — 이 사이 같은 핀에 mouseover가 다시 오면(위
          // 핸들러가) 이 타이머를 취소해서 화면이 흔들리지 않는다. 진짜로 마우스가 다른
          // 곳으로 떠난 경우에만 아래가 실행되어 툴팁이 사라지고 핀도 원래 크기로 돌아간다.
          // 되돌리기 애니메이션 자체를 이 유예 뒤로 옮긴 것이 핀 떨림 수정의 핵심이다 —
          // 되풀이되는 mouseout마다 매번 즉시 되돌리기를 시작하지 않으므로, 진짜로 떠난
          // 경우가 아니면 애니메이션이 아예 시작되지 않는다.
          if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
          hoverHideTimerRef.current = setTimeout(() => {
            if (hoverOverlayRef.current) {
              hoverOverlayRef.current.setMap(null);
              hoverOverlayRef.current = null;
            }
            hoveredPlaceIdRef.current = null;
            hoverHideTimerRef.current = null;
            const current = markerPlacesRef.current[placeId];
            if (current) {
              animateMarkerFrames(kakao, marker, current, pinSizeRef.current, HOVER_DROP_FRAMES, markerAnimJobRef.current, placeId, 45);
            }
          }, 80);
        });
      }
      markersRef.current[placeId] = marker;
      toAdd.push(marker);
      animateMarkerFrames(kakao, marker, place, currentPinSize, POP_IN_FRAMES, markerAnimJobRef.current, placeId, 30);
    }
    if (toAdd.length) clusterer.addMarkers(toAdd);
  }, [places, isDesktop, zoomLevel]);

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

    // 합성 클러스터 모드 중에 장소를 선택하면(예: 목록에서 바로 클릭) 곧 레벨 4로 확대되며
    // 원래 방식으로 돌아가지만, 그 전환이 끝나기 전 잠깐 뱃지가 고립 마커와 함께 남을 수
    // 있다. 실제로 장소를 선택해 고립시키는 이 지점에서만 걷어낸다 — 위 "선택 없음" 갈래는
    // places가 바뀔 때마다(뷰포트 재조회 등) 매번 실행되므로, 거기서 걷어내면 방금 다른
    // effect가 그려 둔 합성 뱃지를 곧바로 지워버린다(실제로 겪은 버그).
    if (syntheticClusterRef.current.length) {
      syntheticClusterRef.current.forEach((o) => o.setMap(null));
      syntheticClusterRef.current = [];
    }

    if (clusterer) clusterer.clear();
    Object.values(markersRef.current).forEach((m) => m.setMap(null));

    /*
     * [선택 핀 — CustomOverlay로 승격]
     * 색을 바꾸면 그 핀이 어느 그룹인지 알 수 없게 되므로, 선택은 여전히 크기 + 흰 테두리로
     * 알린다. 다만 이 핀은 클러스터러 밖의 유일한 마커라 진짜 DOM으로 만들 여유가 있다 —
     * Marker+MarkerImage 대신 CustomOverlay를 써서 위에서 정의한 드롭+바운스 애니메이션과,
     * 그룹색으로 은은하게 숨쉬는 글로우를 붙인다. 클릭 핸들러가 없었던 것도 그대로다(이미
     * 선택된 장소이므로 다시 누를 이유가 없다).
     */
    const size = PIN_SELECTED;
    const svg = placePinSvg(place.categoryDepth1, place.categoryDepth2, true);
    const glowColor = PIN_ACCENT_COLOR[place.categoryDepth1] ?? PIN_ACCENT_COLOR.park;
    const content = document.createElement("div");
    content.style.cssText = `position:relative;width:${size.width}px;height:${size.height}px;`;
    content.innerHTML =
      `<div class="gm-pin-selected-glow" style="position:absolute;left:50%;top:${size.anchorY - 10}px;` +
      `width:20px;height:20px;margin-left:-10px;margin-top:-10px;border-radius:50%;background:${glowColor};"></div>` +
      `<div class="gm-pin-selected-body" style="position:relative;width:100%;height:100%;">` +
      `<img src="${svgDataUri(svg)}" width="${size.width}" height="${size.height}" style="display:block;" /></div>`;
    const overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(place.coordinates[1], place.coordinates[0]),
      content,
      xAnchor: size.anchorX / size.width,
      yAnchor: size.anchorY / size.height,
      zIndex: 50,
    });
    overlay.setMap(map);
    isolatedMarkerRef.current = overlay;
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
