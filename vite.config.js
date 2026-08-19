import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const ENDPOINTS = {
  PILL_IDENTIFICATION:
    "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03",
  DRUG_EFFICACY: "https://apis.data.go.kr/B551182/msupCmpnMcareInfoService/getMsupCmpnMcareInq",
  DUR_INFO: "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03",
  EASY_DRUG_INFO: "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
};

/**
 * 로컬 dev에서도 Netlify Function과 동일한 /api/data-go-proxy 사용
 * (브라우저 CORS 우회 + 서비스키 보호)
 */
function dataGoProxyPlugin(apiKey) {
  return {
    name: "data-go-proxy-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/data-go-proxy")) return next();
        try {
          const url = new URL(req.url, "http://localhost");
          const action = url.searchParams.get("action");
          if (!action || !ENDPOINTS[action]) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing or invalid action" }));
            return;
          }
          if (!apiKey || apiKey === "YOUR_SERVICE_KEY") {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "VITE_API_KEY / DATA_GO_API_KEY is not configured in .env",
              })
            );
            return;
          }

          const params = new URLSearchParams(url.searchParams);
          params.delete("action");
          params.set("serviceKey", apiKey);
          const upstream = `${ENDPOINTS[action]}?${params.toString()}`;
          const upstreamRes = await fetch(upstream);
          const text = await upstreamRes.text();
          res.statusCode = upstreamRes.status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(text);
        } catch (err) {
          console.error("[data-go-proxy-dev]", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Proxy failed" }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.DATA_GO_API_KEY || env.VITE_API_KEY || "";

  return {
    plugins: [react(), dataGoProxyPlugin(apiKey)],
    build: {
      target: "es2018",
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/tesseract.js") || id.includes("tesseract.js-core")) {
              return "ocr";
            }
            if (id.includes("node_modules/lucide-react")) {
              return "icons";
            }
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
              return "react-vendor";
            }
          },
        },
      },
    },
    optimizeDeps: {
      include: ["tesseract.js"],
    },
  };
});
