"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { trackStoreEvent } from "@/lib/analytics";

export function GoogleAnalyticsPageViews() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    trackStoreEvent("page_view", {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  return null;
}
