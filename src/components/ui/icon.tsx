import * as React from "react";

/**
 * BUXAI icon set — a single stroke-consistent family (1.6px, 24px grid) so the
 * interface keeps one visual voice without shipping an icon dependency.
 */
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="11" width="7.5" height="10" rx="2" /></>,
  work: <><path d="M9 5h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M9 3h6v4H9z" /><path d="m9.5 13.5 1.6 1.6 3.4-3.4" /></>,
  ledger: <><path d="M5 4.5h11a2.5 2.5 0 0 1 2.5 2.5v12.5H7.5A2.5 2.5 0 0 1 5 17Z" /><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18.5" /><path d="M9 8.5h6" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.8" cy="6" r="1.1" /><circle cx="3.8" cy="12" r="1.1" /><circle cx="3.8" cy="18" r="1.1" /></>,
  scale: <><path d="M12 4v16M7 4h10" /><path d="M4.5 9h15" /><path d="m4.5 9-2 5h4z" /><path d="m19.5 9-2 5h4z" /></>,
  invoice: <><path d="M6 3.5h9.5L19 7v13.5H6z" /><path d="M15 3.5V7h4" /><path d="M9 11h7M9 14.5h7M9 18h4" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16.5 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M17 20a5.5 5.5 0 0 0-2.2-4.4" /></>,
  bank: <><path d="M3.5 9.5 12 4l8.5 5.5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3.5 20.5h17" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4.5V10h-5.5" /></>,
  box: <><path d="M20.5 7.8 12 3.5 3.5 7.8v8.4L12 20.5l8.5-4.3z" /><path d="m3.5 7.8 8.5 4.3 8.5-4.3" /><path d="M12 12.1v8.4" /></>,
  layers: <><path d="m12 3.5 8.5 4.3L12 12 3.5 7.8z" /><path d="m3.5 12.3 8.5 4.3 8.5-4.3" /><path d="m3.5 16.6 8.5 4.3 8.5-4.3" /></>,
  warehouse: <><path d="M3.5 20V9.8L12 5l8.5 4.8V20" /><path d="M8 20v-6h8v6" /><path d="M8 16.5h8" /></>,
  truck: <><path d="M3.5 6.5h10v9h-10z" /><path d="M13.5 9.5h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20.5a7 7 0 0 1 14 0" /></>,
  wallet: <><rect x="3.5" y="6" width="17" height="12.5" rx="2.5" /><path d="M3.5 10.5h17" /><circle cx="16" cy="14.4" r="1.1" /></>,
  document: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5V8h4" /><path d="M10 12h5M10 15.5h5" /></>,
  scan: <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M7 12h10" /></>,
  contract: <><path d="M6.5 3.5h11v17h-11z" /><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" /></>,
  receipt: <><path d="M6.5 3.5h11v17l-2.7-1.6-2.8 1.6-2.8-1.6L6.5 20.5z" /><path d="M9.5 8.5h5M9.5 12h5" /></>,
  statement: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5" /></>,
  report: <><path d="M4 19.5h16" /><rect x="6" y="11" width="3" height="6" rx="1" /><rect x="11" y="7" width="3" height="10" rx="1" /><rect x="16" y="13" width="3" height="4" rx="1" /></>,
  chart: <><path d="M4 15.5 9 9l4 3.5L20 5" /><path d="M20 10V5h-5" /></>,
  flow: <><path d="M4 7h9a3 3 0 0 1 3 3v3" /><path d="m13 10 3 3 3-3" /><path d="M4 17h9a3 3 0 0 0 3-3v-3" /><path d="m13 14 3-3 3 3" /></>,
  brain: <><path d="M9.5 5.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.4A3 3 0 0 0 8.5 19a3 3 0 0 0 3 1.5V5.5a2.5 2.5 0 0 0-2-2.5 2.5 2.5 0 0 0-2 2.5Z" /><path d="M14.5 5.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.4A3 3 0 0 1 15.5 19a3 3 0 0 1-3 1.5" /><path d="M12 4v16" /></>,
  radar: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 18 7" /><circle cx="12" cy="12" r="1.2" /></>,
  shield: <><path d="M12 3.5 19 6v6c0 4.2-2.9 7.2-7 8.5-4.1-1.3-7-4.3-7-8.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3.5V6M16 3.5V6" /></>,
  check: <><path d="m5 13 4.5 4.5L19 7" /></>,
  checkCircle: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.5 2.5 4.5-5" /></>,
  alert: <><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4M12 16.6v.5" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 8.2v.5" /></>,
  bell: <><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5Z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M4.5 12h2M17.5 12h2M6.7 6.7l1.4 1.4M15.9 15.9l1.4 1.4M17.3 6.7l-1.4 1.4M8.1 15.9l-1.4 1.4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  plus: <><path d="M12 5.5v13M5.5 12h13" /></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
  download: <><path d="M12 4v10" /><path d="m8 10.5 4 4 4-4" /><path d="M5 19.5h14" /></>,
  upload: <><path d="M12 15V5" /><path d="m8 8.5 4-4 4 4" /><path d="M5 19.5h14" /></>,
  print: <><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="2" /><path d="M7 14h10v6H7z" /></>,
  external: <><path d="M14 4.5h5.5V10" /><path d="M19 5 11 13" /><path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5h4" /></>,
  chevronDown: <><path d="m6 9.5 6 6 6-6" /></>,
  chevronRight: <><path d="m9.5 6 6 6-6 6" /></>,
  chevronLeft: <><path d="m14.5 6-6 6 6 6" /></>,
  arrowUp: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  logout: <><path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M11 8.5 7.5 12l3.5 3.5" /><path d="M7.5 12H15" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4" /><path d="M12 3.5c2.4 2.6 3.4 5.6 3.4 8.5s-1 5.9-3.4 8.5c-2.4-2.6-3.4-5.6-3.4-8.5S9.6 6.1 12 3.5Z" /></>,
  moon: <><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
  building: <><path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20" /><path d="M15 9h3.5A1.5 1.5 0 0 1 20 10.5V20" /><path d="M3.5 20h17" /><path d="M8 8h3M8 12h3M8 16h3" /></>,
  sparkles: <><path d="M12 4.5 13.6 9l4.4 1.6-4.4 1.6L12 16.7l-1.6-4.5L6 10.6 10.4 9z" /><path d="M18.5 16v3M17 17.5h3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  edit: <><path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5z" /><path d="m14.5 7 2.5 2.5" /></>,
  trash: <><path d="M5 7.5h14" /><path d="M8 7.5V5.8A1.3 1.3 0 0 1 9.3 4.5h5.4A1.3 1.3 0 0 1 16 5.8v1.7" /><path d="M6.5 7.5 7.5 19a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-11.5" /></>,
  duplicate: <><rect x="8" y="8" width="11.5" height="11.5" rx="2" /><path d="M15.5 8V6.5A1.5 1.5 0 0 0 14 5H6a1.5 1.5 0 0 0-1.5 1.5V14a1.5 1.5 0 0 0 1.5 1.5h1.5" /></>,
  more: <><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  logo: <><path d="M4.5 19V6.2c0-.9.7-1.7 1.7-1.7h5.4c2.5 0 4.2 1.3 4.2 3.4 0 1.6-1 2.7-2.4 3.1 1.8.4 3 1.6 3 3.6 0 2.5-1.9 4.1-4.9 4.1H4.5Z" /><path d="M9.6 11.2h2.2" /><path d="M17.4 4.6 20 7.2" /></>,
  arrowUpRight: <><path d="M7 17 17 7" /><path d="M8.5 7H17v8.5" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  chevronUp: <><path d="m6 14.5 6-6 6 6" /></>,
  columns: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15M14.5 4.5v15" /></>,
  flask: <><path d="M9 3.5h6" /><path d="M10 3.5v5.2L5.8 17a2.5 2.5 0 0 0 2.2 3.6h8a2.5 2.5 0 0 0 2.2-3.6L14 8.7V3.5" /><path d="M7.5 14h9" /></>,
  trendUp: <><path d="M4 16.5 10 10l4 3.5 6-7" /><path d="M20 11V6.5h-4.5" /></>,
  trendDown: <><path d="M4 7.5 10 14l4-3.5 6 7" /><path d="M20 13v4.5h-4.5" /></>,
  badge: <><rect x="4.5" y="4.5" width="15" height="15" rx="3" /><path d="M9 10.5h6M9 14h4" /><path d="M12 19.5V21" /></>,
  file: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5V8h4" /></>,
  eye: <><path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4.5 7.5 7.5 5.5 7.5-5.5" /></>,
  phone: <><path d="M7 3.5h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3c0 1.1-.9 2-2 2A14.5 14.5 0 0 1 5 5.5c0-1.1.9-2 2-2Z" /></>,
  pin: <><path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Z" /><circle cx="12" cy="10" r="2.4" /></>,
  percent: <><path d="M6 18 18 6" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></>,
  calculator: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M8.5 7.5h7" /><path d="M9 12h.5M12 12h.5M15 12h.5M9 16h.5M12 16h.5M15 16h.5" /></>,
  tag: <><path d="M11 4.5H19a.5.5 0 0 1 .5.5v8L12 20.5 4.5 13z" /><circle cx="15.5" cy="8.5" r="1.2" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.4 1.4" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.4-1.4" /></>,
  sort: <><path d="M7 4.5v15" /><path d="m4 16.5 3 3 3-3" /><path d="M17 19.5v-15" /><path d="m14 7.5 3-3 3 3" /></>,
  star: <><path d="m12 4.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10.2l5.4-.8z" /></>,
  message: <><path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16H9l-4.5 4z" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2.9-1.2 1.8v.3" /><path d="M12 16.8v.4" /></>,
  coins: <><ellipse cx="9" cy="7" rx="5.5" ry="2.6" /><path d="M3.5 7v4c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V7" /><path d="M12.5 13.2c.8 1.2 3 2 5.5 2 1 0 2-.2 2.6-.5" /><path d="M3.5 11v4c0 1.4 2.5 2.6 5.5 2.6 1.9 0 3.6-.5 4.6-1.3" /><path d="M20.5 11v4c0 1.4-2.5 2.6-5.5 2.6" /><ellipse cx="15" cy="8" rx="5.5" ry="2.6" /></>,
  split: <><path d="M6 4v6a3 3 0 0 0 3 3h6" /><path d="m13 10.5 3 2.5-3 2.5" /><path d="M6 20v-6" /></>,
  merge: <><path d="M6 4v4a4 4 0 0 0 4 4h8" /><path d="m15 9 3 3-3 3" /><path d="M6 20v-4" /></>,
  hourglass: <><path d="M7 3.5h10" /><path d="M7 20.5h10" /><path d="M8 3.5c0 3 4 4.5 4 8.5s-4 5.5-4 8.5" /><path d="M16 3.5c0 3-4 4.5-4 8.5s4 5.5 4 8.5" /></>,
  keyboard: <><rect x="3" y="6.5" width="18" height="11" rx="2.5" /><path d="M6.5 10h.5M10 10h.5M13.5 10h.5M17 10h.5M8 14h8" /></>,
  wand: <><path d="m5 19 9-9" /><path d="M14.5 4.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /><path d="M18 14l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" /></>,
  briefcase: <><rect x="3.5" y="7.5" width="17" height="12" rx="2.5" /><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" /><path d="M3.5 12.5h17" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const path = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {path}
    </svg>
  );
}
