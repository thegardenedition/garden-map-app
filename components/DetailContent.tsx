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

/*
 * [문의 입구 스위치 — 2026-10-21 대표 지시]
 * "정원지도에서 전문가 견적 연결은 후순위. 대표가 오픈하라고 하면 오픈한다." 지도 앱의 유일한
 * 문의 입구(아래 「정원전문가 찾기」 버튼 → LeadModal / 채널그린 목록 링크)를 지우지 않고 숨긴다.
 * 다시 열 때는 Vercel 환경변수 NEXT_PUBLIC_LEAD_ENTRY_OPEN=1 을 넣고 재배포하거나, 이 줄의
 * 기본값을 바꾼다. 폼·mg-biz 워커는 그대로다.
 */
const LEAD_ENTRY_OPEN = process.env.NEXT_PUBLIC_LEAD_ENTRY_OPEN === "1";

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

// [사업영역 문구 다듬기 — 2026-09-20] 카카오·네이버·D1 대장이 주는 원문은
// "서비스,산업 > 건설,건축 > 엔지니어링 > 조경설계"처럼 최상위 대분류부터 다 들어 있다.
// 사용자에게는 맨 앞 대분류(서비스,산업 / 가정,생활 같은)가 의미가 없고 뒤쪽 2단계가
// 실제로 궁금한 정보라 그것만 남긴다. 구분자도 " > "(내부 분류 표기)에서 " · "로 바꾼다.
function formatBusinessCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(">").map((s) => s.trim()).filter(Boolean);
  return parts.slice(-2).join(" · ") || raw;
}

/**
 * compact: 모바일에서 핀을 고른 직후의 작은 카드. 업종·이름·주소·바로 쓰는 버튼만 남기고
 * 정보 줄과 하단 CTA는 펼쳤을 때만 보인다(2026-10-21 대표 "바텀이 시야를 가린다" — 상세
 * 시트가 처음부터 화면 절반 넘게 올라와 지도를 덮었다).
 *
 * look="float": 모바일 장소 카드의 B안(2026-10-22 대표 선택 — 딥블루로 띄운 카드, 둥근
 * 모서리). 업종 타일+이름 머리, 길찾기 알약 하나만 채우고 나머지는 둥근 아이콘 버튼.
 * 색은 globals.css 의 --card-* 한 곳에서만 온다. 데스크톱 사이드바는 look 없이 그대로.
 */
// 키보드 포커스 링(2px 딥블루, 2px 띄움) — 디자인 진단 10-22 필수 조건.
const FLOAT_FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--card-primary)]";
// 아이콘 22px + 글자 12.5px/600 을 세로로 쌓은 같은 폭 타일(높이 60px).
const FLOAT_TILE = `flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[12.5px] font-semibold tracking-[-0.01em] transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${FLOAT_FOCUS}`;
const FLOAT_TILE_SOFT = "bg-[var(--card-soft)] text-[var(--card-primary)]";

