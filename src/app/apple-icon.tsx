import { ImageResponse } from "next/og";

// App Router `apple-icon` file convention: Next serves this as the
// 180x180 apple-touch-icon and auto-injects <link rel="apple-touch-icon">.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Rendered via satori (behind ImageResponse). satori renders inline SVG
// paths and non-latin glyphs unreliably, so the checkmark is drawn with
// pure CSS borders (bottom + right, rotated 45deg) on an emerald field.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#10b981",
        }}
      >
        <div
          style={{
            width: 66,
            height: 108,
            borderColor: "#ffffff",
            borderStyle: "solid",
            borderWidth: "0 18px 18px 0",
            transform: "translateY(-14px) rotate(45deg)",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
