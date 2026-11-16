"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "framer-motion";
import type { Place, Region } from "@/lib/types";
import { useIsShortScreen } from "@/lib/useIsDesktop";
import DetailContent from "./DetailContent";

/*
 * [모달이었다가 — 2026-09-09 → 2026-09-19 되돌림]
 * 09-09에는 배경을 어둡게 하고 탭하면 닫히는 완전한 모달로 만들었다(하나의 대상에 집중하는
 * 화면이라는 이유). 그런데 그 배경(`absolute inset-0`)이 z-[70]으로 화면 전체를 덮어,
 * 장소를 선택한 동안에는 시트가 안 보이는 지도 윗부분까지 포함해 지도 자체를 전혀 만질 수
 * 없었다 — 핀을 하나 눌러 상세를 본 다음, 지도를 손으로 옮겨 다른 곳을 보려면 먼저 이
 * 시트를 닫아야만 했다. 대표 요청(09-19)으로 지도 조작을 막지 않도록 되돌린다 — 딤 처리는
 * 그대로 두되 pointer-events-none으로 만들어 시각 효과만 남기고, 탭해서 닫는 동작은
 * 뺐다(막고 있던 게 이 배경이라 pointer-events-none이면 어차피 클릭도 안 잡힌다). 닫는
 * 길은 ✕ 버튼과 아래로 끌기 두 가지로 충분하다. 리스트 시트가 원래 "비모달"이었던 이유와
 * 같은 이유로, 상세 시트도 지도 탐색을 막지 않는 쪽이 이 앱의 성격에 맞다.
 *
 * [손잡이와 드래그 닫기 — 2026-09-09]
 * 리스트 시트는 손잡이로 끌어올리고 내리는데, 상세 시트는 드래그가 아예 안 돼서 방금 리스트에서
 * 쓰던 조작이 여기서는 안 통했다. 같은 방식(손잡이에서만 드래그 시작)을 그대로 가져온다 —
 * 이러면 DetailContent를 아무리 스크롤해도 시트가 끌려오지 않는다.
 *
 * [작은 카드로 먼저 — 2026-10-21]
 * 핀을 누르면 상세 전체(390폭에서 449px, 화면의 55%)가 한 번에 올라와 지도를 덮었고,
 * 고른 핀이 시트 윗가장자리에 반쯤 가렸다(대표 신고). 이제 처음엔 업종·이름·주소·버튼만
 * 담은 작은 카드로 열고, 손잡이를 누르거나 위로 끌거나 「자세히」를 누르면 지금의 전체
 * 상세로 펼친다. 펼친 상태에서 아래로 끌면 카드로 돌아가고, 카드에서 아래로 끌면 닫힌다.
 * 지도를 덮는 딤도 펼쳤을 때만 깐다 — 카드 상태는 지도를 보면서 고르는 단계다.
 */
