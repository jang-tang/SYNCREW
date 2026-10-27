import { router, type Href } from "expo-router";

// 저절로 열리는 화면(실시간 지시 수신·연결)이 반복돼도 화면이 쌓이지 않게 (2026-10-27 사용자: 여러 번 받으면 뒤로 가기를 계속 눌러야 했다).
// 항상 연결 탭(현장 첫 화면) 위에 하나만 연다 → 뒤로 가기(Android 뒤로 버튼 포함)는 연결 탭으로 돌아간다.

/** 쌓인 화면을 모두 닫고 연결 탭으로 */
export function goHome() {
  if (router.canDismiss()) router.dismissAll();
  router.navigate("/site");
}

/** 연결 탭 위에 이 화면 하나만 연다 */
export function openOverHome(href: Href) {
  goHome();
  router.push(href);
}
