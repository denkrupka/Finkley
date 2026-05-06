/* FinSalon Design Tokens — shared across all screens */
const TOKENS = {
  // Colors
  navy: "#1A1A2E",
  navySoft: "#252543",
  navyDeep: "#13132B",
  teal: "#1E6B8A",
  tealSoft: "#E5F0F4",
  tealDeep: "#155571",
  sage: "#2E9E6B",
  sageSoft: "#E5F4ED",
  red: "#C0392B",
  redSoft: "#F8E7E4",
  bg: "#FAFAF8",
  card: "#FFFFFF",
  text: "#1A1A1A",
  textMuted: "#666666",
  textFaint: "#9A9A9A",
  border: "#ECECE7",
  borderStrong: "#DCDCD5",
  yellow: "#FFF9C4",
  yellowDeep: "#F5E26B",
  gold: "#C9A24B",

  // Type
  fontSans: '"Plus Jakarta Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',

  // Radii
  rSm: "6px",
  rMd: "10px",
  rLg: "14px",
  rXl: "20px",

  // Shadows
  shadowSm: "0 1px 2px rgba(20,20,40,0.04), 0 1px 1px rgba(20,20,40,0.03)",
  shadowMd: "0 2px 4px rgba(20,20,40,0.04), 0 6px 18px rgba(20,20,40,0.05)",
  shadowLg: "0 4px 12px rgba(20,20,40,0.06), 0 24px 48px rgba(20,20,40,0.10)",
  shadowXl: "0 12px 24px rgba(20,20,40,0.10), 0 40px 80px rgba(20,20,40,0.18)",
};

// Inject @font-face / @import for Inter, Plus Jakarta Sans, JetBrains Mono
(function injectFonts() {
  if (document.getElementById("finsalon-fonts")) return;
  const link = document.createElement("link");
  link.id = "finsalon-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${TOKENS.fontSans}; color: ${TOKENS.text}; -webkit-font-smoothing: antialiased; }
    .num { font-family: ${TOKENS.fontMono}; font-feature-settings: "tnum" 1, "lnum" 1; letter-spacing: -0.01em; }
    .scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: ${TOKENS.borderStrong}; border-radius: 3px; }
    .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
  `;
  document.head.appendChild(style);
})();

window.TOKENS = TOKENS;