export default function DetailContent({
  place,
  region,
  compact = false,
  onExpand,
  onCollapse,
  look,
}: {
  place: Place;
  region: Region;
  compact?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  look?: "float";
}) {
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
  const float = look === "float";
  const homepageUrl = place.homepageDirect || naverHomepage.data;

  return (
    <div>
      {float ? (
        <>
          {/* 오른쪽 48px 은 시트의 닫기 버튼 자리라 비워 둔다. */}
          <div className="flex items-center gap-3 pr-11">
            {/* 업종 아이콘은 흰색 하나로 — 색이 아니라 모양으로 구별한다(지도 핀과 같은 규칙). */}
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--card-primary)] text-[var(--card-on-primary)]">
              <CategoryIcon group={place.categoryDepth1} sub={place.categoryDepth2} size={26} color="currentColor" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[12.5px] font-semibold text-[var(--card-meta)]">
                {subDef?.label ?? ""}
              </span>
              {/* 긴 업체명이 잘리지 않게 2줄까지(카드 약 +26px, 상한 30% 안). */}
              <h3 className="line-clamp-2 break-words text-[20px] font-extrabold leading-snug tracking-[-0.03em] text-[var(--card-title)]">
                {place.placeName}
              </h3>
            </div>
          </div>
          <p className={`mt-2.5 break-words text-[14px] leading-snug tracking-[-0.01em] text-[var(--card-sub)] ${compact ? "line-clamp-2" : "mb-2.5"}`}>
            {place.address}
          </p>
        </>
      ) : (
        <>
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
          <p className={`tp-body mb-2.5 break-words text-[#5A5A78] ${compact ? "line-clamp-1" : ""}`}>{place.address}</p>
        </>
      )}

      {compact ? null : place.source === "registry" ? (
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
      ) : place.source === "citypark" ? (
        /* [전국도시공원정보표준데이터] 국토교통부/지자체가 매년 갱신하는 법정 도시공원 대장.
           TourAPI·한국수목원정원관리원 대장에 없는 동네 근린공원·어린이공원까지 커버한다.
           입장료·홈페이지 개념이 없는 대신, 법정 공원구분과 실제 보유시설을 보여준다. */
        <div>
          <InfoRow icon={<InfoIcon name="tag" />} label="공원구분" value={place.parkKind ?? null} muted={!place.parkKind} />
          <InfoRow
            icon={<InfoIcon name="area" />}
            label="면적"
            value={place.parkArea ? `${Math.round(place.parkArea).toLocaleString()}㎡` : null}
            muted={!place.parkArea}
          />
          <InfoRow
            icon={<InfoIcon name="facility" />}
            label="보유시설"
            value={place.parkFacilities?.length ? place.parkFacilities.join(" · ") : null}
            muted={!place.parkFacilities?.length}
          />
          <InfoRow icon={<InfoIcon name="phone" />} label="전화" value={place.contact} muted={!place.contact} />
          <InfoRow icon={<InfoIcon name="pin" />} label="관리기관" value={place.institution ?? "국토교통부·지자체"} />
          <InfoRow icon={<InfoIcon name="note" />} label="출처" value="전국도시공원정보표준데이터(공공데이터포털)" />
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
          {place.description && (
            <p className="mb-2 text-[12.5px] leading-relaxed text-[#5A5A78]">{place.description}</p>
          )}
          <InfoRow icon={<InfoIcon name="phone" />} label="전화" value={place.contact} muted={!place.contact} />
          <InfoRow
            icon={<InfoIcon name="tag" />}
            label="사업영역"
            value={formatBusinessCategory(place.businessCategory)}
            muted={!place.businessCategory}
          />
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

      {float ? (
        /* [버튼 넷을 같은 크기 타일로 — 2026-10-22 대표 "아이콘이 안 보이고 의도가 안 읽힌다"]
           아이콘만 있는 둥근 버튼은 뜻이 읽히지 않았다. 지도 앱들이 쓰는 방식대로 아이콘 아래에
           글자를 붙인 같은 폭 타일로 두고, 길찾기만 딥블루로 채워 첫 행동을 분명히 한다. */
        <div className="mt-3.5 flex gap-1.5">
          <a
            className={`${FLOAT_TILE} bg-[var(--card-primary)] text-[var(--card-on-primary)] active:bg-[var(--card-primary-pressed)]`}
            href={kakaoDirLink(place.placeName, place.coordinates[1], place.coordinates[0])}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.8l9.2 9.2-9.2 9.2L2.8 12z" />
              <path d="M9 15v-3.5h6" />
              <path d="M12.5 9l2.5 2.5-2.5 2.5" />
            </svg>
            길찾기
          </a>
          {homepageUrl && (
            <a className={`${FLOAT_TILE} ${FLOAT_TILE_SOFT}`} href={homepageUrl} target="_blank" rel="noopener noreferrer">
              <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3a14 14 0 0 1 0 18" />
                <path d="M12 3a14 14 0 0 0 0 18" />
              </svg>
              홈페이지
            </a>
          )}
          {!compact && place.homepage && (
            <a className={`${FLOAT_TILE} ${FLOAT_TILE_SOFT}`} href={place.homepage} target="_blank" rel="noopener noreferrer">
              <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 18.5 9.8C18.5 14.8 12 21 12 21z" />
                <circle cx="12" cy="9.8" r="2.4" />
              </svg>
              카카오맵
            </a>
          )}
          <ShareButton
            className={`${FLOAT_TILE} ${FLOAT_TILE_SOFT}`}
            title={place.placeName}
            text={place.address}
            url={kakaoPlaceLink(place.placeName, place.coordinates[1], place.coordinates[0])}
          >
            <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V4" />
              <path d="M8 8l4-4 4 4" />
              <path d="M5 13v6h14v-6" />
            </svg>
            공유
          </ShareButton>
          {compact && onExpand && (
            <button onClick={onExpand} aria-expanded={false} className={`${FLOAT_TILE} ${FLOAT_TILE_SOFT}`}>
              <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 14l5-5 5 5" />
              </svg>
              자세히
            </button>
          )}
          {!compact && onCollapse && (
            <button onClick={onCollapse} aria-expanded={true} className={`${FLOAT_TILE} ${FLOAT_TILE_SOFT}`}>
              <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 10l5 5 5-5" />
              </svg>
              접기
            </button>
          )}
        </div>
      ) : (
      <div className="mt-3.5 flex flex-wrap gap-2">
        <a
          className="tp-caption inline-flex min-h-[44px] items-center rounded-2xl border-[1.5px] border-[var(--color-deep-blue)] bg-[var(--color-deep-blue)] px-4 py-2.5 text-white"
          href={kakaoDirLink(place.placeName, place.coordinates[1], place.coordinates[0])}
          target="_blank"
          rel="noopener noreferrer"
        >
          길찾기
        </a>
        {(place.homepageDirect || naverHomepage.data) && (
          <a
            className="tp-caption inline-flex min-h-[44px] items-center rounded-2xl border-[1.5px] border-[var(--color-deep-blue)] px-4 py-2.5 text-[var(--color-deep-blue)]"
            href={place.homepageDirect || naverHomepage.data!}
            target="_blank"
            rel="noopener noreferrer"
          >
            홈페이지
          </a>
        )}
        {/* [카카오맵에서 보기 — 2026-09-20] place.homepage는 업체 홈페이지가 아니라 카카오
            응답의 place_url(카카오맵 상세 페이지)이다. 지금까지는 "출처가 카카오다"를
            판별하는 용도로만 쓰고 링크로는 안 보여줬는데, 그 페이지에 이미 쌓인 리뷰·사진·
            영업시간을 사용자가 바로 볼 수 있게 버튼으로 노출한다. registry·tourapi·custom·
            네이버 단독 결과는 이 값이 없어 버튼 자체가 안 뜬다. */}
        {place.homepage && (
          <a
            className="tp-caption inline-flex min-h-[44px] items-center rounded-2xl border-[1.5px] border-[var(--color-deep-blue)] px-4 py-2.5 text-[var(--color-deep-blue)]"
            href={place.homepage}
            target="_blank"
            rel="noopener noreferrer"
          >
            카카오맵에서 보기
          </a>
        )}
        <ShareButton
          title={place.placeName}
          text={place.address}
          url={kakaoPlaceLink(place.placeName, place.coordinates[1], place.coordinates[0])}
        />
        {compact && onExpand && (
          <button
            onClick={onExpand}
            aria-expanded={false}
            className="tp-caption inline-flex min-h-[44px] items-center gap-1 rounded-2xl border-[1.5px] border-[#DADDEF] px-4 py-2.5 text-[var(--color-deep-blue)]"
          >
            자세히
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      )}

      {/* [Sticky CTA] 네온 옐로우 배경 + 딥 블루 텍스트, 탭 시 scale 0.95 햅틱 애니메이션.
          [잠정 링크 — 2026-09-19] mg-biz 리드 폼(LEAD_FORM_LIVE_AT)이 뜨기 전까지는 리드
          모달 대신 채널그린 정원작가 리스트로 바로 보낸다. 개인정보를 우리 쪽에서 받는 게
          아니라 외부 링크일 뿐이라 리드 폼의 방침 개정 게이트와는 무관하다. 폼이 열리면
          원래 문구·동작으로 자동 전환된다(별도 배포 불필요). 작은 카드(compact)에서는 숨긴다.
          LEAD_ENTRY_OPEN 이 꺼져 있으면(기본) 어디에서도 보이지 않는다. */}
      {compact || !LEAD_ENTRY_OPEN ? null : leadFormLive ? (
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

      {LEAD_ENTRY_OPEN && leadFormLive && leadModalOpen && <LeadModal place={place} onClose={() => setLeadModalOpen(false)} />}
    </div>
  );
}
