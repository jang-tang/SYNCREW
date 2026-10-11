import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// SecureStore는 값 하나에 약 2KB 제한이 있어, 긴 값(Supabase 세션)은 나눠 저장한다.
const CHUNK_SIZE = 1800;

const web = {
  get: (key: string) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
  set: (key: string, value: string) => localStorage?.setItem(key, value),
  remove: (key: string) => localStorage?.removeItem(key),
};

const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return web.get(key);
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (count === null) return SecureStore.getItemAsync(k);
    const parts: string[] = [];
    for (let index = 0; index < Number(count); index += 1) {
      parts.push((await SecureStore.getItemAsync(`${k}__${index}`)) ?? "");
    }
    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return web.set(key, value);
    const k = safeKey(key);
    await this.removeItem(key);
    if (value.length <= CHUNK_SIZE) return SecureStore.setItemAsync(k, value);
    const chunks = Math.ceil(value.length / CHUNK_SIZE);
    for (let index = 0; index < chunks; index += 1) {
      await SecureStore.setItemAsync(`${k}__${index}`, value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(`${k}__n`, String(chunks));
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") return web.remove(key);
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (count !== null) {
      for (let index = 0; index < Number(count); index += 1) await SecureStore.deleteItemAsync(`${k}__${index}`);
      await SecureStore.deleteItemAsync(`${k}__n`);
    }
    await SecureStore.deleteItemAsync(k);
  },
};
