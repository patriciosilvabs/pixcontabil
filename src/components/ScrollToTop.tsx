import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.body.scrollTo({ top: 0, left: 0, behavior: "auto" });

      const scrollContainer = document.querySelector<HTMLElement>(
        '[data-scroll-container="app"]'
      );

      scrollContainer?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });

    return () => cancelAnimationFrame(frame);
  }, [pathname, search]);

  return null;
}
