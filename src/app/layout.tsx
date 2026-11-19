import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import Script from "next/script";

import { GoogleAnalyticsPageViews } from "@/components/google-analytics";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "ÉLANO — Premium fashion",
  description: "Luxury fashion storefront landing page with editorial styling and elevated ecommerce layouts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const measurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f3efe8] text-[#171717]">
        {measurementId ? (
          <>
            <Script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || []; window.gtag = function(){window.dataLayer.push(arguments);}; window.gtag('js', new Date()); window.gtag('config', ${JSON.stringify(measurementId)}, { send_page_view: false });`}
            </Script>
            <GoogleAnalyticsPageViews />
          </>
        ) : null}
        {children}
      </body>
    </html>
  );
}
