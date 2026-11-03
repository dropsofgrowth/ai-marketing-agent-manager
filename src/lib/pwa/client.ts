"use client";

/**
 * Browser-side PWA state: service-worker registration and the install prompt.
 * Kept in a tiny external store so any component can read it with
 * useSyncExternalStore (and get a stable "unknown" snapshot on the server).
 */

type InstallOutcome = "accepted" | "dismissed";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
};

export type InstallState =
  /** Server render / not yet known. */
  | "unknown"
  /** Running as an installed app (standalone display mode). */
  | "installed"
  /** The user just accepted the browser's install prompt. */
  | "accepted"
  /** Chromium offered an install prompt we can show from a button. */
  | "promptable"
  /** iPhone / iPad: install via Share → Add to Home Screen. */
  | "ios"
  /** Page isn't served over HTTPS (or localhost): browsers won't install it. */
  | "insecure"
  /** Some other browser: point to its own install menu. */
  | "generic";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let accepted = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

// Listen as soon as this module loads: `beforeinstallprompt` can fire before React hydrates.
// No preventDefault(), so browsers keep their own install UI (e.g. Chrome's mini-infobar);
// the saved event additionally powers the Install button in Settings.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    accepted = true;
    emit();
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function getInstallState(): InstallState {
  if (isStandalone()) return "installed";
  if (accepted) return "accepted";
  if (deferredPrompt) return "promptable";
  if (!window.isSecureContext) return "insecure";
  if (isIos()) return "ios";
  return "generic";
}

export const getServerInstallState = (): InstallState => "unknown";

export function subscribeInstallState(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

/** Shows the browser's install dialog (Chromium only). */
export async function promptInstall(): Promise<InstallOutcome | null> {
  const event = deferredPrompt;
  if (!event) return null;
  deferredPrompt = null; // a prompt event can be used once
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") accepted = true;
    return outcome;
  } catch {
    return null;
  } finally {
    emit();
  }
}

/**
 * Registers /sw.js in production builds on secure origins. In development a
 * service worker would only get in the way of hot reloading.
 */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production") return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
    console.warn("[pwa] service worker registration failed", error);
  });
}
