"use client";

import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";

import { getFirebaseServices } from "./client";

let appCheck: AppCheck | undefined;

export function getFirebaseAppCheck(): AppCheck {
  if (typeof window === "undefined") {
    throw new Error("Firebase App Check can only be initialized in the browser.");
  }

  if (appCheck) {
    return appCheck;
  }

  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
  if (
    !siteKey ||
    siteKey.includes("YOUR_RECAPTCHA_SITE_KEY") ||
    siteKey.includes("=")
  ) {
    throw new Error(
      "Set NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY to the reCAPTCHA v3 site key only (not the variable assignment or placeholder) from Firebase App Check.",
    );
  }

  appCheck = initializeAppCheck(getFirebaseServices().app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });

  return appCheck;
}
