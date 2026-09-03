// [공유하기] 길찾기(kakaoDirLink)와 달리 "위치만 보기" 링크. 카카오맵 앱/웹 어디서
// 열어도 별도 로그인이나 앱 설치 없이 바로 위치가 뜨기 때문에, 공유 대상(수신자)에게
// 보낼 링크로는 길찾기 링크보다 이쪽이 더 적합하다.
export function kakaoPlaceLink(name: string, lat: number, lng: number): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
}