export default function PlaceDetailSheet({
  place,
  region,
  onClose,
  onHeightChange,
}: {
  place: Place | null;
  region: Region;
  onClose: () => void;
  // 시트의 실제 높이(px), 닫히면 null. 목록 시트를 이 높이만큼만 올려 카드 뒤에 숨기는 데 쓴다.
  onHeightChange?: (h: number | null) => void;
}) {
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  // 높이 500px 이하(휴대폰 가로)에선 작은 카드 단계 없이 예전처럼 전체 상세로만 연다.
  const cardMode = !useIsShortScreen();

  // 카드↔전체 상세 전환, 홈페이지 조회 결과 도착 등으로 내용 높이가 바뀌면 다시 알린다.
  // 카드를 안 쓰는 화면에선 알리지 않는다 — 목록 시트도 예전처럼 peek 에 머문다.
  useEffect(() => {
    const el = sheetRef.current;
    if (!place || !el || !cardMode) {
      onHeightChange?.(null);
      return;
    }
    // 떠 있는 카드는 화면 아래에서 띄워져 있어, 카드 높이가 아니라 "카드 윗변부터 화면 바닥까지"를
    // 알린다(offsetTop 은 올라오는 중인 transform 과 무관). 목록 시트 위치·핀 보정이 이 값을 쓴다.
    const report = () => {
      const parentH = (el.offsetParent as HTMLElement | null)?.clientHeight;
      onHeightChange?.(parentH ? parentH - el.offsetTop : el.offsetHeight);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [place, onHeightChange, cardMode]);
  // 어느 장소에 대해 펼쳤는지를 기억한다 — 다른 핀을 고르면 따로 되돌리지 않아도 카드로 시작한다.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = !cardMode || (!!place && expandedFor === place.placeId);
  const expand = () => place && setExpandedFor(place.placeId);
  const toggle = () => (expanded ? setExpandedFor(null) : expand());
  const reduceMotion = useReducedMotion();

  // [키보드 — 디자인 진단 10-22 필수] 카드가 열려도 포커스를 억지로 옮기지 않는다. Esc 는 닫기와
  // 같고, 닫히면 카드를 연 요소(목록 항목 등 — 지도 핀은 포커스를 받을 수 없다)로 포커스를 돌려준다.
  const openerRef = useRef<HTMLElement | null>(null);
  const placeId = place?.placeId ?? null;
  useEffect(() => {
    if (!placeId) return;
    if (!openerRef.current) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placeId, onClose]);
  useEffect(() => {
    if (placeId) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }, [placeId]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (!cardMode) {
      if (info.offset.y > 100 || info.velocity.y > 500) onClose();
      return;
    }
    if (info.offset.y < -40 || info.velocity.y < -500) {
      expand();
    } else if (info.offset.y > 100 || info.velocity.y > 500) {
      if (expanded) setExpandedFor(null);
      else onClose();
    }
  }

  return (
    <AnimatePresence>
      {place && (
        <>
          <motion.div
            key="backdrop"
            className="pointer-events-none absolute inset-0 z-[var(--z-modal-backdrop)] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: expanded ? 1 : 0 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            key="sheet"
            ref={sheetRef}
            data-gm-detail-sheet
            // [B안 떠 있는 카드 — 2026-10-22 대표 선택] 화면 가장자리에서 띄운 2겹(바깥 테 + 흰 안쪽)
            // 둥근 카드. 휴대폰 가로(cardMode 아님)는 예전 바닥 시트 그대로.
            // 바닥 24px: 카카오 로고·저작권 표기가 지도 좌하단 바닥에서 19px 높이를 차지한다(라이브
            // 실측 x 6~142, 바닥 0~19). 카카오 약관상 가리면 안 돼서 그 위로 5px 띄운다.
            className={
              cardMode
                ? "gpu absolute inset-x-2.5 bottom-[max(24px,calc(env(safe-area-inset-bottom)+6px))] z-[var(--z-modal-sheet)] flex max-h-[70dvh] flex-col rounded-[30px] bg-[var(--card-bezel)] p-1.5 shadow-[var(--card-shadow)]"
                : "gpu absolute inset-x-0 bottom-0 z-[var(--z-modal-sheet)] flex max-h-[70dvh] flex-col rounded-t-[20px] bg-white shadow-[0_-20px_50px_-10px_rgba(0,0,0,0.12)]"
            }
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            exit={{ y: "105%" }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: cardMode ? 0.2 : 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            {/* 카드 하한 20dvh: 768 세로에서 내용 높이만으론 19%였다(디자인 진단 10-21 승인 조건). */}
            <div
              className={`flex min-h-0 flex-1 flex-col ${cardMode ? "rounded-[24px] bg-white ring-1 ring-[var(--card-hairline)]" : ""} ${cardMode && !expanded ? "min-h-[20dvh]" : ""}`}
            >
            <div className="relative flex-shrink-0" style={{ minHeight: 32 }}>
              {/* 보이는 막대는 5px 이지만 손가락 닿는 영역은 리스트 시트와 같은 44px 로 넓힌다.
                  양옆 56px 은 비워 오른쪽 닫기(44px)와 겹치지 않게 한다. */}
              <div
                className="mx-14 flex items-center justify-center"
                style={{ touchAction: "none", minHeight: 44 }}
                onPointerDown={(e) => dragControls.start(e)}
                {...(cardMode && {
                  onClick: toggle,
                  role: "button",
                  "aria-label": expanded ? "상세 접기" : "상세 펼치기",
                  "aria-expanded": expanded,
                })}
              >
                <div className="h-[5px] w-9 cursor-grab rounded-full bg-[var(--card-handle)] active:cursor-grabbing" />
              </div>
              <button
                onClick={onClose}
                aria-label="닫기"
                // 보이는 동그라미는 그대로, 누르는 영역만 44px. 떠 있는 카드에선 업종 타일 줄 오른쪽에 맞춘다.
                className={`absolute flex h-11 w-11 items-center justify-center ${cardMode ? "right-1 top-[46px]" : "right-1.5 top-0"}`}
              >
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--card-soft)] text-[var(--card-primary)]">
                  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M7 7l10 10M17 7L7 17" />
                  </svg>
                </span>
              </button>
            </div>
            <div className={`overflow-y-auto ${cardMode ? "px-4 pb-4" : `px-5 ${expanded ? "pb-6" : "pb-[max(16px,env(safe-area-inset-bottom))]"}`}`}>
              <DetailContent
                place={place}
                region={region}
                compact={!expanded}
                onExpand={expand}
                onCollapse={cardMode ? () => setExpandedFor(null) : undefined}
                look={cardMode ? "float" : undefined}
              />
            </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
