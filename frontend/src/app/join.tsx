import { Redirect, useLocalSearchParams } from "expo-router";

/** 딥링크 syncrew://join?code=XXXX → 현장 참여 화면 */
export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: "/sites/join", params: code ? { code } : {} }} />;
}
