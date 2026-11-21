import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Configuración recomendada por Tauri 2: puerto fijo y sin limpiar la consola,
// para que los errores de Rust sigan visibles.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebKit de macOS (Safari 15+) entiende ES2021 sin problemas.
    target: "safari15",
    sourcemap: false,
  },
});
