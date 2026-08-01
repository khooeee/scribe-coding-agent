import type { VoiceFunApi } from "./types";

declare global {
  interface Window {
    voiceFun: VoiceFunApi;
  }
}

export {};
