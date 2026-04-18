import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, Search, User, Check, CheckCheck, AlertCircle, Loader2, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useConfig } from '../context/ConfigContext';
import { sendWhatsAppText, storeMessage, postToWebhook } from '../lib/whatsapp';

interface BroadcastContact {
    id: string;
    name: string | null;
    lastMessage: string;
    msRemaining: number;
}

type SendStatus = 'pending' | 'sending' | 'sent' | { error: string };

interface BroadcastModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AVATAR_COLORS = [
    { from: '#f97316', to: '#c2410c' },
    { from: '#3b82f6', to: '#1d4ed8' },
    { from: '#8b5cf6', to: '#6d28d9' },
    { from: '#0ea5e9', to: '#0369a1' },
    { from: '#f59e0b', to: '#d97706' },
    { from: '#ec4899', to: '#be185d' },
    { from: '#06b6d4', to: '#0891b2' },
];

const getAvatarColor = (id: string) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const formatRemaining = (ms: number) => {
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
};

const urgencyColor = (ms: number) => {
    if (ms < 3 * 3600000) return '#ef4444';
    if (ms < 8 * 3600000) return '#f59e0b';
    return '#10b981';
};

const TEMPLATES_KEY = 'broadcast_templates_v1';

const loadTemplates = (): string[] => {
    try {
        const s = localStorage.getItem(TEMPLATES_KEY);
        return s ? JSON.parse(s) : [];
    } catch { return []; }
};

