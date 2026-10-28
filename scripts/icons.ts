import { copyFileSync, readFileSync } from "node:fs";
import sharp from "sharp";

// Renders the app icons in public/ from the wrench mark in assets/favicon/favicon.svg.
// Run with `npm run icons` after changing it.
const source = readFileSync("assets/favicon/favicon.svg", "utf8");
// iPhone and Android round the corners themselves, so those icons fill the whole square.
const fullBleed = source.replace(/rx="7"/, 'rx="0"');
// Maskable icons may be cropped to a circle: shrink the wrench into the middle 80%.
const maskable = fullBleed.replace(
  /<g transform="rotate\(45 16 16\)">/,
  '<g transform="translate(16 16) scale(0.8) translate(-16 -16) rotate(45 16 16)">',
);

const render = (svg: string, size: number, file: string) =>
  sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png().toFile(`public/${file}`);

copyFileSync("assets/favicon/favicon.svg", "public/icon.svg");
copyFileSync("assets/favicon/favicon.ico", "public/favicon.ico");
await Promise.all([
  render(fullBleed, 180, "apple-touch-icon.png"),
  render(fullBleed, 192, "icon-192.png"),
  render(fullBleed, 512, "icon-512.png"),
  render(maskable, 512, "icon-maskable-512.png"),
]);
console.log("Icons written to public/.");
