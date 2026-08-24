"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 860px)";

// [모바일/데스크탑 레이아웃 분기]
// 스펙은 "모바일 퍼스트"였지만, 데스크탑에서도 폰 목업처럼 좁은 칼럼만 쓰는 건 화면 낭비다.
// 860px 이상에서는 고정 사이드바(검색+필터+리스트가 항상 보임) + 지도 레이아웃으로 전환한다.
// useSyncExternalStore로 matchMedia를 구독 — setState-in-effect 없이 React 권장 패턴을 따른다.
// 서버 스냅샷은 항상 false(모바일)이므로 하이드레이션 시 깜빡임이 있을 수 있으나, 최초 페인트
// 직후 클라이언트 값으로 즉시 보정된다.
function subscribe(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}
function getServerSnapshot() {
  return false;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
