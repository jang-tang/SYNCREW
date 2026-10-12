import type { DeviceStatus } from "../shared/api";

/**
 * 접속 상태: 사용자별 실시간 연결 수. 서버 1대 기준 (다중화 시 Redis로 이동).
 * connect/disconnect 는 온라인 여부가 바뀌었을 때만 true 를 돌려준다.
 */
export class PresenceRegistry {
  private readonly connections = new Map<string, number>();

  connect(userId: string): boolean {
    const count = (this.connections.get(userId) ?? 0) + 1;
    this.connections.set(userId, count);
    return count === 1;
  }

  disconnect(userId: string): boolean {
    const count = (this.connections.get(userId) ?? 0) - 1;
    if (count <= 0) {
      this.connections.delete(userId);
      return true;
    }
    this.connections.set(userId, count);
    return false;
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId) ?? 0) > 0;
  }
}

/**
 * 사용자별 마지막 오디오 장치 상태 (헤드셋·마이크 권한). 앱이 device:status 로 알린다.
 * 서버 1대 메모리 기준. 마지막 연결이 끊기면 지운다.
 */
export class DeviceRegistry {
  private readonly devices = new Map<string, DeviceStatus>();

  set(userId: string, device: DeviceStatus): void {
    this.devices.set(userId, device);
  }

  get(userId: string): DeviceStatus | null {
    return this.devices.get(userId) ?? null;
  }

  delete(userId: string): void {
    this.devices.delete(userId);
  }
}
