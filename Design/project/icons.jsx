/* FinSalon Iconography — minimal stroke set */
const Icon = ({ name, size = 18, color = "currentColor", strokeWidth = 1.7, style }) => {
  const s = size;
  const sw = strokeWidth;
  const common = {
    width: s,
    height: s,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5v-5h4v5" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.2" />
          <path d="M3.5 19c.7-3 3-4.6 5.5-4.6S14.3 16 15 19" />
          <circle cx="16.5" cy="8" r="2.4" />
          <path d="M16 14c2 0 3.7 1.2 4.5 3.2" />
        </svg>
      );
    case "expense":
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="M3.5 10h17" />
          <path d="M7 14.5h3M14 14.5h3" />
        </svg>
      );
    case "master":
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" />
        </svg>
      );
    case "report":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "robot":
      return (
        <svg {...common}>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <circle cx="9" cy="13" r="1.2" fill={color} stroke="none" />
          <circle cx="15" cy="13" r="1.2" fill={color} stroke="none" />
          <path d="M12 7V4M9.5 4h5" />
          <path d="M4 13H2M22 13h-2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "trend-up":
      return (
        <svg {...common}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </svg>
      );
    case "trend-down":
      return (
        <svg {...common}>
          <path d="M3 7l6 6 4-4 8 8" />
          <path d="M14 17h7v-7" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M4 20h4l11-11-4-4L4 16z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </svg>
      );
    case "rent":
      return (
        <svg {...common}>
          <path d="M4 11l8-7 8 7v9H4z" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "salary":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v10M14.5 9H10.5a1.8 1.8 0 0 0 0 3.6h3a1.8 1.8 0 0 1 0 3.6H9.5" />
        </svg>
      );
    case "materials":
      return (
        <svg {...common}>
          <path d="M5 7l7-3 7 3v10l-7 3-7-3z" />
          <path d="M5 7l7 3 7-3M12 10v10" />
        </svg>
      );
    case "ads":
      return (
        <svg {...common}>
          <path d="M4 9v6l11 5V4z" />
          <path d="M15 8a4 4 0 0 1 0 8" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M4 12l16-8-5 16-3-7z" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18M7 15h3" />
        </svg>
      );
    case "cash":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 9.5v5M18 9.5v5" />
        </svg>
      );
    case "transfer":
      return (
        <svg {...common}>
          <path d="M4 8h13l-3-3M20 16H7l3 3" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M12 3.5L21 19H3z" />
          <path d="M12 10v4M12 17v.01" />
        </svg>
      );
    default:
      return null;
  }
};

window.Icon = Icon;
