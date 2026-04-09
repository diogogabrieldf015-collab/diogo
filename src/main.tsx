import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initMetaPixel } from "@/lib/meta-pixel";
import "./index.css";

initMetaPixel();
createRoot(document.getElementById("root")!).render(<App />);
