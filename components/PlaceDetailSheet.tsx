"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Place, Region } from "@/lib/types";
import DetailContent from "./DetailContent";

export default function PlaceDetailSheet({
  place,
  region,
  onClose,
}: {
  place: Place | null;
  region: Region;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {place && (
        <motion.div
          className="gpu absolute inset-x-0 bottom-0 z-[80] max-h-[70dvh] overflow-y-auto rounded-t-[20px] bg-white px-5 pt-4 pb-6 shadow-[0_-10px_30px_rgba(0,0,0,0.32)]"
          initial={{ y: "105%" }}
          animate={{ y: 0 }}
          exit={{ y: "105%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          <button
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-3.5 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#EEF0FF] text-[13px] text-[var(--color-deep-blue)]"
          >
            ✕
          </button>
          <DetailContent place={place} region={region} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
