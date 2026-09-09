import type { GroupId, SubId } from "@/lib/types";

/*
 * [핀 아이콘 단일 소스]
 * 예전에는 분류 아이콘이 이모지 문자열이었다(📐 🏗 🚧 🌿 🪴 🌳 🌱 🧱 🏞 ⛰ 🌷). 문제가 셋이었다.
 *  1. 이모지는 스스로 색을 갖는다 — 🚧는 주황, 🧱는 붉은 벽돌, 🌷는 분홍으로 찍혀 핀의 그룹
 *     색과 충돌했다. 색으로 대분류를 읽게 하려던 설계가 무력해진다.
 *  2. 같은 코드가 OS마다 다른 그림으로 렌더된다(애플/구글/윈도우 이모지 폰트). 디자인을 통제할
 *     수 없고, ⛰처럼 variation selector가 없는 글자는 흑백 텍스트 글리프로 떨어지기도 했다.
 *  3. 11개가 제도도구·크레인·바리케이드·튤립사진처럼 시각 언어가 제각각이라 한 벌로 보이지 않았다.
 *
 * 그래서 11개를 같은 규격의 벡터로 다시 그렸다 — 24 그리드 / 선 굵기 2.1~2.3 / 둥근 끝 /
 * 획 5개 이하(실제 표시 크기가 17px라 그 이상은 뭉친다). 채움 없이 선만 쓰고 색은 바깥에서
 * 주입하므로, 지도 핀에서는 흰색으로 파이고 필터 칩에서는 글자색을 따라간다.
 *
 * 지도(MapCanvas) · 필터 칩(FilterChips) · 목록(PlaceList) · 상세(DetailContent)가 모두
 * 이 파일 하나를 본다. 아이콘을 고치면 네 곳이 같이 바뀐다.
 */

// [그룹 색] 대분류는 색, 소분류는 모양. 핀 하나에 색은 그룹색 + 흰색 둘뿐이다.
// 세 색 모두 흰 아이콘 대비 4.4:1 이상을 유지한다.
//
// [채도를 낮춘 브랜드 톤 → 원색 — 2026-09-10]
// 예전 테라코타·딥그린·슬레이트블루는 서로 밝기(L*)를 45 안팎으로 맞춘 차분한 톤이었는데,
// 그 절제된 채도가 카카오맵 타일 자체의 채도 낮은 팔레트(도로의 살구색, 숲의 카키그린,
// 수면의 파스텔블루)와 비슷해서 흰 테두리를 둘러도 여전히 눈에 잘 안 띈다는 피드백을 받았다.
// 지도 위 데이터 포인트는 지도보다 채도가 확실히 높아야 한눈에 튄다는 원칙으로, 같은 색상(주황·
// 초록·파랑)을 유지한 채 채도와 대비를 원색에 가깝게 끌어올렸다. 대신 서로 밝기가 벌어지면 한
// 색만 튀어 보이므로, 상대 휘도(흰 배경 기준)를 0.15~0.19 사이로 다시 맞췄다.
export const GROUP_COLOR: Record<GroupId, string> = {
  company: "#CC4A0A", // 주황 — 사람이 하는 일(설계·시공·관리)
  material: "#0E8A45", // 초록 — 사고파는 물건(나무·잔디·석재)
  park: "#2563EB", // 파랑 — 가는 곳(장소)
};

// [프로젝트 레이어] 채널그린 게시글 핀은 분류 3색 어디에도 속하지 않는 별도 레이어라
// 브랜드 네온옐로 바탕에 딥블루 아이콘으로 뒤집었다. 클러스터(딥블루 바탕 + 네온옐로 글자)와도
// 색이 반대라 겹쳐 보이지 않는다.
export const PROJECT_PIN_COLOR = "#E1FC48";
export const PROJECT_PIN_INK = "#06107D";

