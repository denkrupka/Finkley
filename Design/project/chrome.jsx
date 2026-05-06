/* FinSalon — Shared Chrome (Sidebar + TopBar + FAB) */
const T = window.TOKENS;
const Icon = window.Icon;

const NAV_ITEMS = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "visits", label: "Визиты", icon: "calendar" },
  { id: "clients", label: "Клиенты", icon: "users" },
  { id: "expenses", label: "Расходы", icon: "expense" },
  { id: "masters", label: "Мастера", icon: "master" },
  { id: "reports", label: "Отчёты", icon: "report" },
  { id: "ai", label: "AI-помощник", icon: "robot" },
  { id: "settings", label: "Настройки", icon: "settings" },
];

const Sidebar = ({ active = "home", onNav }) => (
  <aside
    style={{
      width: 232,
      flexShrink: 0,
      background: T.card,
      borderRight: `1px solid ${T.border}`,
      display: "flex",
      flexDirection: "column",
      padding: "20px 14px 18px",
      height: "100%",
    }}
  >
    {/* Logo */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 22px" }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: T.navy,
          display: "grid",
          placeItems: "center",
          color: "white",
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: "-0.02em",
        }}
      >
        F
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em", color: T.navy }}>
        FinSalon
      </div>
    </div>

    {/* Nav */}
    <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onNav?.(item.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 11px",
              borderRadius: 9,
              border: "none",
              background: isActive ? T.navy : "transparent",
              color: isActive ? "white" : T.text,
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = T.bg;
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon name={item.icon} size={18} color={isActive ? "white" : T.textMuted} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>

    {/* Bottom: subscription + avatar */}
    <div
      style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 12,
        background: "linear-gradient(135deg, #FFFCEB 0%, #FFF4D1 100%)",
        border: `1px solid ${T.yellowDeep}55`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `linear-gradient(135deg, ${T.gold} 0%, #E5C078 100%)`,
            display: "grid",
            placeItems: "center",
            color: "white",
            fontWeight: 800,
            fontSize: 11,
          }}
        >
          ★
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.navy }}>Pro план</div>
          <div style={{ fontSize: 10.5, color: T.textMuted }}>до 12 мая</div>
        </div>
      </div>
    </div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 12,
        padding: "8px 6px",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#E8C4B8,#D4A599)",
          display: "grid",
          placeItems: "center",
          color: T.navy,
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        ОК
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Оля Кравец</div>
        <div style={{ fontSize: 11, color: T.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Salon Vivienne · Warsaw
        </div>
      </div>
    </div>
  </aside>
);

const PeriodToggle = ({ value = "month", onChange }) => {
  const opts = [
    { id: "day", label: "День" },
    { id: "week", label: "Неделя" },
    { id: "month", label: "Месяц" },
    { id: "custom", label: "Период", caret: true },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        padding: 3,
      }}
    >
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange?.(o.id)}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              background: active ? T.navy : "transparent",
              color: active ? "white" : T.textMuted,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              transition: "all 0.15s",
            }}
          >
            {o.label}
            {o.caret && <Icon name="chevron-down" size={13} color={active ? "white" : T.textMuted} />}
          </button>
        );
      })}
    </div>
  );
};

const TopBar = ({ salonName = "Salon Vivienne", date = "Понедельник, 6 мая", period, onPeriod }) => (
  <header
    style={{
      height: 64,
      padding: "0 28px",
      borderBottom: `1px solid ${T.border}`,
      background: T.card,
      display: "flex",
      alignItems: "center",
      gap: 24,
      flexShrink: 0,
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.navy, letterSpacing: "-0.01em" }}>
        {salonName}
      </div>
      <div style={{ fontSize: 12, color: T.textMuted }}>{date}</div>
    </div>
    <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
      <PeriodToggle value={period} onChange={onPeriod} />
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <button
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          border: `1px solid ${T.border}`,
          background: T.card,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <Icon name="bell" size={17} color={T.text} />
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 9,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: T.red,
            border: `1.5px solid ${T.card}`,
          }}
        />
      </button>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#E8C4B8,#D4A599)",
          display: "grid",
          placeItems: "center",
          color: T.navy,
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        ОК
      </div>
    </div>
  </header>
);

const FAB = ({ onClick, label = "Визит" }) => (
  <button
    onClick={onClick}
    style={{
      position: "absolute",
      right: 28,
      bottom: 28,
      height: 56,
      padding: "0 22px 0 18px",
      borderRadius: 999,
      background: T.navy,
      color: "white",
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 15,
      fontWeight: 600,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      boxShadow: "0 6px 14px rgba(26,26,46,0.28), 0 18px 32px rgba(26,26,46,0.20)",
      zIndex: 10,
    }}
  >
    <Icon name="plus" size={20} color="white" strokeWidth={2.4} />
    <span>{label}</span>
  </button>
);

window.Sidebar = Sidebar;
window.TopBar = TopBar;
window.PeriodToggle = PeriodToggle;
window.FAB = FAB;
