import "./globals.css";
import AuthBootstrap from "@/components/AuthBootstrap";
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";

export const metadata = {
  title: "KGS PURCHASING",
  description: "Sign in to your account",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/kelin-logo.png" type="image/png" />
      </head>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  var supportDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches === true;
                  if (theme === 'dark' || (!theme && supportDarkMode)) {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    document.documentElement.style.backgroundColor = '#020617';
                  } else {
                    document.documentElement.style.backgroundColor = '#f8fafc';
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <ThemeProvider>
          <AuthBootstrap />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
