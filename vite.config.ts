import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
function publicSiteUrl(env: Record<string, string>): string {
  const fromEnv = (env.VITE_SITE_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  // Build na Vercel: domínio real do deploy (evita og:image apontando para outro host).
  const vercel = (process.env.VERCEL_URL || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (vercel) return `https://${vercel}`;
  return "https://famaprovider.vercel.app";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl = publicSiteUrl(env);
  const ogImage = `${siteUrl}/og-share.png`;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      {
        name: "html-og-url",
        transformIndexHtml(html) {
          return html.replaceAll("%OG_IMAGE%", ogImage).replaceAll("%OG_URL%", `${siteUrl}/`);
        },
      },
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
