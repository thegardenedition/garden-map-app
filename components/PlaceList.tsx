"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Place } from "@/lib/types";
import { SUB_DEFS } from "@/lib/types";
import EmptyState from "./EmptyState";

// [리스트 가상화] 뷰포트에 보이는 행만 렌더링해 결과가 수백~수천 건이어도 DOM 노드 수를 상수로 유지한다.
const ROW_HEIGHT = 78;

function formatDistance(m: number | null): string {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export default function PlaceList({
  places,
  onSelect,
  hasSearched,
}: {
  places: Place[];
  onSelect: (place: Place) => void;
  hasSearched: boolean;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: places.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  if (!hasSearched) {
    return <EmptyState title="검색어를 입력해주세요" body="예: 조경, 잔디, 수목원, 공원" />;
  }
  if (places.length === 0) {
    return <EmptyState title="이 지역에는 아직 등록된 공간이 없습니다" body="다른 지역이나 검색어로 다시 시도해보세요." />;
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const place = places[row.index];
          const subLabel = SUB_DEFS[place.categoryDepth1]?.find((s) => s.id === place.categoryDepth2);
          const icon = subLabel?.icon ?? "📍";
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
              className="flex flex-col items-start justify-center border-b border-[#F0F1FC] px-[18px] text-left active:bg-[#F5F6FF]"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="tp-caption rounded-lg bg-[rgba(6,16,125,0.08)] px-2 py-0.5 text-[9px] text-[var(--color-deep-blue)]">
                  {icon} {subLabel?.label ?? ""}
                </span>
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
  );
}
