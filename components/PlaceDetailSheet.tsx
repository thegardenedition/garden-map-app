"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import type { Place, Region } from "@/lib/types";
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
            className="pointer-events-none absolute inset-0 z-[var(--z-modal-backdrop)] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            key="sheet"
            className="gpu absolute inset-x-0 bottom-0 z-[var(--z-modal-sheet)] flex max-h-[70dvh] flex-col rounded-t-[20px] bg-white shadow-[0_-10px_30px_rgba(0,0,0,0.32)]"
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