export const BroadcastModal = ({ isOpen, onClose }: BroadcastModalProps) => {
    const { config } = useConfig();

    // Animate in after mount so CSS transition fires
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (isOpen) {
            // Double-rAF guarantees the initial hidden state paints before we transition
            const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
            return () => cancelAnimationFrame(id);
        } else {
            setVisible(false);
        }
    }, [isOpen]);

    const [step, setStep] = useState<'pick' | 'compose' | 'progress'>('pick');
    const [contacts, setContacts] = useState<BroadcastContact[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [message, setMessage] = useState('');
    const [templates, setTemplates] = useState<string[]>(loadTemplates);
    const [sendResults, setSendResults] = useState<Map<string, SendStatus>>(new Map());
    const [isDone, setIsDone] = useState(false);
    const cancelledRef = useRef(false);

    const reset = useCallback(() => {
        setStep('pick');
        setSelected(new Set());
        setSearchQuery('');
        setMessage('');
        setSendResults(new Map());
        setIsDone(false);
        cancelledRef.current = false;
    }, []);

    const loadContacts = useCallback(async () => {
        setLoading(true);
        try {
            const since = new Date(Date.now() - 24 * 3600000).toISOString();
            const [msgResult, ebpResult] = await Promise.all([
                supabase
                    .from(config.tableMessages)
                    .select('from, to, created_at, text, type')
                    .gte('created_at', since)
                    .order('created_at', { ascending: false }),
                supabase.from(config.tableContacts).select('*'),
            ]);

            if (ebpResult.error) console.error('[Broadcast] contacts fetch failed:', ebpResult.error);

            const nameMap = new Map<string, string | null>();
            if (ebpResult.data) {
                (ebpResult.data as { id: number | string; name_WA: string | null }[])
                    .forEach(c => nameMap.set(String(c.id), c.name_WA ?? null));
            }

            const seen = new Map<string, BroadcastContact>();
            ((msgResult.data ?? []) as any[]).forEach(msg => {
                if (!msg.from || !/^\d+$/.test(msg.from)) return;
                const contactId = msg.from as string;
                if (seen.has(contactId)) return;
                const msRemaining = new Date(msg.created_at).getTime() + 24 * 3600000 - Date.now();
                if (msRemaining <= 0) return;
                seen.set(contactId, {
                    id: contactId,
                    name: nameMap.has(contactId) ? (nameMap.get(contactId) ?? null) : null,
                    lastMessage: msg.text || (msg.type === 'audio' ? '🎤 Voice' : '📷 Media'),
                    msRemaining,
                });
            });

            setContacts(Array.from(seen.values()).sort((a, b) => a.msRemaining - b.msRemaining));
        } catch (err) {
            console.error('[Broadcast] load error:', err);
        } finally {
            setLoading(false);
        }
    }, [config.tableMessages, config.tableContacts]);

    useEffect(() => {
        if (!isOpen) return;
        reset();
        loadContacts();
    }, [isOpen, reset, loadContacts]);

    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const filteredContacts = contacts.filter(c =>
        !searchQuery ||
        c.id.includes(searchQuery) ||
        c.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedContacts = contacts.filter(c => selected.has(c.id));
    const allSelected = filteredContacts.length > 0 && filteredContacts.every(c => selected.has(c.id));

    const applyPersonalization = (text: string, contact: BroadcastContact) => {
        const firstName = contact.name?.split(' ')[0] || contact.id;
        return text
            .replace(/\{\{name\}\}/gi, contact.name || contact.id)
            .replace(/\{\{firstName\}\}/gi, firstName)
            .replace(/\{\{phone\}\}/gi, contact.id);
    };

    const saveTemplate = () => {
        const t = message.trim();
        if (!t || templates.includes(t)) return;
        const next = [t, ...templates].slice(0, 5);
        setTemplates(next);
        try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { /* noop */ }
    };

    const deleteTemplate = (i: number) => {
        const next = templates.filter((_, idx) => idx !== i);
        setTemplates(next);
        try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { /* noop */ }
    };

    const doSend = useCallback(async (toSend: BroadcastContact[]) => {
        setIsDone(false);
        setSendResults(prev => {
            const next = new Map(prev);
            toSend.forEach(c => next.set(c.id, 'pending'));
            return next;
        });

        for (const contact of toSend) {
            if (cancelledRef.current) break;
            setSendResults(prev => new Map(prev).set(contact.id, 'sending'));
            try {
                const text = applyPersonalization(message, contact);
                const res = await sendWhatsAppText(contact.id, text, config.whatsappApiUrl, config.whatsappToken);
                const mid = res.messages?.[0]?.id || `bc_${Date.now()}`;
                await storeMessage('text', text, null, mid, contact.id, config.tableMessages);
                await postToWebhook(mid, text, 'text', contact.id, config.webhookUrl);
                setSendResults(prev => new Map(prev).set(contact.id, 'sent'));
            } catch (err: any) {
                setSendResults(prev => new Map(prev).set(contact.id, { error: err.message || 'Failed' }));
            }
            if (!cancelledRef.current) await new Promise(res => setTimeout(res, 800));
        }
        setIsDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message, config]);

    const startSend = () => {
        setStep('progress');
        cancelledRef.current = false;
        doSend(selectedContacts);
    };

    const retryFailed = () => {
        const failed = contacts.filter(c => {
            const s = sendResults.get(c.id);
            return typeof s === 'object' && s !== null;
        });
        cancelledRef.current = false;
        doSend(failed);
    };

    const sentCount = Array.from(sendResults.values()).filter(v => v === 'sent').length;
    const failedCount = Array.from(sendResults.values()).filter(v => typeof v === 'object' && v !== null).length;
    const totalCount = sendResults.size;
    const expiringSoon = selectedContacts.filter(c => c.msRemaining < 2 * 3600000);

    if (!isOpen) return null;

    const stepTitle = step === 'pick' ? 'Broadcast' : step === 'compose' ? 'Write message' : isDone ? 'Done' : 'Sending…';
    const stepSubtitle = step === 'pick'
        ? `${contacts.length} contact${contacts.length !== 1 ? 's' : ''} in 24h window`
        : step === 'compose'
            ? `${selected.size} selected`
            : isDone
                ? `${sentCount} sent · ${failedCount} failed`
                : `${sentCount + failedCount} / ${totalCount}`;

    const isSending = step === 'progress' && !isDone;

    return createPortal(
        <div
            className="fixed inset-0 z-50"
            style={{
                backgroundColor: visible ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
                backdropFilter: visible ? 'blur(3px)' : 'none',
                WebkitBackdropFilter: visible ? 'blur(3px)' : 'none',
                transition: 'background-color 250ms ease, backdrop-filter 250ms ease',
            }}
            onClick={isSending ? undefined : onClose}
        >
            {/* Positioning shell — mobile: pinned to bottom with explicit gutters; desktop: centered */}
            <div className="absolute bottom-3 left-3 right-3 md:inset-0 md:flex md:items-center md:justify-center md:p-4">
            <div
                className={[
                    'bg-white w-full flex flex-col overflow-hidden',
                    'rounded-2xl',
                    'md:max-w-[420px]',
                    // Height — dvh collapses with keyboard on modern browsers
                    'max-h-[92dvh] md:max-h-[85dvh]',
                    // Elevation
                    'shadow-[0_-4px_32px_rgba(0,0,0,0.18)] md:shadow-2xl',
                    // Transition
                    'transition-[transform,opacity] duration-[340ms]',
                    // Animated states — mobile slides up, desktop fades+scales
                    visible
                        ? 'translate-y-0 md:scale-100 opacity-100'
                        : 'translate-y-full md:translate-y-3 md:scale-[0.96] opacity-100 md:opacity-0',
                ].join(' ')}
                style={{ willChange: 'transform, opacity' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Drag handle — mobile only */}
                <div className="md:hidden flex justify-center pt-3 pb-0 flex-shrink-0">
                    <div className="w-9 h-[5px] bg-slate-200 rounded-full" />
                </div>

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 pt-4 pb-3 md:pt-5 border-b border-slate-100 flex-shrink-0">
                    <div style={{ width: 36, height: 36 }}>
                        {step === 'compose' && (
                            <button
                                onClick={() => setStep('pick')}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-400 transition-colors"
                            >
                                <ChevronLeft size={20} />
                            </button>
                        )}
                    </div>

                    <div className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                            <Zap size={14} style={{ color: 'var(--color-primary)' }} />
                            <h2 className="font-bold text-slate-900 text-[15px]">{stepTitle}</h2>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-none">{stepSubtitle}</p>
                    </div>

                    <button
                        onClick={isSending ? undefined : onClose}
                        disabled={isSending}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* ══════════════════════ STEP: PICK ══════════════════════ */}
                {step === 'pick' && (
                    <>
                        {/* Search + All/None */}
                        <div className="px-4 pt-3 pb-2.5 flex-shrink-0 bg-white border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <input
                                        type="text"
                                        placeholder="Search contacts…"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl h-10 pl-9 pr-3 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 transition-colors"
                                    />
                                </div>
                                <button
                                    onClick={() => setSelected(allSelected ? new Set() : new Set(filteredContacts.map(c => c.id)))}
                                    className="h-10 px-3.5 rounded-xl border text-[13px] font-semibold flex-shrink-0 transition-all active:scale-95"
                                    style={{
                                        borderColor: allSelected ? 'var(--color-primary)' : '#e2e8f0',
                                        color: allSelected ? 'var(--color-primary)' : '#94a3b8',
                                        backgroundColor: allSelected ? `${config.colorPrimary}12` : 'white',
                                    }}
                                >
                                    {allSelected ? 'None' : 'All'}
                                </button>
                            </div>
                        </div>

                        {/* Contact list */}
                        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-2">
                                    <Loader2 size={20} className="animate-spin text-slate-300" />
                                    <p className="text-slate-400 text-sm">Loading contacts…</p>
                                </div>
                            ) : filteredContacts.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                                    <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                                        <Zap size={22} className="text-slate-300" />
                                    </div>
                                    <p className="text-slate-600 text-[15px] font-semibold mb-1">No contacts available</p>
                                    <p className="text-slate-400 text-[13px] leading-relaxed">
                                        Contacts who message you within the last 24 hours appear here
                                    </p>
                                </div>
                            ) : (
                                filteredContacts.map(c => {
                                    const color = getAvatarColor(c.id);
                                    const isSelected = selected.has(c.id);
                                    return (
                                        <button
                                            key={c.id}
                                            onClick={() => toggleSelect(c.id)}
                                            className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 transition-colors active:bg-slate-50 text-left select-none"
                                            style={{
                                                backgroundColor: isSelected ? `${config.colorPrimary}09` : 'white',
                                            }}
                                        >
                                            {/* Avatar */}
                                            <div
                                                className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 shadow-sm"
                                                style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
                                            >
                                                {c.name?.[0]?.toUpperCase() ?? <User size={16} />}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-semibold text-slate-900 text-[14px] truncate leading-snug">
                                                        {c.name || `+${c.id}`}
                                                    </span>
                                                    <span
                                                        className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full text-white leading-none"
                                                        style={{ backgroundColor: urgencyColor(c.msRemaining) }}
                                                    >
                                                        {formatRemaining(c.msRemaining)}
                                                    </span>
                                                </div>
                                                <p className="text-[13px] text-slate-400 truncate leading-snug">
                                                    {c.lastMessage}
                                                </p>
                                            </div>

                                            {/* Checkbox */}
                                            <div
                                                className="w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150"
                                                style={{
                                                    borderColor: isSelected ? 'var(--color-primary)' : '#d1d5db',
                                                    backgroundColor: isSelected ? 'var(--color-primary)' : 'white',
                                                }}
                                            >
                                                {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        {/* CTA */}
                        <div
                            className="flex-shrink-0 px-4 pt-3 bg-white border-t border-slate-100"
                            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                        >
                            <button
                                onClick={() => setStep('compose')}
                                disabled={selected.size === 0}
                                className="w-full h-14 rounded-2xl text-white text-[15px] font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm"
                                style={{ backgroundColor: 'var(--color-primary)' }}
                            >
                                <Zap size={16} />
                                Next — {selected.size > 0 ? `${selected.size} contact${selected.size !== 1 ? 's' : ''}` : 'select contacts'}
                            </button>
                        </div>
                    </>
                )}

                {/* ══════════════════════ STEP: COMPOSE ══════════════════════ */}
                {step === 'compose' && (
                    <>
                        {/* Scrollable content */}
                        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-4 py-4 space-y-5">
                            {/* Textarea */}
                            <div>
                                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-2">
                                    Message
                                </label>
                                <textarea
                                    value={message}
                                    onChange={e => setMessage(e.target.value)}
                                    placeholder="Type your message…"
                                    autoFocus
                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[14px] text-slate-900 focus:outline-none focus:border-slate-300 resize-none transition-colors leading-relaxed"
                                    rows={5}
                                />
                                {/* Variable chips */}
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                    <span className="text-[11px] text-slate-400">Insert:</span>
                                    {[
                                        { label: 'Name', value: '{{name}}' },
                                        { label: 'First name', value: '{{firstName}}' },
                                        { label: 'Phone', value: '{{phone}}' },
                                    ].map(({ label, value }) => (
                                        <button
                                            key={value}
                                            onClick={() => setMessage(m => m + value)}
                                            className="h-7 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 text-[11px] font-medium transition-colors"
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Preview */}
                            {message.trim() && selectedContacts.length > 0 && (
                                <div>
                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-2">
                                        Preview
                                    </label>
                                    <div className="flex justify-end">
                                        <div
                                            className="px-4 py-3 rounded-[18px] rounded-br-[4px] text-[14px] text-slate-900 max-w-[82%] shadow-sm leading-relaxed whitespace-pre-wrap break-words"
                                            style={{ backgroundColor: 'var(--color-outgoing-bubble, #ecfdf5)' }}
                                        >
                                            {applyPersonalization(message, selectedContacts[0])}
                                        </div>
                                    </div>
                                    {selectedContacts.length > 1 && (
                                        <p className="text-[11px] text-slate-400 mt-1.5 text-right">
                                            Each contact gets a personalized version
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Saved templates */}
                            {templates.length > 0 && (
                                <div>
                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-2">
                                        Saved templates
                                    </label>
                                    <div className="space-y-2">
                                        {templates.map((tmpl, i) => (
                                            <div key={i} className="flex items-center gap-2 group">
                                                <button
                                                    onClick={() => setMessage(tmpl)}
                                                    className="flex-1 text-left px-3.5 py-2.5 rounded-xl text-[13px] bg-slate-50 border border-slate-100 text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
                                                >
                                                    <span className="line-clamp-2 leading-snug">
                                                        {tmpl.length > 80 ? tmpl.slice(0, 80) + '…' : tmpl}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => deleteTemplate(i)}
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {message.trim() && !templates.includes(message.trim()) && (
                                <button
                                    onClick={saveTemplate}
                                    className="text-[13px] text-slate-400 hover:text-[var(--color-primary)] transition-colors"
                                >
                                    + Save as template
                                </button>
                            )}
                        </div>

                        {/* Sticky bottom bar — stays above keyboard */}
                        <div
                            className="flex-shrink-0 px-4 pt-3 bg-white border-t border-slate-100"
                            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                        >
                            {expiringSoon.length > 0 && (
                                <div className="mb-3 flex items-start gap-2.5 text-[13px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5">
                                    <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                                    <span>
                                        {expiringSoon.length} contact{expiringSoon.length > 1 ? 's' : ''} expire within 2 hours
                                    </span>
                                </div>
                            )}
                            <div className="flex gap-2.5">
                                <button
                                    onClick={() => setStep('pick')}
                                    className="w-14 h-14 rounded-2xl border border-slate-200 text-slate-500 font-bold text-lg hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center justify-center flex-shrink-0"
                                >
                                    ←
                                </button>
                                <button
                                    onClick={startSend}
                                    disabled={!message.trim()}
                                    className="flex-1 h-14 rounded-2xl text-white text-[15px] font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm"
                                    style={{ backgroundColor: 'var(--color-primary)' }}
                                >
                                    <Zap size={16} />
                                    Send to {selected.size} contact{selected.size !== 1 ? 's' : ''}
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* ══════════════════════ STEP: PROGRESS ══════════════════════ */}
                {step === 'progress' && (
                    <>
                        {/* Progress header */}
                        <div className="flex-shrink-0 px-5 pt-4 pb-4 border-b border-slate-100 bg-white">
                            <div className="flex items-center justify-between mb-2.5">
                                <span className="text-[13px] font-semibold text-slate-700">
                                    {isDone
                                        ? failedCount === 0
                                            ? `All ${sentCount} sent ✓`
                                            : `${sentCount} sent · ${failedCount} failed`
                                        : `Sending…`}
                                </span>
                                {totalCount > 0 && (
                                    <span className="text-[12px] font-mono text-slate-400">
                                        {sentCount + failedCount}/{totalCount}
                                    </span>
                                )}
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-500 ease-out"
                                    style={{
                                        width: totalCount > 0
                                            ? `${((sentCount + failedCount) / totalCount) * 100}%`
                                            : '0%',
                                        backgroundColor: isDone && failedCount > 0
                                            ? '#f59e0b'
                                            : isDone ? '#10b981' : 'var(--color-primary)',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Per-contact status */}
                        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
                            {contacts
                                .filter(c => sendResults.has(c.id))
                                .map(c => {
                                    const status = sendResults.get(c.id);
                                    const color = getAvatarColor(c.id);
                                    return (
                                        <div
                                            key={c.id}
                                            className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-50 transition-colors"
                                            style={{
                                                backgroundColor: status === 'sent'
                                                    ? '#f0fdf4'
                                                    : typeof status === 'object' ? '#fff7f7' : 'white',
                                            }}
                                        >
                                            <div
                                                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                                                style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
                                            >
                                                {c.name?.[0]?.toUpperCase() ?? '?'}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-slate-800 text-[14px] truncate leading-snug">
                                                    {c.name || `+${c.id}`}
                                                </p>
                                                {typeof status === 'object' && status !== null && (
                                                    <p className="text-[11px] text-red-400 truncate mt-0.5">{status.error}</p>
                                                )}
                                                {status === 'sent' && (
                                                    <p className="text-[11px] text-emerald-500 mt-0.5">Sent</p>
                                                )}
                                            </div>
                                            <div className="flex-shrink-0 w-6 flex items-center justify-center">
                                                {status === 'pending' && (
                                                    <div className="w-5 h-5 rounded-full border-2 border-slate-200" />
                                                )}
                                                {status === 'sending' && (
                                                    <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                                                )}
                                                {status === 'sent' && (
                                                    <CheckCheck size={18} style={{ color: '#10b981' }} />
                                                )}
                                                {typeof status === 'object' && status !== null && (
                                                    <X size={18} className="text-red-400" />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>

                        {/* Actions */}
                        <div
                            className="flex-shrink-0 px-4 pt-3 bg-white border-t border-slate-100 flex gap-2.5"
                            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                        >
                            {!isDone && (
                                <button
                                    onClick={() => { cancelledRef.current = true; }}
                                    className="flex-1 h-14 rounded-2xl border border-slate-200 text-[15px] text-slate-500 font-semibold hover:bg-slate-50 active:bg-slate-100 transition-colors"
                                >
                                    Cancel
                                </button>
                            )}
                            {isDone && failedCount > 0 && (
                                <button
                                    onClick={retryFailed}
                                    className="flex-1 h-14 rounded-2xl border text-[15px] font-bold transition-colors active:scale-[0.98]"
                                    style={{ borderColor: '#fde68a', color: '#d97706', backgroundColor: '#fffbeb' }}
                                >
                                    Retry {failedCount} failed
                                </button>
                            )}
                            {isDone && (
                                <button
                                    onClick={onClose}
                                    className="flex-1 h-14 rounded-2xl text-white text-[15px] font-bold transition-all active:scale-[0.98] shadow-sm"
                                    style={{ backgroundColor: 'var(--color-primary)' }}
                                >
                                    Done
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
            </div>
        </div>
        , document.body
    );
};
