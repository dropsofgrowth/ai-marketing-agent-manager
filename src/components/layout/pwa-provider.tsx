"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/pwa/client";

/** Mounted once in the root layout: registers the service worker after load. */
export function PwaProvider() {
  useEffect(() => {
    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }
    window.addEventListener("load", registerServiceWorker, { once: true });
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);
  return null;
}
