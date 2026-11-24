import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const vazirmatn = localFont({
  src: [
    { path: "../../public/fonts/Vazirmatn-Light.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-vazirmatn",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PlantVerse | جهان‌گیاه — مرجع جهانی گیاهان",
    template: "%s | PlantVerse جهان‌گیاه",
  },
  description:
    "پلتفرم جامع شناسایی، مراقبت و کشت گیاهان — دانشنامه ۱۲۸۶ گیاه آپارتمانی، دارویی، آبزی، قارچ و کشاورزی با اسکنر هوش مصنوعی، باغ شخصی و جامعه گیاه‌دوستان. The world's living encyclopedia of plants.",
  keywords: [
    "گیاهان آپارتمانی",
    "دانشنامه گیاهان",
    "اسکنر گیاه هوش مصنوعی",
    "مراقبت از گیاه",
    "قارچ دارویی",
    "باغبانی",
    "plant identification",
    "plant care app",
    "PlantVerse",
  ],
  authors: [{ name: "PlantVerse Team" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
  openGraph: {
    title: "PlantVerse | جهان‌گیاه — با طبیعت، خانه‌ای سالم‌تر بسازیم",
    description:
      "شناسایی، مراقبت و کشت گیاهان با علم و عشق. اسکنر هوشمند، دانشنامه جامع، باغ شخصی و جامعه گیاه‌دوستان.",
    siteName: "PlantVerse جهان‌گیاه",
    type: "website",
    locale: "fa_IR",
  },
  twitter: {
    card: "summary_large_image",
    title: "PlantVerse | جهان‌گیاه",
    description: "پلتفرم مرجع جهانی گیاهان — با طبیعت، خانه‌ای سالم‌تر بسازیم.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7F0" },
    { media: "(prefers-color-scheme: dark)", color: "#12211A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className={`${vazirmatn.variable} antialiased bg-background text-foreground font-sans`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "PlantVerse جهان‌گیاه",
              alternateName: "جهان‌گیاه",
              description:
                "پلتفرم جامع شناسایی، مراقبت و کشت گیاهان با هوش مصنوعی",
              inLanguage: ["fa", "en"],
            }),
          }}
        />
      </body>
    </html>
  );
}
