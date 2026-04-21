import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Users, MessageSquare, ChevronRight, ChevronDown, ChevronUp, BarChart2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TopAd {
    ad_identifier: string;
    trigger_count: string;
}

interface HourlyEntry {
    hour: string;        // UTC ISO string
    new_contacts: string; // numeric string
}

interface DailyAnalytics {
    id: number;
    analysis_date: string;
    total_leads: number;
    total_messages: number;
    top_ads: { data: TopAd[] } | null;
    message_trend_analysis: string | null;
    message_count: Record<string, number> | null;
    messages_by_hr: unknown;
    created_at: string;
}

interface DashboardPageProps {
    isOpen: boolean;
    onClose: () => void;
}

const TABLE = 'daily_chat_analytics';

// Formats '2026-04-20' → 'Monday, Apr 20'
function fmtDate(dateStr: string, full = false) {
    const d = new Date(dateStr + 'T12:00:00'); // noon to avoid TZ-shift
    if (full) return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtNum(n: number) {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Very lightweight inline markdown renderer: handles **bold**, --- dividers, newlines
function renderMarkdown(text: string) {
    return text.split('\n\n').map((block, bi) => {
        const trimmed = block.trim();
        if (trimmed === '---') {
            return <hr key={bi} className="border-slate-200 my-4" />;
        }
        const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
        const inline = parts.flatMap((part, pi) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return [<strong key={pi} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>];
            }
            return part.split('\n').flatMap((line, li, arr) =>
                li < arr.length - 1 ? [line, <br key={`${pi}-${li}`} />] : [line]
            );
        });
        return (
            <p key={bi} className="mb-3 last:mb-0 leading-relaxed text-slate-700 text-sm">
                {inline}
            </p>
        );
    });
}

// ─── Date List ───────────────────────────────────────────────────────────────
function DateList({ rows, onSelect, onClose }: { rows: DailyAnalytics[]; onSelect: (r: DailyAnalytics) => void; onClose: () => void }) {
    return (
        <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 pt-safe pb-3 border-b border-slate-200 flex-shrink-0 bg-white"
                style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
                <button
                    onClick={onClose}
                    className="p-2 -ml-1 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex items-center gap-2 flex-1">
                    <BarChart2 size={18} style={{ color: 'var(--color-accent)' }} />
                    <span className="font-bold text-slate-900 text-base">Analytics</span>
                </div>
                <span className="text-xs text-slate-400 font-medium">{rows.length} reports</span>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {rows.length === 0 && (
                    <div className="text-center py-16 text-slate-400 text-sm">No reports yet</div>
                )}
                {rows.map(row => (
                    <button
                        key={row.id}
                        onClick={() => onSelect(row)}
                        className="w-full text-left p-4 bg-white rounded-2xl border border-slate-100 shadow-sm active:scale-[0.98] transition-all flex items-center gap-3 hover:border-slate-200"
                    >
                        {/* Date accent bar */}
                        <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }} />

                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-900 text-sm">{fmtDate(row.analysis_date)}</p>
                            <div className="flex items-center gap-3 mt-1.5">
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                    <Users size={11} className="flex-shrink-0" />
                                    <span className="font-semibold" style={{ color: 'var(--color-accent)' }}>{fmtNum(row.total_leads)}</span>
                                    <span>leads</span>
                                </span>
                                <span className="text-slate-300">·</span>
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                    <MessageSquare size={11} className="flex-shrink-0" />
                                    <span className="font-semibold text-slate-700">{fmtNum(row.total_messages)}</span>
                                    <span>messages</span>
                                </span>
                            </div>
                        </div>

                        <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                    </button>
                ))}
            </div>
        </>
    );
}

