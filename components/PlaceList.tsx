"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Place } from "@/lib/types";
import { SUB_DEFS, formatDistance } from "@/lib/types";
import { CategoryIcon, GROUP_COLOR } from "@/lib/icons";
import EmptyState from "./EmptyState";

// [리스트 가상화] 뷰포트에 보이는 행만 렌더링해 결과가 수백~수천 건이어도 DOM 노드 수를 상수로 유지한다.
const ROW_HEIGHT = 78;

// [불러오는 중] 예전에는 첫 조회 중에 「검색어를 입력해주세요」 안내가 그대로 떴다(방금 검색했는데
// 입력하라고 하는 모순). 자리를 잡아 주는 회색 줄과 스크린리더용 문구로 「기다리는 중」임을 알린다.
function LoadingRows() {
  return (
    <div role="status" aria-busy="true" className="flex-1 overflow-hidden">
      <p className="sr-only">목록을 불러오는 중입니다</p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden="true" className="flex flex-col justify-center gap-2 border-b border-[#F0F1FC] px-[18px]" style={{ height: ROW_HEIGHT }}>
          <div className="h-3 w-16 rounded-lg bg-[#EEF0FA] motion-safe:animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-[#EEF0FA] motion-safe:animate-pulse" />
          <div className="h-3 w-4/5 rounded bg-[#F3F4FC] motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default function PlaceList({
  places,
  onSelect,
  hasSearched,
  isLoading = false,
  isError = false,
  onRetry,
  notice = null,
}: {
  places: Place[];
  onSelect: (place: Place) => void;
  hasSearched: boolean;
  // 데이터가 아직 한 번도 오지 않은 첫 조회 중(placeholder 로 이전 결과가 떠 있는 재조회 동안은 false)
  isLoading?: boolean;
  // 조회가 끝내 실패한 상태. 예전에는 실패해도 「등록된 공간이 없습니다」로 보여서 오류가 「없음」으로 위장됐다.
  isError?: boolean;
  onRetry?: () => void;
  // 「일부만 보여요」 같은 결과 위 안내(없으면 null)
  notice?: string | null;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: places.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  if (isError && places.length === 0) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-10 text-center">
        <p className="tp-body font-bold text-[#3A3A55]">목록을 불러오지 못했어요</p>
        <p className="tp-caption font-normal text-[#9AA0C4]">
          네트워크가 불안정하거나 서버가 잠시 응답하지 않아요. 잠시 뒤에 다시 시도해 주세요.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 h-11 rounded-full bg-[#0B5345] px-6 text-[14px] font-bold text-white transition-opacity duration-150 active:opacity-80"
          >
            다시 시도
          </button>
        )}
      </div>
    );
  }
  if (isLoading) return <LoadingRows />;
  if (!hasSearched) {
    return <EmptyState title="검색어를 입력해주세요" body="예: 조경, 잔디, 수목원, 공원" />;
  }
  if (places.length === 0) {
    return <EmptyState title="이 지역에는 아직 등록된 공간이 없습니다" body="다른 지역이나 검색어로 다시 시도해보세요." />;
  }

  return (
    <>
    {notice && (
      <div role="status" className="flex-shrink-0 bg-[#EEF5F2] px-[18px] py-2.5 text-[12.5px] leading-[1.5] text-[#0B5345]">
        {notice}
      </div>
    )}
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const place = places[row.index];
          const subLabel = SUB_DEFS[place.categoryDepth1]?.find((s) => s.id === place.categoryDepth2);
          const icon = (
            <CategoryIcon
              group={place.categoryDepth1}
              sub={place.categoryDepth2}
              size={12}
              color={GROUP_COLOR[place.categoryDepth1]}
            />
          );
          return (
            <button
              key={place.placeId}
              onClick={() => onSelect(place)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
              className="flex flex-col items-start justify-center border-b border-[#F0F1FC] px-[18px] text-left transition-colors duration-150 active:bg-[#F5F6FF]"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="tp-caption inline-flex items-center gap-1 rounded-lg bg-[rgba(6,16,125,0.08)] px-2 py-0.5 text-[9px] text-[var(--color-deep-blue)]">
                  {icon}
                  {subLabel?.label ?? ""}
                </span>
                {place.locationState === "pending" && (
                  <span className="tp-caption rounded-lg bg-[rgba(122,127,166,0.14)] px-2 py-0.5 text-[9px] text-[#5A5A78]">
                    지도 위치 확인 중
                  </span>
                )}
                {place.distanceM != null && (
                  <span className="tp-caption rounded-lg bg-[rgba(11,138,90,0.1)] px-2 py-0.5 text-[9px] text-[#0B8A5A]">
                    {formatDistance(place.distanceM)}
                  </span>
                )}
              </div>
              <div className="tp-body font-extrabold text-[#0A0A23]">{place.placeName}</div>
              <div className="text-[11.5px] text-[#7A7FA6]">{place.address}</div>
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}
