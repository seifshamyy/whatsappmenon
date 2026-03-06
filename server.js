import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- Infrastructure config ---
const PORT = process.env.PORT || 3000;
const APP_ID = process.env.APP_ID || 'default';
const SUPABASE_URL = 'https://whmbrguzumyatnslzfsq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobWJyZ3V6dW15YXRuc2x6ZnNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTM1MTY4OSwiZXhwIjoyMDY0OTI3Njg5fQ.h-YbToBRx8WTW5KCk2IAYnmuhob3oiARGsnn61HwYQc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- In-memory config (loaded from app_config Supabase table) ---
let serverConfig = new Map();
let realtimeChannel = null;

const cfg = (key, fallback = '') => serverConfig.get(key) || fallback;

async function loadServerConfig() {
    try {
        const { data, error } = await supabase
            .from('app_config')
            .select('key, value')
            .eq('app_id', APP_ID);
        if (error) throw error;
        if (data) {
            const newMap = new Map();
            data.forEach(row => newMap.set(row.key, row.value));
            serverConfig = newMap;
            console.log(`[Config] Loaded ${serverConfig.size} keys for app_id="${APP_ID}"`);
        }
    } catch (e) {
        console.warn('[Config] Failed to load app_config, using defaults:', e.message);
        // Seed defaults so server functions even without the table
        serverConfig.set('TABLE_MESSAGES', 'whatsappbuongo');
        serverConfig.set('TABLE_CONTACTS', 'contacts.buongo');
        serverConfig.set('TABLE_PUSH_SUBS', 'push_subscriptions_buongo');
        serverConfig.set('VAPID_PUBLIC_KEY', process.env.VAPID_PUBLIC_KEY || 'BMDotmpOCO_Z_htFzhqPnkyDLjLq_-WNKjNdjV_Go-Ozesf4Wq4SGiaUthaDIkWCsPKJP4GOqhDZezxsXm2fQpE');
        serverConfig.set('VAPID_PRIVATE_KEY', process.env.VAPID_PRIVATE_KEY || 'e-rlCV-oLhMlBvYIKz3aNohile3bJHklaXpDdaTLOfs');
        serverConfig.set('VAPID_EMAIL', process.env.VAPID_EMAIL || 'mailto:admin@flowmaticlabs.com');
    }
}

function initVapid() {
    const pub = cfg('VAPID_PUBLIC_KEY');
    const priv = cfg('VAPID_PRIVATE_KEY');
    const email = cfg('VAPID_EMAIL', 'mailto:admin@example.com');
    if (pub && priv) {
        webpush.setVapidDetails(email, pub, priv);
        console.log('[Push] VAPID keys configured');
    } else {
        console.warn('[Push] VAPID keys not set - push notifications disabled');
    }
}

// --- API Routes ---

// Get VAPID public key (frontend needs this)
app.get('/api/push/vapid-key', (req, res) => {
    res.json({ publicKey: cfg('VAPID_PUBLIC_KEY') });
});

