import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      experimental: { tasks: true },
      tasks: {
        "billing-delivery": {
          handler: fileURLToPath(new URL("./tasks/billing-delivery.ts", import.meta.url)),
        },
      },
      scheduledTasks: { "* * * * *": ["billing-delivery"] },
    }),
    viteReact(),
  ],
});
