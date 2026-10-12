import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 서버 로컬 디스크 저장소 (docs/database-design.md: 음성 파일은 서버 로컬 디스크).
 * DB에는 루트 기준 상대 경로만 저장한다.
 *   uploads/<messageId>.<ext>   발신자가 올린 원본 음성 (재시도 시 다시 인식)
 *   audio/<messageId>/<lang>.wav 번역 음성
 */
export class FileStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** 상대 경로를 절대 경로로. 저장소 밖을 가리키면 거부한다. */
  resolve(relative: string): string {
    const absolute = path.resolve(this.root, relative);
    if (!absolute.startsWith(this.root + path.sep)) throw new Error(`저장소 밖 경로: ${relative}`);
    return absolute;
  }

  private async write(relative: string, data: Buffer): Promise<string> {
    const absolute = this.resolve(relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    return relative;
  }

  saveUpload(messageId: string, data: Buffer, extension: string): Promise<string> {
    return this.write(path.join("uploads", `${messageId}.${extension}`), data);
  }

  saveTranslationAudio(messageId: string, lang: string, wav: Buffer): Promise<string> {
    return this.write(path.join("audio", messageId, `${lang}.wav`), wav);
  }

  read(relative: string): Promise<Buffer> {
    return readFile(this.resolve(relative));
  }

  async remove(relative: string): Promise<void> {
    await rm(this.resolve(relative), { force: true });
  }
}
