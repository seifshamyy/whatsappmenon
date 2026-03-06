import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ConfigMap {
    tableMessages: string;
    tableContacts: string;
    tableTags: string;
    tablePushSubs: string;
    whatsappApiUrl: string;
    whatsappToken: string;
    webhookUrl: string;
    appName: string;
    tabText: string;
    faviconUrl: string;
    sidebarLogoUrl: string;
    sidebarSubtitle: string;
    footerText: string;
    colorPrimary: string;
    colorAccent: string;
    colorOutgoingBubble: string;
    colorIncomingBubble: string;
    colorChatBg: string;
    colorSidebarBg: string;
    themeColor: string;
    pushNotificationIcon: string;
    pwaIcon192: string;
    pwaIcon512: string;
}

interface ConfigContextType {
    config: ConfigMap;
    rawConfig: Map<string, string>;
    refreshConfig: () => Promise<void>;
    appId: string;
}

const DEFAULTS: ConfigMap = {
    tableMessages: 'whatsappbuongo',
    tableContacts: 'contacts.buongo',
    tableTags: 'tags.buongo',
    tablePushSubs: 'push_subscriptions_buongo',
    whatsappApiUrl: 'https://graph.facebook.com/v24.0/927913190415819/messages',
    whatsappToken: 'EAAWhwdJPMoABQqyclQ0MNsGyfDMvAQqYBRljnZC1PZATRhpa9ZC9Oq0FrhfcFw3w1QDK1VoRvnGOoIFXSGJuAro9bUQW984jdhxfOXZAhVk8IigBry2NPGQ1K5PgfEwE5rrsoqw4i2TshWZBN2Ih3d9Nrkwxp2XhmMyfHAPxduZAzh0DyfzzEi6ZC83dWdYZCvuUDgZDZD',
    webhookUrl: 'https://primary-production-e1a92.up.railway.app/webhook/d5672c0d-db68-4cbb-8bec-2de8e15515d2',
    appName: 'Buongo',
    tabText: 'Buongo Whatsapp',
    faviconUrl: '/buongo_logo.jpg',
    sidebarLogoUrl: 'https://whmbrguzumyatnslzfsq.supabase.co/storage/v1/object/public/TREE/buongo.jpg',
    sidebarSubtitle: 'Active Hub',
    footerText: 'BUONGO v1.1',
    colorPrimary: '#10b981',
    colorAccent: '#ef4444',
    colorOutgoingBubble: '#ecfdf5',
    colorIncomingBubble: '#ffffff',
    colorChatBg: '#f8fafc',
    colorSidebarBg: '#ffffff',
    themeColor: '#ffffff',
    pushNotificationIcon: '/buongo_logo.jpg',
    pwaIcon192: '/pwa-192x192.png',
    pwaIcon512: '/pwa-512x512.png',
};

function buildConfig(raw: Map<string, string>): ConfigMap {
    const get = (key: string, def: string) => raw.get(key) || def;
    const numberId = get('WHATSAPP_NUMBER_ID', '927913190415819');
    const apiVersion = get('WHATSAPP_API_VERSION', 'v24.0');

    return {
        tableMessages: get('TABLE_MESSAGES', DEFAULTS.tableMessages),
        tableContacts: get('TABLE_CONTACTS', DEFAULTS.tableContacts),
        tableTags: get('TABLE_TAGS', DEFAULTS.tableTags),
        tablePushSubs: get('TABLE_PUSH_SUBS', DEFAULTS.tablePushSubs),
        whatsappApiUrl: `https://graph.facebook.com/${apiVersion}/${numberId}/messages`,
        whatsappToken: get('WHATSAPP_TOKEN', DEFAULTS.whatsappToken),
        webhookUrl: get('WEBHOOK_URL', DEFAULTS.webhookUrl),
        appName: get('APP_NAME', DEFAULTS.appName),
        tabText: get('TAB_TEXT', DEFAULTS.tabText),
        faviconUrl: get('FAVICON_URL', DEFAULTS.faviconUrl),
        sidebarLogoUrl: get('SIDEBAR_LOGO_URL', DEFAULTS.sidebarLogoUrl),
        sidebarSubtitle: get('SIDEBAR_SUBTITLE', DEFAULTS.sidebarSubtitle),
        footerText: get('FOOTER_TEXT', DEFAULTS.footerText),
        colorPrimary: get('COLOR_PRIMARY', DEFAULTS.colorPrimary),
        colorAccent: get('COLOR_ACCENT', DEFAULTS.colorAccent),
        colorOutgoingBubble: get('COLOR_OUTGOING_BUBBLE', DEFAULTS.colorOutgoingBubble),
        colorIncomingBubble: get('COLOR_INCOMING_BUBBLE', DEFAULTS.colorIncomingBubble),
        colorChatBg: get('COLOR_CHAT_BG', DEFAULTS.colorChatBg),
        colorSidebarBg: get('COLOR_SIDEBAR_BG', DEFAULTS.colorSidebarBg),
        themeColor: get('THEME_COLOR', DEFAULTS.themeColor),
        pushNotificationIcon: get('PUSH_NOTIFICATION_ICON', DEFAULTS.pushNotificationIcon),
        pwaIcon192: get('PWA_ICON_192', DEFAULTS.pwaIcon192),
        pwaIcon512: get('PWA_ICON_512', DEFAULTS.pwaIcon512),
    };
}

const APP_ID = import.meta.env.VITE_APP_ID || 'default';

const ConfigContext = createContext<ConfigContextType | null>(null);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [rawConfig, setRawConfig] = useState<Map<string, string>>(new Map());
    const [config, setConfig] = useState<ConfigMap>(DEFAULTS);
    const [loading, setLoading] = useState(true);

    const loadConfig = useCallback(async () => {
        try {
            const { data } = await supabase
                .from('app_config')
                .select('key, value')
                .eq('app_id', APP_ID);
            if (data) {
                const map = new Map<string, string>();
                (data as { key: string; value: string }[]).forEach(row => map.set(row.key, row.value));
                setRawConfig(map);
                setConfig(buildConfig(map));
            }
        } catch (e) {
            console.error('[Config] Failed to load config, using defaults:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    // Apply CSS variables + meta tag updates when config changes
    useEffect(() => {
        if (loading) return;
        const root = document.documentElement;
        root.style.setProperty('--color-primary', config.colorPrimary);
        root.style.setProperty('--color-accent', config.colorAccent);
        root.style.setProperty('--color-outgoing-bubble', config.colorOutgoingBubble);
        root.style.setProperty('--color-incoming-bubble', config.colorIncomingBubble);
        root.style.setProperty('--color-chat-bg', config.colorChatBg);
        root.style.setProperty('--color-sidebar-bg', config.colorSidebarBg);

        document.title = config.tabText || config.appName;

        const faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
        if (faviconEl) faviconEl.href = config.faviconUrl;

        const appleTouchEl = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
        if (appleTouchEl) appleTouchEl.href = config.faviconUrl;

        const themeColorEl = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
        if (themeColorEl) themeColorEl.content = config.themeColor;
    }, [config, loading]);

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="config-spinner" />
                    <p style={{ color: '#64748b', fontSize: 14, marginTop: 12 }}>Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <ConfigContext.Provider value={{ config, rawConfig, refreshConfig: loadConfig, appId: APP_ID }}>
            {children}
        </ConfigContext.Provider>
    );
};

export const useConfig = (): ConfigContextType => {
    const ctx = useContext(ConfigContext);
    if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
    return ctx;
};