// 24×24 그리드 위의 선 도형. 채움은 없고(fill=none) stroke만 쓴다.
export const ICON_PATHS: Record<SubId, string> = {
  // 조경설계 — 삼각자. 처음엔 컴퍼스로 그렸는데 확대하면 알파벳 A로 읽혀서 버렸다.
  design: '<path d="M4.6 4.4v15h15z"/><path d="M8.2 14.4l4-4"/>',
  // 종합엔지니어링 — 겹친 레이어(조경 외 도로·구조 등 여러 분야를 함께 신고한 회사)
  engineering:
    '<path d="M12 3.4 3.6 7.9 12 12.4l8.4-4.5z"/><path d="M3.6 12.4 12 16.9l8.4-4.5"/><path d="M3.6 16.6 12 21.1l8.4-4.5"/>',
  // 조경시공 — 삽. 날이 작으면 나사·열쇠처럼 보인다. 자루를 줄이고 날을 키워야 삽으로 읽힌다.
  construction:
    '<path d="M12 2.6v8.2"/><path d="M8.6 2.6h6.8"/><path d="M6.6 10.8h10.8l-1.7 6.4a3.7 3.7 0 0 1-7.4 0z"/>',
  // 유지관리 — 전정가위
  maintenance:
    '<circle cx="7.4" cy="18.4" r="2.3"/><circle cx="16.6" cy="18.4" r="2.3"/><path d="M8.9 16.6 17.2 4.2"/><path d="M15.1 16.6 6.8 4.2"/>',
  // 플랜테리어 — 화분에 심긴 식물. 잎을 두 장 달았더니 17px에서 화분과 뭉쳤다. 한 장만 남기고 화분을 키웠다.
  trendy:
    '<path d="M6.8 13.6h10.4l-1.2 6.4a1.8 1.8 0 0 1-1.8 1.4H9.8a1.8 1.8 0 0 1-1.8-1.4z"/><path d="M12 13.6V9"/><path d="M12 10c0-2.9 1.9-4.8 4.6-4.8 0 2.9-1.9 4.8-4.6 4.8z"/>',
  // 조경종합 — 나무. 수관을 정원으로 그렸더니 막대사탕처럼 보여서 뭉게구름 윤곽으로 바꿨다.
  general:
    '<path d="M12 13.6v7.6"/><path d="M12 3c-2.1 0-3.8 1.4-4.3 3.3-2 .2-3.5 1.9-3.5 4 0 2.2 1.8 4 4 4h7.6c2.2 0 4-1.8 4-4 0-2.1-1.5-3.8-3.5-4C15.8 4.4 14.1 3 12 3z"/>',
  // 조경수/농원 — 지면에서 올라온 새싹(화분 식물과 달리 땅에 심겨 있다)
  nursery:
    '<path d="M4.2 20.8h15.6"/><path d="M12 20.8v-7.2"/><path d="M12 14.6c0-3.3 2.1-5.4 5.2-5.4 0 3.3-2.1 5.4-5.2 5.4z"/><path d="M12 17.2c0-2.7-1.8-4.4-4.4-4.4 0 2.7 1.8 4.4 4.4 4.4z"/>',
  // 자재/잔디/석재 — 쌓은 블록
  supply:
    '<rect x="3.4" y="13.4" width="7.2" height="6.2" rx="1.1"/><rect x="13.4" y="13.4" width="7.2" height="6.2" rx="1.1"/><rect x="8.4" y="6.2" width="7.2" height="6.2" rx="1.1"/>',
  // 도시공원 — 벤치 옆모습. 정면으로 그리면 등받이 기둥이 토리이(신사 문)처럼 보인다.
  city_park:
    '<path d="M3.2 13.6h17.6"/><path d="M4.8 16.8h14.4"/><path d="M6.4 16.8v3.2"/><path d="M17.6 16.8v3.2"/><path d="M5.8 8.6h12.4"/>',
  // 자연공원 — 산
  natural_park: '<path d="M2.6 19.6 9 7.9l4 6.3 2.4-3.5 6 8.9z"/>',
  // 수목원/정원 — 튤립
  garden:
    '<path d="M12 14.6v6.6"/><path d="M12 14.6c-2.7 0-4.3-2.1-4.3-5.1V5.8l2.8 2.7L12 5.4l1.5 3.1 2.8-2.7v3.7c0 3-1.6 5.1-4.3 5.1z"/><path d="M12 18.6c0-2.3-1.7-3.7-4-3.7 0 2.3 1.7 3.7 4 3.7z"/>',
};

// 프로젝트 게시글 — 문서
const PROJECT_ICON_PATH =
  '<path d="M5.4 3.6h10.2l3 3v13.8a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1z"/><path d="M15.4 3.6v3.2h3.2"/><path d="M7.8 12h8.4"/><path d="M7.8 16h5.6"/>';

// 소분류가 비어 있거나 알 수 없는 값일 때 그룹을 대표하는 아이콘.
const GROUP_FALLBACK: Record<GroupId, SubId> = {
  company: "general",
  material: "nursery",
  park: "city_park",
};

export function iconPathFor(group: GroupId, sub?: SubId | null): string {
  return (sub && ICON_PATHS[sub]) || ICON_PATHS[GROUP_FALLBACK[group]] || ICON_PATHS.general;
}

/* ────────────────────────── 지도 마커 ────────────────────────── */

/*
 * [핀 도형] viewBox는 항상 40×48로 고정하고, 실제 크기는 <img> 폭/높이로만 바꾼다.
 * 좌표계가 하나뿐이라 기본/선택 상태에서 아이콘 위치를 다시 계산할 필요가 없다.
 *  - 머리 중심 (20, 15.6), 반지름 13.2
 *  - 뾰족한 끝(= 지도상 실제 좌표) (20, 41)
 *  - 아이콘은 24 그리드를 0.72배 = 17.3px로 머리 정중앙에 놓는다
 *  - 그림자는 SVG 필터 대신 발밑 타원 하나. 마커가 수천 개 떠도 렌더가 무겁지 않다.
 */
