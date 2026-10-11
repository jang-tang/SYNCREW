import * as Crypto from "expo-crypto";

/** 메시지 중복 전송 방지용 clientMessageId 등 */
export const newId = (): string => Crypto.randomUUID();
