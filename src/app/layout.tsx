import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import InstallPrompt from "@/components/InstallPrompt";

/*
 * One family, self-hosted via next/font (zero layout shift, no Google
 * round-trip). Manrope is a geometric neo-grotesque whose light weights
 * echo the thin letterforms of the YachtPics wordmark, while its regular
 * weights stay crisp at UI sizes. Exposed as --font-sans for Tailwind.
 */
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "YachtPics Portal",
  description: "Professional photo delivery and slideshow platform for yacht brokers",
  applicationName: "YachtPics Portal",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "YachtPics",
  },
};

export const viewport: Viewport = {
  themeColor: "#050b14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-ink-50 font-sans text-ink-900 antialiased">
        {children}
        <ServiceWorkerRegistration />
        <InstallPrompt />
      </body>
    </html>
  );
}