const PIN_BODY =
  "M20 2.4C12.7 2.4 6.8 8.3 6.8 15.6c0 9.4 11.6 24.3 12.5 25.5a.9.9 0 0 0 1.4 0c.9-1.2 12.5-16.1 12.5-25.5C33.2 8.3 27.3 2.4 20 2.4Z";

const PIN_TIP_RATIO = 41 / 48; // 뾰족한 끝의 세로 위치 비율 — 마커 앵커 계산에 쓴다

export interface PinSize {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

// [크기] 예전 44×54는 서울 도심에서 핀끼리 겹쳐 뭉치는 주된 원인이었다. 32×38로 줄이되
// 모바일 터치 타겟은 카카오가 마커 주변으로 여유를 주므로 실사용에 무리가 없다.
export const PIN_DEFAULT: PinSize = { width: 32, height: 38, anchorX: 16, anchorY: Math.round(38 * PIN_TIP_RATIO) };
export const PIN_SELECTED: PinSize = { width: 42, height: 50, anchorX: 21, anchorY: Math.round(50 * PIN_TIP_RATIO) };
// [축소용] 넓게 볼수록 핀 하나하나가 아니라 '어디에 몰려 있는가'가 궁금해진다. 그런데 같은
// 크기로 두면 핀이 서로 겹쳐 덩어리로 뭉개지고, 정작 밀집도는 더 안 보인다. 한 단계 작게.
export const PIN_COMPACT: PinSize = { width: 24, height: 30, anchorX: 12, anchorY: Math.round(30 * PIN_TIP_RATIO) };

/**
 * 지도 마커용 SVG 문자열. 색을 바꾸는 대신 크기와 흰 테두리로 선택 상태를 알린다 —
 * 선택했다고 색을 바꾸면 그 핀이 어느 그룹인지 알 수 없게 된다.
 *
 * [흰 테두리는 선택 여부와 무관하게 항상 있어야 한다 — 2026-09-10]
 * 기본 상태 테두리가 rgba(0,0,0,.16)로 사실상 안 보이는 수준이었다. 그룹색 세 가지(테라코타·
 * 딥그린·블루)가 실제 카카오맵 타일의 도로·숲·수면 색과 채도·명도대가 겹쳐서, 지도 위에 놓이면
 * 핀이 배경에 섞여 들어갔다. 브랜드 팔레트(채도를 일부러 낮춘 톤)는 그대로 두고, 모든 핀에
 * 얇은 흰 테두리를 둘러 배경이 무슨 색이든 실루엣이 분리되게 한다. 선택 시에는 이 테두리를
 * 두껍게만 키운다 — 그래야 "선택 여부는 두께 차이"라는 원래 설계 의도와 일치한다.
 */
export function pinSvg(opts: { fill: string; ink?: string; iconPath: string; selected?: boolean }): string {
  const ink = opts.ink ?? "#ffffff";
  const rim = opts.selected ? 'stroke="#ffffff" stroke-width="2.6"' : 'stroke="#ffffff" stroke-width="1.6"';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 48">' +
    `<ellipse cx="20" cy="43.4" rx="${opts.selected ? 6 : 5.2}" ry="1.9" fill="rgba(20,24,40,${opts.selected ? ".22" : ".16"})"/>` +
    `<path d="${PIN_BODY}" fill="${opts.fill}" ${rim}/>` +
    '<g transform="translate(11.36 6.96) scale(.72)" fill="none" stroke="' +
    ink +
    '" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">' +
    opts.iconPath +
    "</g></svg>"
  );
}

export function placePinSvg(group: GroupId, sub: SubId | null | undefined, selected = false): string {
  return pinSvg({ fill: GROUP_COLOR[group] ?? GROUP_COLOR.park, iconPath: iconPathFor(group, sub), selected });
}

export function projectPinSvg(): string {
  return pinSvg({ fill: PROJECT_PIN_COLOR, ink: PROJECT_PIN_INK, iconPath: PROJECT_ICON_PATH });
}

export function svgDataUri(svg: string): string {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

/* ────────────────────────── 화면(칩·목록·상세) ────────────────────────── */

/**
 * 지도 밖에서 쓰는 같은 아이콘. 색을 주지 않으면 글자색(currentColor)을 따라가므로
 * 딥블루 바 위의 흰 칩이든 흰 배경의 목록이든 배경에 맞춰 자동으로 읽힌다.
 */
export function CategoryIcon({
  group,
  sub,
  size = 16,
  color,
  className,
}: {
  group: GroupId;
  sub?: SubId | null;
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: iconPathFor(group, sub) }}
    />
  );
}
