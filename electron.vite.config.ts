import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src",
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/index.html"),
        },
      },
    },
    plugins: [react()],
  },
});
