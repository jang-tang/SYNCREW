// `qrcode` 의 최소 타입 (QR 행렬만 쓴다, components/QrCode.tsx). 전체 @types/qrcode 는 쓰지 않는 API 가 대부분이라 넣지 않는다.
declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H";
  export type QRCodeData = { modules: { size: number; data: Uint8Array | number[] } };
  export function create(text: string, options?: { errorCorrectionLevel?: QRCodeErrorCorrectionLevel }): QRCodeData;
}
