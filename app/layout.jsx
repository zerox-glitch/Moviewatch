import "./globals.css";

export const metadata = {
  title: "Moviewatch — synced movie nights",
  description:
    "Create a room, upload a movie, share the link, and watch together in perfect sync — no matter the distance.",
};

export const viewport = {
  themeColor: "#07080f",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-night-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
