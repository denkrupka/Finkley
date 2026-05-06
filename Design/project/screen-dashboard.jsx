/* FinSalon — Dashboard */
const T_d = window.TOKENS;
const Icon_d = window.Icon;

// Money formatter
const fmt = (n) => {
  const s = Math.round(Math.abs(n)).toLocaleString("ru-RU").replace(/,/g, " ");
  return s;
};

const Card = ({ children, style, padding = 22 }) => (
  <div
    style={{
      background: T_d.card,
      borderRadius: 14,
      border: `1px solid ${T_d.border}`,
      boxShadow: T_d.shadowSm,
      padding,
      ...style,
    }}
  >
    {children}
  </div>
);

const SectionTitle = ({ children, action }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: 14,
    }}
  >
    <h3 style={{ fontSize: 15, fontWeight: 700, color: T_d.navy, margin: 0, letterSpacing: "-0.01em" }}>
      {children}
    </h3>
    {action}
  </div>
);

// KPI Cards
const KPICard = ({ label, value, sublabel, trend, variant = "default" }) => {
  const isProfit = variant === "profit";
  const isNeg = variant === "expense";
  const isPos = variant === "revenue";
  const valueColor = isProfit ? "white" : isNeg ? T_d.red : isPos ? T_d.sage : T_d.text;
  return (
    <div
      style={{
        background: isProfit ? T_d.navy : T_d.card,
        borderRadius: 16,
        border: isProfit ? "none" : `1px solid ${T_d.border}`,
        boxShadow: isProfit ? T_d.shadowLg : T_d.shadowSm,
        padding: isProfit ? "26px 28px" : "22px 24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {isProfit && (
        <div
          style={{
            position: "absolute",
            top: -40,
            right: -40,
            width: 160,
            height: 160,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(46,158,107,0.18) 0%, transparent 70%)",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: isProfit ? "0.08em" : "0.02em",
          textTransform: isProfit ? "uppercase" : "none",
          color: isProfit ? "rgba(255,255,255,0.65)" : T_d.textMuted,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          marginBottom: 10,
        }}
      >
        <span
          className="num"
          style={{
            fontSize: isProfit ? 48 : 38,
            fontWeight: 700,
            color: valueColor,
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {isNeg ? "–" : ""}€{fmt(value)}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 13, color: isProfit ? "rgba(255,255,255,0.7)" : T_d.textMuted }}>
          {sublabel}
        </span>
        {trend && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "3px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              background: isProfit ? "rgba(46,158,107,0.22)" : T_d.sageSoft,
              color: isProfit ? "#7ED9A8" : T_d.sage,
            }}
          >
            <Icon_d name="trend-up" size={11} color={isProfit ? "#7ED9A8" : T_d.sage} strokeWidth={2.5} />
            {trend}
          </span>
        )}
      </div>
    </div>
  );
};

// Master bar chart
const MasterBars = () => {
  const data = [
    { name: "Аня", value: 1240, services: "Маникюр, педикюр" },
    { name: "Катя", value: 980, services: "Брови, ресницы" },
    { name: "Марина", value: 420, services: "Окрашивание" },
    { name: "Оля", value: 200, services: "Стрижки" },
  ];
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.map((m, i) => {
        const pct = (m.value / max) * 100;
        return (
          <div key={m.name}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: ["#F4D7C5","#D7E4C5","#C5DAE4","#E4C5DC"][i],
                    display: "grid",
                    placeItems: "center",
                    color: T_d.navy,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {m.name[0]}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T_d.text }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: T_d.textFaint }}>{m.services}</div>
                </div>
              </div>
              <span className="num" style={{ fontSize: 15, fontWeight: 700, color: T_d.navy }}>
                €{fmt(m.value)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: T_d.bg,
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${T_d.teal} 0%, ${T_d.tealDeep} 100%)`,
                  borderRadius: 999,
                  transition: "width 0.6s ease",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Donut chart for payment types
const PaymentDonut = () => {
  const data = [
    { name: "Наличные", value: 42, color: T_d.navy },
    { name: "Карта", value: 38, color: T_d.teal },
    { name: "Перевод", value: 20, color: T_d.sage },
  ];
  const total = 2840;
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <svg width="180" height="180" viewBox="0 0 180 180" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="90" cy="90" r={R} fill="none" stroke={T_d.bg} strokeWidth="20" />
        {data.map((d) => {
          const len = (d.value / 100) * C;
          const dash = `${len} ${C - len}`;
          const seg = (
            <circle
              key={d.name}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={d.color}
              strokeWidth="20"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          textAlign: "center",
          marginTop: 50,
          pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 11, color: T_d.textMuted, fontWeight: 600 }}>Всего</div>
        <div className="num" style={{ fontSize: 22, fontWeight: 700, color: T_d.navy, letterSpacing: "-0.02em" }}>
          €{fmt(total)}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {data.map((d) => (
          <div
            key={d.name}
            style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: d.color,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, color: T_d.text }}>{d.name}</span>
            <span className="num" style={{ fontWeight: 700, color: T_d.navy }}>
              {d.value}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Top services
const TOP_SERVICES = [
  { name: "Маникюр гель", revenue: 920, visits: 23, margin: "high", marginPct: 52 },
  { name: "Окрашивание", revenue: 720, visits: 8, margin: "low", marginPct: 31 },
  { name: "Ламинирование бровей", revenue: 540, visits: 12, margin: "high", marginPct: 68 },
  { name: "Педикюр", revenue: 380, visits: 9, margin: "med", marginPct: 44 },
  { name: "Стрижка + укладка", revenue: 280, visits: 7, margin: "med", marginPct: 41 },
];

const ServiceCard = ({ s }) => {
  const dotColor = s.margin === "high" ? T_d.sage : s.margin === "low" ? T_d.red : T_d.gold;
  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        background: T_d.card,
        border: `1px solid ${T_d.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = T_d.teal;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T_d.border;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: T_d.textMuted,
          fontWeight: 600,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor }} />
        Маржа {s.marginPct}%
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T_d.text, lineHeight: 1.25 }}>
        {s.name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 700, color: T_d.navy, letterSpacing: "-0.02em" }}>
          €{fmt(s.revenue)}
        </span>
        <span style={{ fontSize: 11, color: T_d.textFaint }}>{s.visits} визитов</span>
      </div>
    </div>
  );
};

