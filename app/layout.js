import "./globals.css";

export const metadata = {
  title: "ML Compass",
  description: "An opinionated ML project advisor — rules decide, the model only explains.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
