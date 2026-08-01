import type { ScribeApi } from "./types";

declare global {
  interface Window {
    scribeApi: ScribeApi;
  }
}

export {};
