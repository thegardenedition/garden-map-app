"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { Place, Region } from "@/lib/types";
import { SUB_DEFS } from "@/lib/types";
import { CategoryIcon, GROUP_COLOR, InfoIcon } from "@/lib/icons";
import { fetchNaverHomepage, fetchTourIntro, kakaoDirLink } from "@/lib/api";
import { kakaoPlaceLink } from "@/lib/shareLink";
import ShareButton from "./ShareButton";
import LeadModal from "./LeadModal";

/*
 * [리드 폼 개시일 게이트 — 2026-09-16 세션 간 합의]
 * mg-biz 리드 접수는 개인정보처리방침 개정(신규 항목: 정원 유형·예산대 등) 시행일인
 * 2026-09-23 이후에만 열 수 있다 — 그 전에 접수하면 구 방침 아래에서 신규 항목을 걷는
 * 셈이 된다. 날짜만 비교해 자동으로 열리게 해서, 그날 별도 배포 없이도 켜진다.
 * 그 전까지는 버튼 모양은 그대로 두고 onClick만 비워, 지금과 같은 화면을 유지한다.
 */
const LEAD_FORM_LIVE_AT = new Date("2026-09-23T00:00:00+09:00").getTime();

// [href를 주면 값 자체가 하이퍼링크가 된다 — 2026-09-10]
// 홈페이지 URL을 여기 텍스트로만 보여줬더니 링크처럼 보이는데 눌러도 아무 반응이 없었다
// (실제 이동은 아래 별도 "홈페이지" 버튼에서만 됐다). value를 <a>로 바꿔 그 자리에서 바로
// 눌러 이동할 수 있게 한다. href가 없으면(정보 자체가 없을 때) 예전처럼 일반 텍스트로 둔다.
function InfoRow({
  icon,
  label,
  value,
  muted,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  muted?: boolean;
  href?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 border-b border-[#F5F6FF] py-[7px] text-[12.5px] last:border-b-0">
      <span className="flex w-4 flex-shrink-0 items-center justify-center pt-[1px] text-[#9AA0C4]">{icon}</span>
      <span className="w-16 flex-shrink-0 font-bold text-[#9AA0C4]">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 break-words text-[var(--color-deep-blue)] underline underline-offset-2"
        >
          {value}
        </a>
      ) : (
        <span className={`min-w-0 flex-1 break-words ${muted ? "text-[#C2C6DE]" : "text-[#3A3A55]"}`}>{value || "정보없음"}</span>
      )}
    </div>
  );
}

// 대장은 성인/청소년/어린이/장애인 요금을 따로 준다. 다 있는 곳도, 성인만 있는 곳도 있어서
// 있는 것만 붙여 한 줄로 만든다. 요금 항목이 아예 없으면 무료로 본다(대장의 입장료여부 = N).
const FEE_LABEL: Record<string, string> = { adult: "성인", youth: "청소년", child: "어린이", disabled: "장애인" };
function formatFees(fees: Place["fees"]): string {
  if (!fees) return "무료";
  const parts = (Object.keys(FEE_LABEL) as (keyof NonNullable<Place["fees"]>)[])
    .filter((k) => typeof fees[k] === "number")
    .map((k) => `${FEE_LABEL[k]} ${fees[k]!.toLocaleString()}원`);
  return parts.length ? parts.join(" · ") : "무료";
}

function truncateUrl(url: string, maxLen: number) {
  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return display.length > maxLen ? display.slice(0, maxLen) + "…" : display;
}

