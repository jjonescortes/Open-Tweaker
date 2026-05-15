import { Geist_Mono, Figtree } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils";

const figtree = Figtree({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata = {
  title: "OpenTweaker",
  description: "Live visual editor for React apps",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("dark antialiased", fontMono.variable, figtree.variable)}
    >
      <head>
        {/* Font Awesome 6 Free — swap for a Pro kit URL if you have one */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-sans bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
