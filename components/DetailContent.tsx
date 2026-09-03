"use client";

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { Place, Region } from "@/lib/types";
import { SUB_DEFS } from "@/lib/types";
import { fetchNaverHomepage, fetchTourIntro, kakaoDirLink } from "@/lib/api";
import { kakaoPlaceLink } from "@/lib/shareLink";
import ShareButton from "./ShareButton";

function InfoRow({ icon, label, value, muted }: { icon: string; label: string; value: string | null; muted?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 border-b border-[#F5F6FF] py-[7px] text-[12.5px] last:border-b-0">
      <span className="w-4 flex-shrink-0 text-center opacity-70">{icon}</span>
      <span className="w-16 flex-shrink-0 font-bold text-[#9AA0C4]">{label}</span>
      <span className={`min-w-0 flex-1 break-words ${muted ? "text-[#C2C6DE]" : "text-[#3A3A55]"}`}>{value || "정보없음"}</span>
    </div>
  );
}

function truncateUrl(url: string, maxLen: number) {
  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return display.length > maxLen ? display.slice(0, maxLen) + "…" : display;
}

export default function DetailContent({ place, region }: { place: Place; region: Region }) {
  // [예측 프리패칭과 연동] MapCanvas/리스트에서 이미 queryClient.prefetchQuery를 호출해두므로
  // 이 useQuery는 대부분 캐시 히트로 즉시 렌더링된다.
  const tourInfo = useQuery({
    queryKey: ["tourIntro", place.placeId],
    queryFn: () => fetchTourIntro(place.placeId.replace("tour-", "")),
    enabled: place.source === "tourapi",
    staleTime: 5 * 60_000,
  });

  const naverHomepage = useQuery({
    queryKey: ["naverHomepage", place.placeId],
    queryFn: () => fetchNaverHomepage(place.placeName, region),
    enabled: place.source === "kakao" && !place.homepageDirect,
    staleTime: 5 * 60_000,
  });

  const subDef = SUB_DEFS[place.categoryDepth1]?.find((s) => s.id === place.categoryDepth2);

  return (
    <div>
      <span className="tp-caption mb-2 inline-block rounded-lg bg-[rgba(6,16,125,0.08)] px-3 py-1 text-[var(--color-deep-blue)]">
        {subDef?.icon} {place.categoryDepth2 && subDef?.label}
      </span>
      <h3 className="tp-title mb-1 break-words text-[#0A0A23]">{place.placeName}</h3>
      <p className="tp-body mb-2.5 break-words text-[#5A5A78]">{place.address}</p>

      {place.source === "tourapi" ? (
        <div>
          <InfoRow icon="☎" label="전화" value={place.contact || tourInfo.data?.tel || null} muted={!place.contact && !tourInfo.data?.tel} />
          <InfoRow icon="🕐" label="이용시간" value={tourInfo.data?.usetime ?? null} muted={!tourInfo.data?.usetime} />
          <InfoRow icon="📅" label="쉬는날" value={tourInfo.data?.restdate ?? null} muted={!tourInfo.data?.restdate} />
          <InfoRow icon="🅿" label="주차" value={tourInfo.data?.parking ?? null} muted={!tourInfo.data?.parking} />
        </div>
      ) : (
        <div>
          <InfoRow icon="☎" label="전화" value={place.contact} muted={!place.contact} />
          <InfoRow icon="🏷" label="사업영역" value={null} muted />
          <InfoRow
            icon="🔗"
            label="홈페이지"
            value={
              place.homepageDirect
                ? truncateUrl(place.homepageDirect, 30)
                : naverHomepage.isLoading
                  ? "확인 중..."
                  : naverHomepage.data
                    ? truncateUrl(naverHomepage.data, 30)
                    : null
            }
            muted={!place.homepageDirect && !naverHomepage.data}
          />
          <InfoRow icon="📍" label="출처" value={place.homepage ? "카카오맵" : "네이버"} />
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        <a
          className="tp-caption rounded-2xl border-[1.5px] border-[var(--color-deep-blue)] bg-[var(--color-deep-blue)] px-4 py-2.5 text-white"
          href={kakaoDirLink(place.placeName, place.coordinates[1], place.coordinates[0])}
          target="_blank"
          rel="noopener noreferrer"
        >
          길찾기
        </a>
        {(place.homepageDirect || naverHomepage.data) && (
          <a
            className="tp-caption rounded-2xl border-[1.5px] border-[var(--color-deep-blue)] px-4 py-2.5 text-[var(--color-deep-blue)]"
            href={place.homepageDirect || naverHomepage.data!}
            target="_blank"
            rel="noopener noreferrer"
          >
            홈페이지
          </a>
        )}
        <ShareButton
          title={place.placeName}
          text={place.address}
          url={kakaoPlaceLink(place.placeName, place.coordinates[1], place.coordinates[0])}
        />
      </div>

      {/* [Sticky CTA] 네온 옐로우 배경 + 딥 블루 텍스트, 탭 시 scale 0.95 햅틱 애니메이션 */}
      <motion.button
        whileTap={{ scale: 0.95 }}
        className="tp-cta sticky bottom-0 mt-5 w-full rounded-2xl bg-[var(--color-neon-yellow)] py-3.5 text-[var(--color-deep-blue)]"
      >
        믿을 수 있는 정원전문가 찾기
      </motion.button>
    </div>
  );
}