export default function DetailContent({ place, region }: { place: Place; region: Region }) {
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const leadFormLive = Date.now() >= LEAD_FORM_LIVE_AT;

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
      <span className="tp-caption mb-2 inline-flex items-center gap-1.5 rounded-lg bg-[rgba(6,16,125,0.08)] px-3 py-1 text-[var(--color-deep-blue)]">
        <CategoryIcon
          group={place.categoryDepth1}
          sub={place.categoryDepth2}
          size={14}
          color={GROUP_COLOR[place.categoryDepth1]}
        />
        {place.categoryDepth2 && subDef?.label}
      </span>
      <h3 className="tp-title mb-1 break-words text-[#0A0A23]">{place.placeName}</h3>
      <p className="tp-body mb-2.5 break-words text-[#5A5A78]">{place.address}</p>

      {place.source === "registry" ? (
        /* [대장 출처] 한국수목원정원관리원이 직접 관리하는 값이라 외부에 다시 물어볼 필요가 없다.
           투어API가 주지 않는 입장료·반려동물 동반 여부를 여기서만 보여줄 수 있다. */
        <div>
          <InfoRow icon={<InfoIcon name="phone" />} label="전화" value={place.contact} muted={!place.contact} />
          <InfoRow icon={<InfoIcon name="fee" />} label="입장료" value={formatFees(place.fees)} />
          <InfoRow icon={<InfoIcon name="closedDay" />} label="휴관일" value={place.restdate ?? null} muted={!place.restdate} />
          <InfoRow icon={<InfoIcon name="pet" />} label="반려동물" value={place.petAllowed ? "동반 가능" : "동반 불가"} muted={!place.petAllowed} />
          {place.species?.some(Boolean) && (
            <InfoRow icon={<InfoIcon name="species" />} label="대표수종" value={place.species.filter(Boolean).join(" / ")} />
          )}
          <InfoRow
            icon={<InfoIcon name="link" />}
            label="홈페이지"
            value={place.homepageDirect ? truncateUrl(place.homepageDirect, 30) : null}
            muted={!place.homepageDirect}
            href={place.homepageDirect}
          />
          <InfoRow icon={<InfoIcon name="pin" />} label="출처" value="한국수목원정원관리원" />
        </div>
      ) : place.source === "tourapi" ? (
        <div>
          <InfoRow icon={<InfoIcon name="phone" />} label="전화" value={place.contact || tourInfo.data?.tel || null} muted={!place.contact && !tourInfo.data?.tel} />
          <InfoRow icon={<InfoIcon name="clock" />} label="이용시간" value={tourInfo.data?.usetime ?? null} muted={!tourInfo.data?.usetime} />
          <InfoRow icon={<InfoIcon name="closedDay" />} label="쉬는날" value={tourInfo.data?.restdate ?? null} muted={!tourInfo.data?.restdate} />
          <InfoRow icon={<InfoIcon name="parking" />} label="주차" value={tourInfo.data?.parking ?? null} muted={!tourInfo.data?.parking} />
        </div>
      ) : place.source === "custom" ? (
        /* [간단 핀] "가든 핀 등록 도구"로 사람이 직접 넣은 장소라 연락처/홈페이지를 외부에서
           보완할 방법이 없다 — 등록할 때 남긴 메모와 사진이 정보의 전부다. */
        <div>
          {place.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 관리자가 붙여넣는 임의의
            // 외부 URL이라 next/image의 도메인 화이트리스트에 걸린다. 원본을 그대로 보여줄
            // 뿐이라 최적화가 필요 없다.
            <img
              src={place.photoUrl}
              alt={place.placeName}
              loading="lazy"
              className="mb-2.5 h-40 w-full rounded-xl object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <InfoRow icon={<InfoIcon name="note" />} label="메모" value={place.note ?? null} muted={!place.note} />
          <InfoRow icon={<InfoIcon name="pin" />} label="출처" value="가든 핀 등록 도구" />
        </div>
      ) : (
        <div>
          <InfoRow icon={<InfoIcon name="phone" />} label="전화" value={place.contact} muted={!place.contact} />
          <InfoRow icon={<InfoIcon name="tag" />} label="사업영역" value={null} muted />
          <InfoRow
            icon={<InfoIcon name="link" />}
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
            href={place.homepageDirect || naverHomepage.data}
          />
          <InfoRow icon={<InfoIcon name="pin" />} label="출처" value={place.homepage ? "카카오맵" : "네이버"} />
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

      {/* [Sticky CTA] 네온 옐로우 배경 + 딥 블루 텍스트, 탭 시 scale 0.95 햅틱 애니메이션.
          [잠정 링크 — 2026-09-19] mg-biz 리드 폼(LEAD_FORM_LIVE_AT)이 뜨기 전까지는 리드
          모달 대신 채널그린 정원작가 리스트로 바로 보낸다. 개인정보를 우리 쪽에서 받는 게
          아니라 외부 링크일 뿐이라 리드 폼의 방침 개정 게이트와는 무관하다. 폼이 열리면
          원래 문구·동작으로 자동 전환된다(별도 배포 불필요). */}
      {leadFormLive ? (
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setLeadModalOpen(true)}
          className="tp-cta sticky bottom-0 mt-5 w-full rounded-2xl bg-[var(--color-neon-yellow)] py-3.5 text-[var(--color-deep-blue)]"
        >
          믿을 수 있는 정원전문가 찾기
        </motion.button>
      ) : (
        <motion.a
          whileTap={{ scale: 0.95 }}
          href="https://chgreen.co.kr/gardend/gd_list.html"
          target="_blank"
          rel="noopener noreferrer"
          className="tp-cta sticky bottom-0 mt-5 block w-full rounded-2xl bg-[var(--color-neon-yellow)] py-3.5 text-center text-[var(--color-deep-blue)]"
        >
          나만의 정원전문가 찾기 ↗
        </motion.a>
      )}

      {leadFormLive && leadModalOpen && <LeadModal place={place} onClose={() => setLeadModalOpen(false)} />}
    </div>
  );
}
