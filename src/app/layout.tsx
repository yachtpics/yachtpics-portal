import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import InstallPrompt from "@/components/InstallPrompt";

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
  themeColor: "#0b1f33",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
        <ServiceWorkerRegistration />
        <InstallPrompt />
      </body>
    </html>
  );
}
