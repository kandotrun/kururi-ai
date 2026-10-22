import { defineConfig, mergeConfig, type UserConfig } from "vite";
import base from "../vite.config";

export default defineConfig((environment) => {
  const shared: UserConfig =
    typeof base === "function" ? base(environment) : base;
  return mergeConfig(shared, {
    root: new URL("..", import.meta.url).pathname,
    server: {
      host: "127.0.0.1",
      port: 5191,
      strictPort: true,
      hmr: false,
      watch: { ignored: ["**/*"] },
    },
  });
});
