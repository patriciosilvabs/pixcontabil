import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { APP_VERSION, BUILD_DATE } from "./constants/app";

console.log(`[PixContábil] ${APP_VERSION} | Build: ${BUILD_DATE}`);

createRoot(document.getElementById("root")!).render(<App />);
