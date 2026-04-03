import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/seo";

export const alt = "Xport | Export Twitter and X Posts";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background:
          "linear-gradient(130deg, rgb(12, 18, 28) 0%, rgb(30, 48, 70) 45%, rgb(8, 127, 140) 100%)",
        color: "white",
        padding: "64px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        {SITE_NAME}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxWidth: 960,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 68,
            lineHeight: 1.1,
            fontWeight: 800,
            letterSpacing: -2,
          }}
        >
          Export Twitter and X Posts
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            lineHeight: 1.3,
            opacity: 0.9,
          }}
        >
          Unroll threads and save articles in seconds
        </div>
      </div>
    </div>,
    size,
  );
}
