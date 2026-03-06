import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, RefreshCw, Save, ArrowLeft, Zap, AlertTriangle, Check } from 'lucide-react';
import { useConfig } from '../context/ConfigContext';

interface FieldState {
    [key: string]: string;
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-slate-900 font-bold text-sm uppercase tracking-wider">{title}</h2>
        </div>
        <div className="p-6 space-y-4">{children}</div>
    </div>
);

const Field = ({
    label,
    fieldKey,
    values,
    onChange,
    type = 'text',
    masked = false,
    preview,
    readOnly,
    hint,
}: {
    label: string;
    fieldKey: string;
    values: FieldState;
    onChange: (key: string, value: string) => void;
    type?: 'text' | 'textarea';
    masked?: boolean;
    preview?: boolean;
    readOnly?: boolean;
    hint?: string;
}) => {
    const [show, setShow] = useState(false);
    const value = values[fieldKey] ?? '';

    return (
        <div className="space-y-1.5">
            <label className="text-slate-700 text-xs font-semibold uppercase tracking-wide">{label}</label>
            <div className="relative">
                {type === 'textarea' ? (
                    <textarea
                        value={value}
                        onChange={e => onChange(fieldKey, e.target.value)}
                        readOnly={readOnly}
                        rows={3}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 resize-none"
                        style={{ WebkitTextSecurity: masked && !show ? 'disc' : undefined } as React.CSSProperties}
                    />
                ) : (
                    <input
                        type={masked && !show ? 'password' : 'text'}
                        value={value}
                        onChange={e => onChange(fieldKey, e.target.value)}
                        readOnly={readOnly}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 pr-10"
                    />
                )}
                {masked && (
                    <button
                        type="button"
                        onClick={() => setShow(s => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                )}
            </div>
            {hint && <p className="text-slate-400 text-xs">{hint}</p>}
            {preview && value && (
                <div className="flex items-center gap-2 mt-1">
                    <img
                        src={value}
                        alt="preview"
                        className="w-10 h-10 rounded-lg object-cover border border-slate-200"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="text-slate-400 text-xs">Preview</span>
                </div>
            )}
        </div>
    );
};

const ColorField = ({
    label,
    fieldKey,
    values,
    onChange,
}: {
    label: string;
    fieldKey: string;
    values: FieldState;
    onChange: (key: string, value: string) => void;
}) => {
    const value = values[fieldKey] ?? '#000000';

    return (
        <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <input
                type="color"
                value={value}
                onChange={e => onChange(fieldKey, e.target.value)}
                className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5 bg-white"
            />
            <div className="flex-1">
                <p className="text-slate-700 text-xs font-semibold">{label}</p>
                <input
                    type="text"
                    value={value}
                    onChange={e => onChange(fieldKey, e.target.value)}
                    className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                    maxLength={7}
                />
            </div>
            <div
                className="w-10 h-10 rounded-lg border border-slate-200 flex-shrink-0"
                style={{ backgroundColor: value }}
            />
        </div>
    );
};

export const AdminConfig = () => {
    const navigate = useNavigate();
    const { rawConfig, refreshConfig, appId } = useConfig();

    const [values, setValues] = useState<FieldState>({});
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [generatingVapid, setGeneratingVapid] = useState(false);

    // Initialize form from rawConfig
    useEffect(() => {
        const init: FieldState = {};
        rawConfig.forEach((v, k) => { init[k] = v; });
        setValues(init);
    }, [rawConfig]);

    const handleChange = (key: string, value: string) => {
        setValues(prev => ({ ...prev, [key]: value }));
    };

    const whatsappNumberId = values['WHATSAPP_NUMBER_ID'] ?? '927913190415819';
    const whatsappApiVersion = values['WHATSAPP_API_VERSION'] ?? 'v24.0';
    const previewApiUrl = `https://graph.facebook.com/${whatsappApiVersion}/${whatsappNumberId}/messages`;

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);

        try {
            const updates = Object.entries(values).map(([key, value]) => ({ key, value }));

            const response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Save failed');
            }

            await refreshConfig();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: unknown) {
            setSaveError(err instanceof Error ? err.message : 'Unknown error');
            setTimeout(() => setSaveError(null), 5000);
        } finally {
            setSaving(false);
        }
    };

    const handleGenerateVapid = async () => {
        setGeneratingVapid(true);
        try {
            const response = await fetch('/api/admin/generate-vapid', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to generate VAPID keys');
            const { publicKey, privateKey } = await response.json();
            setValues(prev => ({
                ...prev,
                VAPID_PUBLIC_KEY: publicKey,
                VAPID_PRIVATE_KEY: privateKey,
            }));
        } catch (err) {
            console.error('VAPID generation error:', err);
        } finally {
            setGeneratingVapid(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex items-center justify-between shadow-sm z-40">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/')}
                        className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-slate-900 font-bold text-lg">App Configuration</h1>
                        <p className="text-slate-400 text-xs">Dynamic runtime settings — no rebuild required</p>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-md"
                >
                    {saving ? (
                        <RefreshCw size={16} className="animate-spin" />
                    ) : saveSuccess ? (
                        <Check size={16} />
                    ) : (
                        <Save size={16} />
                    )}
                    {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save All'}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-6">

                {/* App ID info bar */}
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 rounded-xl text-sm">
                    <span className="text-slate-400 font-medium">App ID</span>
                    <code className="text-emerald-400 font-mono font-bold">{appId}</code>
                    <span className="text-slate-600 text-xs ml-auto">Set via <code className="text-slate-400">VITE_APP_ID</code> env var — not editable here</span>
                </div>

                {saveError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
                        {saveError}
                    </div>
                )}

                {/* Section 1: Database Tables */}
                <Section title="Database Tables">
                    <Field label="Messages Table" fieldKey="TABLE_MESSAGES" values={values} onChange={handleChange} />
                    <Field label="Contacts Table" fieldKey="TABLE_CONTACTS" values={values} onChange={handleChange} />
                    <Field label="Tags Table" fieldKey="TABLE_TAGS" values={values} onChange={handleChange} />
                    <Field label="Push Subscriptions Table" fieldKey="TABLE_PUSH_SUBS" values={values} onChange={handleChange} />
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-700 text-xs">Table name changes require an app reload to take full effect on realtime subscriptions.</p>
                    </div>
                </Section>

                {/* Section 2: WhatsApp API */}
                <Section title="WhatsApp API Configuration">
                    <Field label="WhatsApp Number ID" fieldKey="WHATSAPP_NUMBER_ID" values={values} onChange={handleChange} />
                    <Field label="WhatsApp API Version" fieldKey="WHATSAPP_API_VERSION" values={values} onChange={handleChange} />
                    <Field label="WhatsApp Access Token" fieldKey="WHATSAPP_TOKEN" values={values} onChange={handleChange} type="textarea" masked />
                    <Field label="Webhook URL" fieldKey="WEBHOOK_URL" values={values} onChange={handleChange} />
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-slate-400 text-xs mb-1 font-semibold uppercase tracking-wide">API URL Preview</p>
                        <p className="text-slate-600 text-xs font-mono break-all">{previewApiUrl}</p>
                    </div>
                </Section>

                {/* Section 3: VAPID Keys */}
                <Section title="Push Notification VAPID Keys">
                    <Field label="VAPID Public Key" fieldKey="VAPID_PUBLIC_KEY" values={values} onChange={handleChange} />
                    <Field label="VAPID Private Key" fieldKey="VAPID_PRIVATE_KEY" values={values} onChange={handleChange} masked />
                    <Field label="VAPID Email" fieldKey="VAPID_EMAIL" values={values} onChange={handleChange} />
                    <button
                        onClick={handleGenerateVapid}
                        disabled={generatingVapid}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        <Zap size={14} />
                        {generatingVapid ? 'Generating...' : 'Generate New VAPID Keys'}
                    </button>
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-700 text-xs">Generating new VAPID keys will invalidate all existing push notification subscriptions. Users will need to re-subscribe.</p>
                    </div>
                </Section>

                {/* Section 4: Branding */}
                <Section title="Branding">
                    <Field label="App Name" fieldKey="APP_NAME" values={values} onChange={handleChange} />
                    <Field label="Tab / Browser Title" fieldKey="TAB_TEXT" values={values} onChange={handleChange} />
                    <Field label="Sidebar Subtitle" fieldKey="SIDEBAR_SUBTITLE" values={values} onChange={handleChange} />
                    <Field label="Footer Text" fieldKey="FOOTER_TEXT" values={values} onChange={handleChange} />
                    <Field label="Favicon URL" fieldKey="FAVICON_URL" values={values} onChange={handleChange} preview />
                    <Field label="Sidebar Logo URL" fieldKey="SIDEBAR_LOGO_URL" values={values} onChange={handleChange} preview />
                    <Field label="Push Notification Icon" fieldKey="PUSH_NOTIFICATION_ICON" values={values} onChange={handleChange} preview />
                    <Field label="PWA Icon 192px" fieldKey="PWA_ICON_192" values={values} onChange={handleChange} />
                    <Field label="PWA Icon 512px" fieldKey="PWA_ICON_512" values={values} onChange={handleChange} />
                </Section>

                {/* Section 5: Theme Colors */}
                <Section title="Theme Colors">
                    <ColorField label="Theme Color (browser chrome)" fieldKey="THEME_COLOR" values={values} onChange={handleChange} />
                    <ColorField label="Primary Color (buttons, accents)" fieldKey="COLOR_PRIMARY" values={values} onChange={handleChange} />
                    <ColorField label="Accent / Secondary Color" fieldKey="COLOR_ACCENT" values={values} onChange={handleChange} />
                    <ColorField label="Outgoing Bubble Background" fieldKey="COLOR_OUTGOING_BUBBLE" values={values} onChange={handleChange} />
                    <ColorField label="Incoming Bubble Background" fieldKey="COLOR_INCOMING_BUBBLE" values={values} onChange={handleChange} />
                    <ColorField label="Chat Area Background" fieldKey="COLOR_CHAT_BG" values={values} onChange={handleChange} />
                    <ColorField label="Sidebar Background" fieldKey="COLOR_SIDEBAR_BG" values={values} onChange={handleChange} />

                    {/* Live Preview Mockup */}
                    <div className="mt-4">
                        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Live Preview</p>
                        <div
                            className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm"
                            style={{ backgroundColor: values['COLOR_CHAT_BG'] || '#f8fafc' }}
                        >
                            {/* Fake header */}
                            <div
                                className="px-4 py-3 flex items-center gap-3 border-b border-slate-200"
                                style={{ backgroundColor: values['COLOR_SIDEBAR_BG'] || '#ffffff' }}
                            >
                                <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                    style={{ backgroundColor: values['COLOR_PRIMARY'] || '#10b981' }}
                                >
                                    A
                                </div>
                                <div>
                                    <p className="text-slate-900 text-xs font-bold">{values['APP_NAME'] || 'App Name'}</p>
                                    <p className="text-slate-400 text-[10px]">{values['SIDEBAR_SUBTITLE'] || 'Subtitle'}</p>
                                </div>
                            </div>
                            {/* Fake messages */}
                            <div className="p-4 space-y-3">
                                <div className="flex justify-start">
                                    <div
                                        className="px-3 py-2 rounded-2xl rounded-bl-sm text-xs text-slate-900 max-w-[60%] shadow-sm border"
                                        style={{
                                            backgroundColor: values['COLOR_INCOMING_BUBBLE'] || '#ffffff',
                                            borderColor: '#e2e8f0',
                                        }}
                                    >
                                        Hello! How can I help?
                                    </div>
                                </div>
                                <div className="flex justify-end">
                                    <div
                                        className="px-3 py-2 rounded-2xl rounded-br-sm text-xs text-slate-900 max-w-[60%] shadow-sm border"
                                        style={{
                                            backgroundColor: values['COLOR_OUTGOING_BUBBLE'] || '#ecfdf5',
                                            borderColor: (values['COLOR_PRIMARY'] || '#10b981') + '33',
                                        }}
                                    >
                                        Hi there!
                                    </div>
                                </div>
                            </div>
                            {/* Fake send button */}
                            <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2 bg-white">
                                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-400">Message...</div>
                                <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                                    style={{ backgroundColor: values['COLOR_PRIMARY'] || '#10b981' }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
                </Section>
            </div>
        </div>

            {/* Save Bar */}
            <div className="flex-shrink-0 bg-white border-t border-slate-200 px-4 py-4 flex items-center justify-between z-40 shadow-lg">
                <p className="text-slate-500 text-xs">
                    Changes are saved to Supabase and applied instantly.
                </p>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-md"
                >
                    {saving ? <RefreshCw size={16} className="animate-spin" /> : saveSuccess ? <Check size={16} /> : <Save size={16} />}
                    {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save All'}
                </button>
            </div>
        </div>
    );
};
