const base = {
  width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false,
} as const;

export const IconUsers = () => (
  <svg {...base}><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="8" r="3.5" /><path d="M21 20v-1a4 4 0 0 0-3-3.87M16 4.13a3.5 3.5 0 0 1 0 6.74" /></svg>
);
export const IconPlans = () => (
  <svg {...base}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>
);
export const IconMore = () => (
  <svg {...base} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
);
export const IconPlus = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconClose = () => (
  <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
/** Three ascending steps: graduated tiers. */
export const LogoMark = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="2" y="14" width="5.5" height="8" rx="1.2" /><rect x="9.25" y="8.5" width="5.5" height="13.5" rx="1.2" /><rect x="16.5" y="2" width="5.5" height="20" rx="1.2" />
  </svg>
);
