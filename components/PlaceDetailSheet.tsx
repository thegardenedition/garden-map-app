"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import type { Place, Region } from "@/lib/types";
import DetailContent from "./DetailContent";

/*
 * [모달로 명확히 하다 — 2026-09-09]
 * 리스트 시트는 지도를 계속 만질 수 있어야 하는 탐색 화면이라 비모달로 둔다. 장소 상세는
 * 성격이 다르다 — 하나의 대상에 집중하는 화면인데, 지금까지는 딤 처리도 없고 배경을 탭해
 * 닫는 방법도 없어서 우측 상단의 작은 ✕ 버튼이 유일한 탈출구였다. 배경을 어둡게 하고 탭하면
 * 닫히게 해서 이 화면만큼은 명확히 모달로 만든다.
 *
 * [손잡이와 드래그 닫기 — 2026-09-09]
 * 리스트 시트는 손잡이로 끌어올리고 내리는데, 상세 시트는 드래그가 아예 안 돼서 방금 리스트에서
 * 쓰던 조작이 여기서는 안 통했다. 같은 방식(손잡이에서만 드래그 시작)을 그대로 가져온다 —
 * 이러면 DetailContent를 아무리 스크롤해도 시트가 끌려오지 않는다.
 */
export default function PlaceDetailSheet({
  place,
  region,
  onClose,
}: {
  place: Place | null;
  region: Region;
  onClose: () => void;
}) {
  const dragControls = useDragControls();

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  }

  return (
    <AnimatePresence>
      {place && (
        <>
          <motion.div
            key="backdrop"
            className="absolute inset-0 z-[70] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            className="gpu absolute inset-x-0 bottom-0 z-[80] flex max-h-[70dvh] flex-col rounded-t-[20px] bg-white shadow-[0_-10px_30px_rgba(0,0,0,0.32)]"
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            exit={{ y: "105%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            <div className="relative flex-shrink-0" style={{ minHeight: 32 }}>
              {/* 보이는 막대는 5px 이지만 손가락 닿는 영역은 리스트 시트와 같은 44px 로 넓힌다. */}
              <div
                className="flex items-center justify-center"
                style={{ touchAction: "none", minHeight: 44 }}
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="h-[5px] w-9 cursor-grab rounded-full bg-[#DADDEF] active:cursor-grabbing" />
              </div>
              <button
                onClick={onClose}
                aria-label="닫기"
                className="absolute right-3.5 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#EEF0FF] text-[13px] text-[var(--color-deep-blue)]"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-5 pb-6">
              <DetailContent place={place} region={region} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
