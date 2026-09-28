import type { Metadata, Viewport } from 'next'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0a121b' },
  ],
}

export const metadata: Metadata = {
  title: 'Viste High School Management System',
  description: 'School operations console for academics, attendance, fees, and staff.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icon.png', type: 'image/png' },
    ],
    apple: [{ url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.png',
  },
  applicationName: 'Viste SMS',
  appleWebApp: { capable: true, title: 'Viste SMS', statusBarStyle: 'default' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  var KEY = 'viste.chunk-reload';
  function shouldReload(msg) {
    return typeof msg === 'string' && (
      msg.indexOf('ChunkLoadError') !== -1 ||
      msg.indexOf('Loading chunk') !== -1 ||
      msg.indexOf('Failed to fetch dynamically imported module') !== -1 ||
      msg.indexOf('error loading dynamically imported module') !== -1 ||
      msg.indexOf('Loading CSS chunk') !== -1
    );
  }
  function isNextChunkUrl(url) {
    return typeof url === 'string' && url.indexOf('/_next/static/') !== -1;
  }
  function reloadOnce() {
    try {
      var n = Number(sessionStorage.getItem(KEY) || '0');
      if (n >= 3) return;
      sessionStorage.setItem(KEY, String(n + 1));
    } catch (e) {}
    try {
      // Drop query/hash so we do not keep a stuck _r loop; force a full document load.
      var path = window.location.pathname || '/';
      window.location.replace(path + '?_r=' + Date.now());
    } catch (e) {
      window.location.reload();
    }
  }
  window.addEventListener('error', function (ev) {
    var t = ev && ev.target;
    if (t && t.tagName === 'SCRIPT' && isNextChunkUrl(t.src)) {
      reloadOnce();
      return;
    }
    if (t && t.tagName === 'LINK' && isNextChunkUrl(t.href)) {
      reloadOnce();
      return;
    }
    if (shouldReload((ev && ev.message) || '')) reloadOnce();
  }, true);
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    var msg = r && (r.message || String(r));
    if (shouldReload(msg || '')) reloadOnce();
  });
})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