// ─── Message Depth Bars ───────────────────────────────────────────────────────
function DepthBars({ counts }: { counts: Record<string, number> }) {
    const ORDER = ['1-2', '3-5', '6-7', '8-10', '11+'];
    // Coerce to Number — jsonb values sometimes arrive as strings from Supabase
    const numCounts = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0]));
    const total = Object.values(numCounts).reduce((s, v) => s + v, 0) || 1;
    const maxVal = Math.max(...Object.values(numCounts), 1);

    return (
        <div className="space-y-2.5">
            {ORDER.map(key => {
                const val = numCounts[key] ?? 0;
                const pct = (val / maxVal) * 100;
                return (
                    <div key={key} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate-500 w-9 flex-shrink-0 text-right">{key}</span>
                        <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
                            <div
                                className="h-full rounded-lg flex items-center px-2 transition-all duration-700"
                                style={{
                                    width: `${Math.max(pct, 2)}%`,
                                    background: `linear-gradient(90deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 70%, #f43f5e))`,
                                }}
                            >
                                {pct > 20 && (
                                    <span className="text-white text-[10px] font-bold">{val}</span>
                                )}
                            </div>
                        </div>
                        <span className="text-xs font-bold text-slate-600 w-8 flex-shrink-0">
                            {pct <= 20 ? val : Math.round((val / total) * 100) + '%'}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Ad Card ─────────────────────────────────────────────────────────────────
function AdCard({ ad, rank }: { ad: TopAd; rank: number }) {
    const [expanded, setExpanded] = useState(false);
    const text = (ad.ad_identifier || '').replace(/^\/\/\//, '').trim();
    const preview = text.slice(0, 120);
    const hasMore = text.length > 120;
    const count = parseInt(ad.trigger_count, 10) || 0;

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-start gap-3">
                {/* Rank badge */}
                <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : rank === 3 ? '#cd7c2f' : 'var(--color-accent)' }}
                >
                    {rank}
                </div>

                <div className="flex-1 min-w-0">
                    {/* Trigger count pill */}
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ad</span>
                        <span
                            className="px-2 py-0.5 rounded-full text-white text-xs font-bold"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                        >
                            {count} triggers
                        </span>
                    </div>

                    {/* Ad text */}
                    <p
                        className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap break-words"
                        dir="rtl"
                        style={{ textAlign: 'right', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                    >
                        {expanded ? text : preview}
                        {!expanded && hasMore && '…'}
                    </p>

                    {hasMore && (
                        <button
                            onClick={() => setExpanded(v => !v)}
                            className="mt-2 flex items-center gap-1 text-xs font-semibold"
                            style={{ color: 'var(--color-accent)' }}
                        >
                            {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show full ad</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Hourly Curve Chart ───────────────────────────────────────────────────────
function parseHourly(raw: unknown): HourlyEntry[] {
    // Unwrap up to 3 levels of JSON-string encoding
    let val: unknown = raw;
    for (let i = 0; i < 3; i++) {
        if (typeof val !== 'string') break;
        try { val = JSON.parse(val); } catch { break; }
    }
    // Try every reasonable shape:
    // 1. [{data:[...]}]  ← what the user described
    if (Array.isArray(val) && val[0]?.data) return val[0].data as HourlyEntry[];
    // 2. {data:[...]}
    if (val && typeof val === 'object' && !Array.isArray(val) && (val as any).data)
        return (val as any).data as HourlyEntry[];
    // 3. [{hour, new_contacts}]  ← data array directly
    if (Array.isArray(val) && val[0]?.hour) return val as HourlyEntry[];
    return [];
}

function HourlyChart({ raw }: { raw: unknown }) {
    const entries = parseHourly(raw);
    if (entries.length === 0) return null;

    // Keep chronological (UTC) order; label each point in UTC+2
    const pts = entries.map((e, i) => {
        const d = new Date(e.hour);
        const h2 = (d.getUTCHours() + 2) % 24;
        const ampm = h2 < 12 ? 'am' : 'pm';
        const h12 = h2 % 12 === 0 ? 12 : h2 % 12;
        return { i, h2, count: Number(e.new_contacts) || 0, label: `${h12}${ampm}` };
    });

    const maxVal = Math.max(...pts.map(p => p.count), 1);
    const peakPt = pts.reduce((m, p) => (p.count > m.count ? p : m), pts[0]);

    // SVG layout
    const VW = 360, VH = 130;
    const pL = 26, pR = 8, pT = 18, pB = 26;
    const cW = VW - pL - pR, cH = VH - pT - pB;
    const toX = (i: number) => pL + (i / Math.max(pts.length - 1, 1)) * cW;
    const toY = (v: number) => pT + cH - (v / maxVal) * cH;

    // Smooth cubic bezier path
    const line = pts.reduce((d, p, i) => {
        const x = toX(i), y = toY(p.count);
        if (i === 0) return `M ${x} ${y}`;
        const px = toX(i - 1), py = toY(pts[i - 1].count);
        const cx = (px + x) / 2;
        return `${d} C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
    }, '');
    const lastX = toX(pts.length - 1), baseY = pT + cH;
    const area = `${line} L ${lastX} ${baseY} L ${toX(0)} ${baseY} Z`;

    // X-axis labels — show ~5 evenly spaced, always include first & last
    const step = Math.max(1, Math.floor((pts.length - 1) / 5));
    const labelIdxs = new Set([0, ...pts.map((_, i) => i).filter(i => i % step === 0), pts.length - 1]);

    // Y grid
    const yGridPcts = [0.25, 0.5, 0.75, 1];

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Leads by Hour · UTC+2
            </p>
            <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 130, display: 'block' }}>
                <defs>
                    <linearGradient id="hGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.02" />
                    </linearGradient>
                </defs>

                {/* Horizontal grid lines + Y labels */}
                {yGridPcts.map(pct => {
                    const y = pT + cH - pct * cH;
                    return (
                        <g key={pct}>
                            <line x1={pL} y1={y} x2={VW - pR} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                            <text x={pL - 3} y={y + 3} textAnchor="end" fill="#cbd5e1" fontSize="7">
                                {Math.round(pct * maxVal)}
                            </text>
                        </g>
                    );
                })}

                {/* X baseline */}
                <line x1={pL} y1={baseY} x2={VW - pR} y2={baseY} stroke="#e2e8f0" strokeWidth="1" />

                {/* Area fill */}
                <path d={area} fill="url(#hGrad)" />

                {/* Curve */}
                <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" />

                {/* All data dots (tiny) */}
                {pts.map(p => (
                    <circle key={p.i} cx={toX(p.i)} cy={toY(p.count)} r="2"
                        fill="var(--color-accent)" opacity="0.5" />
                ))}

                {/* Peak highlight */}
                <circle cx={toX(peakPt.i)} cy={toY(peakPt.count)} r="4.5"
                    fill="var(--color-accent)" />
                <circle cx={toX(peakPt.i)} cy={toY(peakPt.count)} r="7"
                    fill="var(--color-accent)" opacity="0.15" />
                <text x={toX(peakPt.i)} y={toY(peakPt.count) - 9}
                    textAnchor="middle" fill="var(--color-accent)" fontSize="8.5" fontWeight="bold">
                    {peakPt.count}
                </text>

                {/* X-axis labels */}
                {pts.filter((_, i) => labelIdxs.has(i)).map(p => (
                    <text key={p.i} x={toX(p.i)} y={VH - 2}
                        textAnchor="middle" fill="#94a3b8" fontSize="7">
                        {p.label}
                    </text>
                ))}
            </svg>
        </div>
    );
}

// Safe-parse a field that may arrive as a JSON string or already-parsed object
function safeParse<T>(val: unknown): T | null {
    if (!val) return null;
    if (typeof val === 'string') { try { return JSON.parse(val) as T; } catch { return null; } }
    return val as T;
}

// ─── Day Detail ───────────────────────────────────────────────────────────────
function DayDetail({ row, onBack }: { row: DailyAnalytics; onBack: () => void }) {
    const topAds = safeParse<{ data: TopAd[] }>(row.top_ads);
    const ads = topAds?.data ?? [];
    const messageCounts = safeParse<Record<string, number>>(row.message_count);

    return (
        <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 border-b border-slate-200 flex-shrink-0 bg-white"
                style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: '0.75rem' }}>
                <button
                    onClick={onBack}
                    className="p-2 -ml-1 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-sm leading-tight">{fmtDate(row.analysis_date, true)}</p>
                </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>

                {/* KPI row */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-center">
                        <p className="text-3xl font-black tracking-tight" style={{ color: 'var(--color-accent)' }}>
                            {fmtNum(row.total_leads)}
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-1">
                            <Users size={12} className="text-slate-400" />
                            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Leads</p>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-center">
                        <p className="text-3xl font-black tracking-tight text-slate-800">
                            {fmtNum(row.total_messages)}
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-1">
                            <MessageSquare size={12} className="text-slate-400" />
                            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Messages</p>
                        </div>
                    </div>
                </div>

                {/* Hourly curve */}
                <HourlyChart raw={row.messages_by_hr} />

                {/* Message depth distribution */}
                {messageCounts && Object.keys(messageCounts).length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                            Conversation Depth
                        </p>
                        <DepthBars counts={messageCounts} />
                    </div>
                )}

                {/* Top Ads */}
                {ads.length > 0 && (
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 px-1">
                            Top Ads by Trigger
                        </p>
                        <div className="space-y-2">
                            {ads.map((ad, i) => (
                                <AdCard key={i} ad={ad} rank={i + 1} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Trend Analysis */}
                {row.message_trend_analysis && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                            AI Analysis
                        </p>
                        <div
                            dir="rtl"
                            style={{ textAlign: 'right', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                        >
                            {renderMarkdown(row.message_trend_analysis)}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export const DashboardPage = ({ isOpen, onClose }: DashboardPageProps) => {
    const [mounted, setMounted] = useState(false);
    const [visible, setVisible] = useState(false);
    const [rows, setRows] = useState<DailyAnalytics[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<DailyAnalytics | null>(null);

    useEffect(() => {
        if (isOpen) {
            setMounted(true);
            requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
            // Fetch dates
            setLoading(true);
            supabase
                .from(TABLE)
                .select('*')
                .order('analysis_date', { ascending: false })
                .then(({ data }) => {
                    if (data) setRows(data as DailyAnalytics[]);
                    setLoading(false);
                });
        } else {
            setVisible(false);
            const t = setTimeout(() => {
                setMounted(false);
                setSelected(null);
            }, 250);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    // Hardware back button support — same pattern as chat
    useEffect(() => {
        if (!isOpen) return;
        const onPop = () => {
            if (selected) {
                setSelected(null);
            } else {
                onClose();
            }
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [isOpen, selected, onClose]);

    if (!mounted) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[60] flex flex-col bg-slate-50"
            style={{
                transform: visible ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                willChange: 'transform',
            }}
        >
            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm animate-pulse" style={{ color: 'var(--color-accent)' }}>Loading…</p>
                </div>
            ) : selected ? (
                <DayDetail row={selected} onBack={() => setSelected(null)} />
            ) : (
                <DateList rows={rows} onSelect={setSelected} onClose={onClose} />
            )}
        </div>,
        document.body
    );
};
