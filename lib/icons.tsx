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
 * [핀 도형 — 물방울 → 네이비 배지, 2026-09-16]
 * 예전 물방울 핀은 그룹마다 다른 원색(주황·초록·파랑)을 몸통에 그대로 칠했다. 사용해 보니
 * "그냥 지도 서비스에 흔한 카테고리 색"으로 보이고, 이 지도가 채널그린 브랜드(네이비
 * #06107D + 라임 #E1FC48 — 클러스터 뱃지와 프로젝트 핀이 이미 쓰던 조합)라는 게 핀 자체에는
 * 전혀 드러나지 않는다는 피드백을 받았다.
 *
 * 그래서 몸통 색을 그룹마다 바꾸는 대신 전부 브랜드 네이비로 통일하고, 그룹 구분은 테두리+
 * 아이콘 색(PIN_ACCENT_COLOR)만으로 하도록 뒤집었다. 끝에는 항상 라임 점을 찍어 클러스터
 * 뱃지·프로젝트 핀과 "같은 브랜드의 지도 요소"로 묶인다. 모양도 물방울 대신 둥근 사각
 * 배지+꼬리로 바꿔 다른 지도 서비스의 기본 마커와 실루엣 자체가 달라지게 했다.
 *
 * viewBox는 그대로 40×48, 뾰족한 끝(= 지도상 실제 좌표)도 그대로 (20, 41)이라 앵커 계산
 * (PIN_TIP_RATIO, scalePinSize)과 크기 상수는 손댈 필요가 없었다.
 *  - 사각 몸통 x:5~35 y:4~32, 모서리 반지름 8
 *  - 꼬리는 몸통 바닥 x:16~24에서 시작해 (20, 41)로 모인다
 *  - 라임 점은 꼬리 위, (20, 34.5)
 *  - 아이콘은 24 그리드를 0.72배 = 17.3px로 사각 몸통 정중앙 (20, 18)에 놓는다
 *  - 그림자는 SVG 필터 대신 발밑 타원 하나. 마커가 수천 개 떠도 렌더가 무겁지 않다.
 */
const PIN_BADGE_PATH =
  "M13 4H27A8 8 0 0 1 35 12V24A8 8 0 0 1 27 32H24L20 41L16 32H13A8 8 0 0 1 5 24V12A8 8 0 0 1 13 4Z";

// 브랜드 네이비 — 모든 장소 핀의 바탕색. 그룹은 이제 이 색이 아니라 아래 PIN_ACCENT_COLOR로 구분한다.
export const PIN_BASE = "#06107D";

// [핀 전용 액센트] GROUP_COLOR는 칩·목록·상세에서 흰/연한 배경 위 아이콘 선 색으로 쓰여
// 대비 기준이 다르다(흰 배경 위에서 읽혀야 함). 여기는 반대로 어두운 네이비 배지 위에
// 올라가므로 더 밝고 채도 높은 톤이 필요해 별도로 둔다. 색상 계열(주황·초록·파랑)은
// GROUP_COLOR와 맞춰 "이 색 = 이 그룹"이라는 감각이 화면마다 흔들리지 않게 했다.
export const PIN_ACCENT_COLOR: Record<GroupId, string> = {
  company: "#FF8A3D",
  material: "#4ADE80",
  park: "#5EA8FF",
};

export const PIN_TIP_RATIO = 41 / 48; // 뾰족한 끝의 세로 위치 비율 — 마커 앵커 계산에 쓴다

export interface PinSize {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

// [크기] 예전 44×54는 서울 도심에서 핀끼리 겹쳐 뭉치는 주된 원인이라 32×38로 줄였는데,
// 이번엔 반대로 너무 작다는 피드백을 받았다. 44×54로 되돌리면 그 뭉침 문제가 재발할 수 있어
// 절충안으로 세 크기 모두 약 15%씩만 키운다(2026-09-10) — 도심 밀집도는 예전만큼 심하지 않되
// 눈에는 더 잘 띄는 지점을 목표로 했다.
export const PIN_DEFAULT: PinSize = { width: 36, height: 43, anchorX: 18, anchorY: Math.round(43 * PIN_TIP_RATIO) };
export const PIN_SELECTED: PinSize = { width: 48, height: 58, anchorX: 24, anchorY: Math.round(58 * PIN_TIP_RATIO) };
// [축소용] 넓게 볼수록 핀 하나하나가 아니라 '어디에 몰려 있는가'가 궁금해진다. 그런데 같은
// 크기로 두면 핀이 서로 겹쳐 덩어리로 뭉개지고, 정작 밀집도는 더 안 보인다. 한 단계 작게.
export const PIN_COMPACT: PinSize = { width: 28, height: 34, anchorX: 14, anchorY: Math.round(34 * PIN_TIP_RATIO) };
// [크기 세 번째 단계 — 2026-09-16] 기본/축소 두 단계만 있으면 아주 가까이 당겨도(레벨 1~3)
// 핀이 더는 커지지 않아 "이 이상 확대해도 소용없다"는 인상을 준다. 네이버·카카오 자체
// 지도도 줌이 깊어질수록 POI 마커가 계속 커지는 쪽에 가깝다. 가장 가까운 구간에서 한 단계
// 더 키워 확대에 따른 크기 변화가 세 걸음(축소→기본→히어로)으로 이어지게 한다.
export const PIN_HERO: PinSize = { width: 42, height: 50, anchorX: 21, anchorY: Math.round(50 * PIN_TIP_RATIO) };

// [애니메이션용 임시 크기] 팝인·호버 리프트는 실제 상주 크기가 아니라 "지금 크기의 몇 %"로만
// 필요하다. 매번 새 PinSize를 손으로 계산하지 않도록 배율만 받는다. anchorY는 항상 같은
// PIN_TIP_RATIO로 다시 구하므로, 배율이 달라져도 핀의 뾰족한 끝은 원래 좌표에서 벗어나지 않는다.
export function scalePinSize(base: PinSize, factor: number): PinSize {
  const width = Math.max(1, Math.round(base.width * factor));
  const height = Math.max(1, Math.round(base.height * factor));
  return { width, height, anchorX: Math.round(width / 2), anchorY: Math.round(height * PIN_TIP_RATIO) };
}

// 16진 색을 흰색 쪽으로 amount(0~1)만큼 섞는다. 그라디언트의 밝은 쪽 정지색을 만드는 용도.
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * 지도 마커용 SVG 문자열. 몸통(body)은 항상 브랜드색 하나뿐이고, 그룹 구분은 테두리+아이콘
 * 색(accent)만으로 한다 — 선택했다고 accent를 바꾸면 그 핀이 어느 그룹인지 알 수 없게
 * 되므로, 선택 상태는 여전히 크기와 테두리 두께로만 알린다.
 *
 * [몸통에도 아주 옅은 그라디언트] 완전 평면 단색은 배지가 스티커처럼 납작해 보였다. 위(살짝
 * 밝게)→아래(기본 네이비) 그라디언트로 아주 약하게만 입체감을 준다 — 색 자체(주황·초록·파랑
 * 대신 통일한 네이비)를 흐리지 않도록 옅은 물방울 핀 때(0.34)보다 훨씬 적게(0.14) 섞는다.
 * SVG 필터(블러)가 아니라 채우기 정의라 "마커 수천 개에서 필터 비용이 크다"는 제약과 무관하다.
 */
export function pinSvg(opts: {
  body: string;
  accent: string;
  iconPath: string;
  tipDot?: string;
  selected?: boolean;
}): string {
  const rimWidth = opts.selected ? 2.8 : 1.8;
  const dotR = opts.selected ? 2.6 : 2.1;
  const gradId = `gb${opts.body.replace("#", "")}`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 48">' +
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${lighten(opts.body, 0.14)}"/>` +
    `<stop offset="1" stop-color="${opts.body}"/>` +
    "</linearGradient></defs>" +
    `<ellipse cx="20" cy="43.4" rx="${opts.selected ? 6 : 5.2}" ry="1.9" fill="rgba(20,24,40,${opts.selected ? ".22" : ".16"})"/>` +
    `<path d="${PIN_BADGE_PATH}" fill="url(#${gradId})" stroke="${opts.accent}" stroke-width="${rimWidth}"/>` +
    (opts.tipDot ? `<circle cx="20" cy="34.5" r="${dotR}" fill="${opts.tipDot}"/>` : "") +
    '<g transform="translate(11.36 9.36) scale(.72)" fill="none" stroke="' +
    opts.accent +
    '" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">' +
    opts.iconPath +
    "</g></svg>"
  );
}

export function placePinSvg(group: GroupId, sub: SubId | null | undefined, selected = false): string {
  return pinSvg({
    body: PIN_BASE,
    accent: PIN_ACCENT_COLOR[group] ?? PIN_ACCENT_COLOR.park,
    iconPath: iconPathFor(group, sub),
    tipDot: PROJECT_PIN_COLOR, // 라임 — 클러스터 뱃지·프로젝트 핀과 같은 브랜드임을 알린다
    selected,
  });
}

export function projectPinSvg(): string {
  // 프로젝트 핀은 장소 핀과 색을 뒤집는다(라임 바탕 + 네이비 테두리/아이콘/점) — 이미 그렇게
  // 구분해 왔고, 장소 핀이 몸통을 네이비로 바꾼 지금도 "이건 장소가 아니라 게시글"이라는
  // 신호가 여전히 살아 있다.
  return pinSvg({ body: PROJECT_PIN_COLOR, accent: PROJECT_PIN_INK, iconPath: PROJECT_ICON_PATH, tipDot: PROJECT_PIN_INK });
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
