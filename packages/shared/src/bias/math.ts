export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const logit = (p: number) => { const q = clamp(p, 1e-4, 1 - 1e-4); return Math.log(q / (1 - q)); };
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const std = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
/** Collapse consecutive duplicate mids so a quiet market polled every 5 s counts once. */
export const changePoints = (mids: number[]) => mids.filter((m, i) => i === 0 || m !== mids[i - 1]);