// Recent visits table
const RECENT = [
  { date: "06.05", master: "Аня", service: "Маникюр гель", amount: 40, pay: "Карта" },
  { date: "06.05", master: "Катя", service: "Ламинирование бровей", amount: 45, pay: "Наличные" },
  { date: "05.05", master: "Аня", service: "Педикюр", amount: 50, pay: "Карта" },
  { date: "05.05", master: "Марина", service: "Окрашивание корней", amount: 90, pay: "Перевод" },
  { date: "05.05", master: "Оля", service: "Стрижка + укладка", amount: 35, pay: "Наличные" },
];

const PayPill = ({ type }) => {
  const map = {
    "Наличные": { bg: "#EFEEF5", fg: T_d.navy, icon: "cash" },
    "Карта": { bg: T_d.tealSoft, fg: T_d.tealDeep, icon: "card" },
    "Перевод": { bg: T_d.sageSoft, fg: T_d.sage, icon: "transfer" },
  };
  const c = map[type];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 9px 3px 7px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <Icon_d name={c.icon} size={11} color={c.fg} strokeWidth={2} />
      {type}
    </span>
  );
};

const RecentTable = () => (
  <div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "70px 1fr 1.6fr 110px 130px",
        padding: "0 14px 8px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 700,
        color: T_d.textFaint,
      }}
    >
      <div>Дата</div>
      <div>Мастер</div>
      <div>Услуга</div>
      <div style={{ textAlign: "right" }}>Сумма</div>
      <div>Оплата</div>
    </div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      {RECENT.map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "70px 1fr 1.6fr 110px 130px",
            padding: "12px 14px",
            alignItems: "center",
            borderTop: `1px solid ${T_d.border}`,
            fontSize: 13,
          }}
        >
          <div className="num" style={{ color: T_d.textMuted }}>{r.date}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: ["#F4D7C5","#D7E4C5","#C5DAE4","#E4C5DC"][["Аня","Катя","Марина","Оля"].indexOf(r.master)],
                display: "grid",
                placeItems: "center",
                color: T_d.navy,
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {r.master[0]}
            </span>
            <span style={{ color: T_d.text, fontWeight: 500 }}>{r.master}</span>
          </div>
          <div style={{ color: T_d.text }}>{r.service}</div>
          <div className="num" style={{ textAlign: "right", fontWeight: 700, color: T_d.sage }}>
            +€{r.amount}
          </div>
          <div><PayPill type={r.pay} /></div>
        </div>
      ))}
    </div>
  </div>
);

const Dashboard = ({ period, onPeriod, onAddVisit, onNav }) => (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T_d.bg }}>
    <window.TopBar period={period} onPeriod={onPeriod} />
    <main
      className="scrollbar-thin"
      style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }}
    >
      {/* Page heading */}
      <div style={{ marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: T_d.navy, margin: 0, letterSpacing: "-0.02em" }}>
            Привет, Оля 👋
          </h1>
          <div style={{ fontSize: 14, color: T_d.textMuted, marginTop: 4 }}>
            Вот как идут дела в этом месяце.
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.35fr", gap: 18, marginBottom: 22 }}>
        <KPICard label="Выручка" value={2840} sublabel="этот месяц" variant="revenue" />
        <KPICard label="Расходы" value={1205} sublabel="этот месяц" variant="expense" />
        <KPICard label="Прибыль" value={1635} sublabel="чистыми в кармане" variant="profit" trend="+12% к апрелю" />
      </div>

      {/* Second row: bars + donut */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18, marginBottom: 22 }}>
        <Card>
          <SectionTitle action={
            <span style={{ fontSize: 12, color: T_d.textMuted }}>4 мастера активны</span>
          }>Выручка по мастерам</SectionTitle>
          <MasterBars />
        </Card>
        <Card>
          <SectionTitle>Тип оплаты</SectionTitle>
          <PaymentDonut />
        </Card>
      </div>

      {/* Top services */}
      <div style={{ marginBottom: 22 }}>
        <Card padding={22}>
          <SectionTitle action={
            <a style={{ fontSize: 13, color: T_d.teal, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
              Все услуги <Icon_d name="arrow-right" size={13} color={T_d.teal} />
            </a>
          }>Топ услуг месяца</SectionTitle>
          <div style={{ display: "flex", gap: 12 }}>
            {TOP_SERVICES.map((s) => <ServiceCard key={s.name} s={s} />)}
          </div>
        </Card>
      </div>

      {/* Recent */}
      <Card padding={0}>
        <div style={{ padding: "20px 22px 4px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: T_d.navy, margin: 0, letterSpacing: "-0.01em" }}>
            Последние записи
          </h3>
          <a style={{ fontSize: 13, color: T_d.teal, fontWeight: 600, cursor: "pointer" }}>
            Показать все →
          </a>
        </div>
        <div style={{ padding: "12px 8px 14px" }}>
          <RecentTable />
        </div>
      </Card>
    </main>
    <window.FAB onClick={onAddVisit} />
  </div>
);

window.Dashboard = Dashboard;
window.fmt = fmt;
window.Card = Card;
window.SectionTitle = SectionTitle;
window.PayPill = PayPill;
