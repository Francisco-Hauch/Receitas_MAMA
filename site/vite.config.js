import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // O site lê os JSONs de ../data, que fica FORA da pasta site/. Por padrão o
  // Vite proíbe ler acima da raiz do projeto (proteção contra servir arquivo
  // que não devia); aqui a permissão é intencional.
  server: { fs: { allow: [".."] } },
  // caminhos relativos no build: assim o site funciona em qualquer subpasta
  base: "./",
});
