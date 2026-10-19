// [프로젝트 아카이브 노출 스위치 — 2026-10-19 대표 지시]
// 프로젝트 아카이브(projects.magazinegreen.co.kr)가 아직 공개 단계가 아니라, 이 지도에서 아카이브로 이어지는
// 진입점(지도 위 프로젝트 핀 레이어와 그 핀에서 열리는 「프로젝트 보기」)을 끈다. 삭제가 아니라 보관이다 —
// 공개할 때 빌드 환경변수 NEXT_PUBLIC_SHOW_PROJECTS=on 만 주면 이전과 똑같이 되살아난다.
// (아카이브의 「지도에서 보기」로 이 지도에 ?lat&lng 로 들어오는 길은 그대로 둔다: 밖으로 노출되는 길이 아니다.)
export const SHOW_PROJECTS = process.env.NEXT_PUBLIC_SHOW_PROJECTS === "on";