// Subscribe to push
app.post('/api/push/subscribe', async (req, res) => {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription' });
    }

    try {
        const { error } = await supabase
            .from(cfg('TABLE_PUSH_SUBS', 'push_subscriptions_buongo'))
            .upsert(
                { endpoint: subscription.endpoint, keys: subscription.keys },
                { onConflict: 'endpoint' }
            );

        if (error) {
            console.error('[Push] Subscribe error:', error);
            return res.status(500).json({ error: 'Failed to save subscription' });
        }

        console.log('[Push] New subscription saved');
        res.json({ success: true });
    } catch (err) {
        console.error('[Push] Subscribe error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Unsubscribe
app.post('/api/push/unsubscribe', async (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) {
        return res.status(400).json({ error: 'Missing endpoint' });
    }

    const { error } = await supabase
        .from(cfg('TABLE_PUSH_SUBS', 'push_subscriptions_buongo'))
        .delete()
        .eq('endpoint', endpoint);

    if (error) {
        console.error('[Push] Unsubscribe error:', error);
    }

    res.json({ success: true });
});

// Test endpoint - manually trigger a push notification
app.get('/api/push/test', async (req, res) => {
    console.log('[Test] Sending test push notification...');
    try {
        await sendPushToAll({
            title: 'Test Notification',
            body: 'If you see this, push is working!',
            data: {},
        });
        res.json({ success: true, message: 'Test push sent' });
    } catch (err) {
        console.error('[Test] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Admin: Save config
app.post('/api/admin/config', async (req, res) => {
    const updates = req.body; // [{ key, value }]
    if (!Array.isArray(updates)) {
        return res.status(400).json({ error: 'Expected array of { key, value }' });
    }

    try {
        const { error } = await supabase
            .from('app_config')
            .upsert(
                updates.map(u => ({ app_id: APP_ID, key: u.key, value: u.value, updated_at: new Date().toISOString() })),
                { onConflict: 'app_id,key' }
            );

        if (error) throw error;

        // Reload in-memory config
        await loadServerConfig();

        // Re-init VAPID if keys changed
        initVapid();

        // Restart realtime if table names changed
        const tableKeys = ['TABLE_MESSAGES', 'TABLE_CONTACTS', 'TABLE_PUSH_SUBS'];
        const tableChanged = updates.some(u => tableKeys.includes(u.key));
        if (tableChanged) {
            if (realtimeChannel) {
                await supabase.removeChannel(realtimeChannel);
                realtimeChannel = null;
            }
            startRealtimeListener();
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[Admin] Config save error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Admin: Generate new VAPID keys
app.post('/api/admin/generate-vapid', (req, res) => {
    const vapidKeys = webpush.generateVAPIDKeys();
    res.json({
        publicKey: vapidKeys.publicKey,
        privateKey: vapidKeys.privateKey,
    });
});

// Dynamic PWA manifest — must be BEFORE static middleware
app.get('/manifest.json', (req, res) => {
    res.json({
        name: cfg('APP_NAME', 'Buongo'),
        short_name: cfg('APP_NAME', 'Buongo'),
        start_url: '/',
        display: 'fullscreen',
        background_color: cfg('THEME_COLOR', '#ffffff'),
        theme_color: cfg('THEME_COLOR', '#ffffff'),
        orientation: 'portrait',
        icons: [
            { src: cfg('PWA_ICON_192', '/pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
            { src: cfg('PWA_ICON_512', '/pwa-512x512.png'), sizes: '512x512', type: 'image/png' },
            { src: cfg('PWA_ICON_512', '/pwa-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    });
});

// --- Serve static files (after manifest route) ---
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback with dynamic meta injection
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path === '/manifest.json') return;

    const indexPath = path.join(__dirname, 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) {
        return res.status(404).send('App not built. Run npm run build first.');
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Replace <title>
    html = html.replace(/<title>.*?<\/title>/, `<title>${cfg('TAB_TEXT', cfg('APP_NAME', 'Buongo'))}</title>`);

    // Replace favicon
    html = html.replace(/href="\/buongo_logo\.jpg"/g, `href="${cfg('FAVICON_URL', '/buongo_logo.jpg')}"`);

    // Replace theme-color meta content
    html = html.replace(
        /(<meta name="theme-color" content=")([^"]*?)(")/,
        `$1${cfg('THEME_COLOR', '#ffffff')}$3`
    );

    res.send(html);
});

// --- Supabase Realtime: Listen for new messages ---
function startRealtimeListener() {
    const table = cfg('TABLE_MESSAGES', 'whatsappbuongo');
    console.log(`[Realtime] Starting listener on table: ${table}`);

    realtimeChannel = supabase
        .channel('new-messages')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table },
            async (payload) => {
                const msg = payload.new;
                console.log('[Realtime] Got INSERT payload:', JSON.stringify(payload, null, 2));

                if (!msg.from) {
                    console.log('[Realtime] Skipping - no "from" field');
                    return;
                }

                console.log(`[Realtime] New message from ${msg.from}`);

                let senderName = `+${msg.from}`;
                try {
                    const { data: contact } = await supabase
                        .from(cfg('TABLE_CONTACTS', 'contacts.buongo'))
                        .select('name_WA')
                        .eq('id', msg.from)
                        .single();
                    if (contact?.name_WA) {
                        senderName = contact.name_WA;
                    }
                } catch (e) {
                    // fallback to phone number
                }

                await sendPushToAll({
                    title: senderName,
                    body: msg.text || 'Media message',
                    data: { contactId: String(msg.from) },
                });
            }
        )
        .subscribe((status) => {
            console.log(`[Realtime] Subscription status: ${status}`);
        });
}

async function sendPushToAll(notification) {
    const { data: subs, error } = await supabase
        .from(cfg('TABLE_PUSH_SUBS', 'push_subscriptions_buongo'))
        .select('*');

    if (error || !subs || subs.length === 0) {
        console.log('[Push] No subscriptions to notify');
        return;
    }

    console.log(`[Push] Sending to ${subs.length} subscriber(s)`);

    const payload = JSON.stringify(notification);

    const results = await Promise.allSettled(
        subs.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: sub.keys },
                    payload
                );
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`[Push] Removing expired subscription: ${sub.endpoint.slice(-20)}`);
                    await supabase
                        .from(cfg('TABLE_PUSH_SUBS', 'push_subscriptions_buongo'))
                        .delete()
                        .eq('endpoint', sub.endpoint);
                } else {
                    console.error(`[Push] Send error:`, err.message);
                }
            }
        })
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    console.log(`[Push] Sent ${sent}/${subs.length}`);
}

// --- Start ---
async function start() {
    await loadServerConfig();
    initVapid();

    app.listen(PORT, () => {
        console.log(`[Server] Running on port ${PORT}`);
        startRealtimeListener();
    });
}

start();
