import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, User, Tag as TagIcon, Bell, BellRing, MessageSquare, CheckCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { WhatsAppMessage, ContactEbp, Tag, getContactId } from '../types';
import { TagManager } from './TagManager';
import { subscribeToPush, isPushSupported } from '../lib/pushNotifications';
import { PullToRefresh } from './PullToRefresh';
import { useConfig } from '../context/ConfigContext';

interface SidebarContact {
    id: string;
    name: string | null;
    lastMessage: string;
    lastMessageTime: string;
    lastMessageIsOutgoing: boolean;
    unreadCount: number;
    tags: number[];
    aiEnabled: boolean;
}

interface ChatSidebarProps {
    onSelectChat: (contactId: string) => void;
    selectedChat: string | null;
}

// Per-contact "last read" timestamp.
// Any incoming message with created_at > lastReadAt[contactId] is unread.
// This never grows unboundedly — O(1) per contact regardless of message count.
const READ_TS_KEY = 'portal_read_timestamps_v2';

const loadReadTimestamps = (): Map<string, string> => {
    try {
        const stored = localStorage.getItem(READ_TS_KEY);
        if (stored) return new Map(Object.entries(JSON.parse(stored)));
    } catch {}
    return new Map();
};

const saveReadTimestamps = (map: Map<string, string>) => {
    try { localStorage.setItem(READ_TS_KEY, JSON.stringify(Object.fromEntries(map))); }
    catch {}
};

const AVATAR_COLORS = [
    { from: '#f97316', to: '#c2410c', text: '#f97316' }, // Orange
    { from: '#3b82f6', to: '#1d4ed8', text: '#3b82f6' }, // Blue
    { from: '#8b5cf6', to: '#6d28d9', text: '#8b5cf6' }, // Violet
    { from: '#0ea5e9', to: '#0369a1', text: '#0ea5e9' }, // Sky
    { from: '#f59e0b', to: '#d97706', text: '#f59e0b' }, // Amber
    { from: '#ec4899', to: '#be185d', text: '#ec4899' }, // Pink
    { from: '#06b6d4', to: '#0891b2', text: '#06b6d4' }, // Cyan
];

const getAvatarColor = (contactId: string) => {
    let hash = 0;
    for (let i = 0; i < contactId.length; i++) {
        hash = contactId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

// Module-level singletons for sidebar realtime channels
let sidebarMsgChannel: any = null;
let sidebarContactChannel: any = null;
let sidebarFetchContactsRef: (() => void) | null = null;
let sidebarFetchEbpRef: (() => void) | null = null;

export const ChatSidebar = ({ onSelectChat, selectedChat }: ChatSidebarProps) => {
    const { config } = useConfig();
    const [contacts, setContacts] = useState<SidebarContact[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifEnabled, setNotifEnabled] = useState(() =>
        typeof Notification !== 'undefined' && Notification.permission === 'granted'
    );
    const [loading, setLoading] = useState(true);
    const [readTimestamps, setReadTimestamps] = useState<Map<string, string>>(() => loadReadTimestamps());
    const [showUnreadOnly, setShowUnreadOnly] = useState(false);
    const [showAiOffOnly, setShowAiOffOnly] = useState(false);
    const [_contactsMap, setContactsMap] = useState<Map<string, ContactEbp>>(new Map());
    // Ref so fetchContacts closure always sees the latest selected chat without re-creating
    const selectedChatRef = useRef(selectedChat);
    useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);
    // Ref so fetchContacts always reads the latest timestamps without being a dependency
    const readTimestampsRef = useRef(readTimestamps);
    useEffect(() => { readTimestampsRef.current = readTimestamps; }, [readTimestamps]);
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [tagManagerOpen, setTagManagerOpen] = useState(false);
    const [tagManagerContactId, setTagManagerContactId] = useState<string | undefined>();
    const [tagManagerContactTags, setTagManagerContactTags] = useState<number[]>([]);

    // Fetch tags
    const fetchTags = useCallback(async () => {
        const { data } = await supabase.from(config.tableTags).select('*');
        if (data) setAllTags(data as Tag[]);
    }, [config.tableTags]);

    // Fetch contacts from contacts.ebp
    const fetchContactsEbp = useCallback(async () => {
        const { data } = await supabase.from(config.tableContacts).select('*');
        if (data) {
            const map = new Map<string, ContactEbp>();
            (data as ContactEbp[]).forEach(c => map.set(String(c.id), c));
            setContactsMap(map);
        }
    }, []);

    const fetchContacts = useCallback(async () => {
        const PAGE_SIZE = 1000;

        // Phase 1: recent messages (unread counts + previews for active contacts)
        // + full contacts list in parallel.
        const [page1, page2, ebpResult] = await Promise.all([
            supabase
                .from(config.tableMessages)
                .select('id, from, to, text, type, created_at')
                .order('created_at', { ascending: false })
                .range(0, PAGE_SIZE - 1),
            supabase
                .from(config.tableMessages)
                .select('id, from, to, text, type, created_at')
                .order('created_at', { ascending: false })
                .range(PAGE_SIZE, PAGE_SIZE * 2 - 1),
            supabase.from(config.tableContacts).select('*'),
        ]);

        const msgs: WhatsAppMessage[] = [
            ...((page1.data ?? []) as WhatsAppMessage[]),
            ...((page2.data ?? []) as WhatsAppMessage[]),
        ];

        // Build contacts lookup
        const ebpMap = new Map<string, ContactEbp>();
        if (ebpResult.data) {
            (ebpResult.data as ContactEbp[]).forEach(c => ebpMap.set(String(c.id), c));
            setContactsMap(ebpMap);
        }

        // Group recent messages per contact
        const msgsByContact = new Map<string, WhatsAppMessage[]>();
        msgs.forEach((msg) => {
            const contactId = getContactId(msg);
            if (!contactId) return;
            if (!msgsByContact.has(contactId)) msgsByContact.set(contactId, []);
            msgsByContact.get(contactId)!.push(msg);
        });

        // Phase 2: for contacts not covered by the recent window, fetch their
        // last message individually. These are small limit-1 queries fired in parallel.
        const staleIds = Array.from(ebpMap.keys()).filter(id => !msgsByContact.has(id));
        if (staleIds.length > 0) {
            const staleResults = await Promise.allSettled(
                staleIds.map(id =>
                    supabase
                        .from(config.tableMessages)
                        .select('id, from, to, text, type, created_at')
                        .or(`from.eq.${id},to.eq.${id}`)
                        .order('created_at', { ascending: false })
                        .limit(1)
                )
            );
            staleResults.forEach((result, i) => {
                if (result.status === 'fulfilled' && result.value.data?.length) {
                    const msg = result.value.data[0] as WhatsAppMessage;
                    msgsByContact.set(staleIds[i], [msg]);
                }
            });
        }

        const contactMap = new Map<string, SidebarContact>();

        // Seed every contact from the contacts table
        ebpMap.forEach((ebpContact, contactId) => {
            contactMap.set(contactId, {
                id: contactId,
                name: ebpContact.name_WA || null,
                lastMessage: '',
                lastMessageTime: '1970-01-01T00:00:00.000Z',
                lastMessageIsOutgoing: false,
                unreadCount: 0,
                tags: ebpContact.tags || [],
                aiEnabled: ebpContact.AI_replies === 'true',
            });
        });

        // Overlay message data for all contacts that have messages
        msgsByContact.forEach((contactMsgs, contactId) => {
            const newest = contactMsgs[0];
            const ebpContact = ebpMap.get(contactId);

            const isActiveChat = selectedChatRef.current === contactId;
            const lastReadAt = isActiveChat
                ? new Date().toISOString()
                : (readTimestampsRef.current.get(contactId) ?? '1970-01-01T00:00:00.000Z');

            const lastMsgIsOutgoing = !newest.from || !/^\d+$/.test(newest.from);

            const unreadCount = (isActiveChat || lastMsgIsOutgoing) ? 0 : contactMsgs.filter(m => {
                const isIncoming = m.from && /^\d+$/.test(m.from);
                return isIncoming && m.created_at > lastReadAt;
            }).length;

            contactMap.set(contactId, {
                id: contactId,
                name: ebpContact?.name_WA || null,
                lastMessage: newest.text || (newest.type === 'audio' ? '🎤 Voice message' : '📷 Media'),
                lastMessageTime: newest.created_at,
                lastMessageIsOutgoing: lastMsgIsOutgoing,
                unreadCount,
                tags: ebpContact?.tags || [],
                aiEnabled: ebpContact?.AI_replies === 'true',
            });
        });

        const sortedContacts = Array.from(contactMap.values()).sort(
            (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
        );

        setContacts(sortedContacts);
        setLoading(false);
    }, []);

    // When a chat is opened: immediately record the current time as lastReadAt for
    // that contact, zero out their badge in the sidebar, and persist to localStorage.
    // No API call needed — timestamp comparison handles everything.
    useEffect(() => {
        if (!selectedChat) return;

        const now = new Date().toISOString();

        // 1. Persist timestamp
        setReadTimestamps(prev => {
            const next = new Map(prev);
            next.set(selectedChat, now);
            saveReadTimestamps(next);
            return next;
        });

        // 2. Zero out badge instantly in existing contacts state (no refetch)
        setContacts(prev =>
            prev.map(c => c.id === selectedChat ? { ...c, unreadCount: 0 } : c)
        );
    }, [selectedChat]);

    useEffect(() => {
        fetchContactsEbp();
        fetchTags();
    }, [fetchContactsEbp, fetchTags]);

    // Refs so realtime callbacks always read latest state without re-subscribing
    const fetchContactsRef = useRef(fetchContacts);
    fetchContactsRef.current = fetchContacts;
    const fetchContactsEbpRef = useRef(fetchContactsEbp);
    fetchContactsEbpRef.current = fetchContactsEbp;
    const contactsRef = useRef<SidebarContact[]>([]);
    useEffect(() => { contactsRef.current = contacts; }, [contacts]);

    useEffect(() => {
        fetchContactsRef.current();

        // Module-level singleton channels — created once, survive StrictMode
        if (!sidebarMsgChannel) {
            sidebarMsgChannel = supabase
                .channel('sidebar-messages')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: config.tableMessages },
                    (payload: any) => {
                        if (payload.eventType === 'INSERT') {
                            // Update sidebar state locally — no round-trip to server.
                            // This is the key perf win: avoids re-fetching 2000 rows
                            // on every incoming/outgoing message.
                            const msg = payload.new as WhatsAppMessage;
                            const contactId = getContactId(msg);
                            if (!contactId) return;

                            const isIncoming = msg.from && /^\d+$/.test(msg.from);
                            const isOutgoing = !isIncoming;
                            const isActive = selectedChatRef.current === contactId;
                            const lastReadAt = readTimestampsRef.current.get(contactId) ?? '1970-01-01T00:00:00.000Z';
                            const isUnread = isIncoming && !isActive && msg.created_at > lastReadAt;

                            setContacts(prev => {
                                const existing = prev.find(c => c.id === contactId);
                                const preview = msg.text || (msg.type === 'audio' ? '🎤 Voice message' : '📷 Media');
                                if (existing) {
                                    return prev.map(c => c.id === contactId ? {
                                        ...c,
                                        lastMessage: preview,
                                        lastMessageTime: msg.created_at,
                                        lastMessageIsOutgoing: isOutgoing,
                                        // Outgoing message clears the unread badge (we sent last = we've seen it)
                                        unreadCount: isOutgoing ? 0 : isUnread ? c.unreadCount + 1 : c.unreadCount,
                                    } : c);
                                }
                                // Brand-new contact — do a full refetch to get their name/tags
                                sidebarFetchContactsRef?.();
                                return prev;
                            });
                        } else {
                            // UPDATE or DELETE: full refetch (rare)
                            sidebarFetchContactsRef?.();
                        }
                    }
                )
                .subscribe((status) => {
                    console.log('[Realtime] sidebar-messages status:', status);
                    if (status === 'SUBSCRIBED') sidebarFetchContactsRef?.();
                });
        }

        if (!sidebarContactChannel) {
            sidebarContactChannel = supabase
                .channel('sidebar-contacts')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: config.tableContacts },
                    () => { sidebarFetchEbpRef?.(); sidebarFetchContactsRef?.(); }
                )
                .subscribe((status) => {
                    console.log('[Realtime] sidebar-contacts status:', status);
                });
        }

        // Keep the module-level refs pointing to latest functions
        sidebarFetchContactsRef = () => fetchContactsRef.current();
        sidebarFetchEbpRef = () => fetchContactsEbpRef.current();

        // RESILIENCE: Refetch when tab becomes visible (WebSocket may have died)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchContactsRef.current();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        // RESILIENCE: Refetch when network comes back
        const onOnline = () => fetchContactsRef.current();
        window.addEventListener('online', onOnline);

        // Safety-net poll every 60s for both messages and contacts
        const safetyPoll = setInterval(() => {
            fetchContactsRef.current();
        }, 60000);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('online', onOnline);
            clearInterval(safetyPoll);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [selectedTagFilter, setSelectedTagFilter] = useState<number | null>(null);

    // Count of chats with at least one unread message (not total message count)
    const totalUnreadChats = contacts.filter(c => c.unreadCount > 0).length;

    const filteredContacts = contacts
        .filter((c) => {
            const textMatch = !searchQuery || (
                c.id.includes(searchQuery) ||
                c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.lastMessage?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (c.tags && c.tags.some(tagId => {
                    const tag = allTags.find(t => t.id === tagId);
                    return tag?.['tag name']?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false;
                }))
            );
            const tagMatch = !selectedTagFilter || (c.tags && c.tags.includes(selectedTagFilter));
            const unreadMatch = !showUnreadOnly || c.unreadCount > 0;
            const aiOffMatch = !showAiOffOnly || !c.aiEnabled;
            return textMatch && tagMatch && unreadMatch && aiOffMatch;
        })
        // Sort purely by last message time — same as native WhatsApp.
        // Unread chats stay in their chronological position; only the visual
        // treatment (badge, bold, tint, border) distinguishes them.
        .sort((a, b) => {
            return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
        });

    const formatTime = (timestamp: string) => {
        try {
            if (!timestamp || timestamp.startsWith('1970')) return '';
            const date = new Date(timestamp);
            const now = new Date();
            const isToday = date.toDateString() === now.toDateString();
            if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch { return ''; }
    };

    const getTagById = (tagId: number) => allTags.find(t => t.id === tagId);

    const openTagManagerForContact = (e: React.MouseEvent, contactId: string, contactTagIds: number[]) => {
        e.stopPropagation();
        setTagManagerContactId(contactId);
        setTagManagerContactTags(contactTagIds);
        setTagManagerOpen(true);
    };

    const openTagManagerGlobal = () => {
        setTagManagerContactId(undefined);
        setTagManagerContactTags([]);
        setTagManagerOpen(true);
    };

    const handleTagsChanged = () => {
        fetchTags();
        fetchContactsEbp();
    };

    return (
        <>
            <div className="w-full h-full border-r border-slate-200 flex flex-col" style={{ backgroundColor: 'var(--color-sidebar-bg)' }}>
                {/* Header */}
                <div className="px-3 sm:px-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))', paddingBottom: '0.5rem', backgroundColor: 'var(--color-sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <img
                            src={config.sidebarLogoUrl}
                            alt={config.appName}
                            className="w-8 h-8 rounded-full object-cover border border-slate-200"
                        />
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-900 text-sm leading-tight">{config.appName}</span>
                            <span className="text-slate-500 font-medium text-[10px]">{config.sidebarSubtitle}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={async () => {
                                if (!isPushSupported()) {
                                    alert('Notifications require adding this app to your home screen.');
                                    return;
                                }
                                const success = await subscribeToPush();
                                if (success) setNotifEnabled(true);
                            }}
                            className={`p-1.5 rounded-full hover:bg-slate-100 transition-colors ${notifEnabled ? 'text-[var(--color-primary)]' : 'text-slate-400 hover:text-[var(--color-primary)] animate-pulse'
                                }`}
                            title={notifEnabled ? 'Notifications enabled' : 'Enable notifications'}
                        >
                            {notifEnabled ? <BellRing size={16} /> : <Bell size={16} />}
                        </button>
                        <button onClick={openTagManagerGlobal} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-[var(--color-primary)] transition-colors" title="Manage Tags">
                            <TagIcon size={16} />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="p-2 sm:p-3 flex-shrink-0 bg-slate-50/50">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search chats..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                            />
                        </div>
                        {/* Unread filter toggle */}
                        <button
                            onClick={() => setShowUnreadOnly(v => !v)}
                            title={showUnreadOnly ? 'Show all chats' : 'Show unread only'}
                            className="relative flex-shrink-0 p-2 rounded-lg border transition-all"
                            style={showUnreadOnly ? {
                                backgroundColor: 'var(--color-accent)',
                                borderColor: 'var(--color-accent)',
                                color: '#fff',
                            } : {
                                backgroundColor: '#fff',
                                borderColor: '#e2e8f0',
                                color: '#94a3b8',
                            }}
                        >
                            <MessageSquare size={16} />
                            {totalUnreadChats > 0 && !showUnreadOnly && (
                                <span
                                    className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                                    style={{ backgroundColor: 'var(--color-accent)' }}
                                >
                                    {totalUnreadChats > 99 ? '99+' : totalUnreadChats}
                                </span>
                            )}
                        </button>
                        {/* AI Off filter toggle */}
                        <button
                            onClick={() => setShowAiOffOnly(v => !v)}
                            title={showAiOffOnly ? 'Show all chats' : 'Show AI-off contacts only'}
                            className="flex-shrink-0 p-2 rounded-lg border transition-all text-[10px] font-bold leading-none"
                            style={showAiOffOnly ? {
                                backgroundColor: '#64748b',
                                borderColor: '#64748b',
                                color: '#fff',
                            } : {
                                backgroundColor: '#fff',
                                borderColor: '#e2e8f0',
                                color: '#94a3b8',
                            }}
                        >
                            AI
                        </button>
                    </div>

                    {/* Filter chips row: Unread label + AI Off + tag chips */}
                    {(showUnreadOnly || showAiOffOnly || allTags.length > 0) && (
                        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1 scrollbar-hide">
                            {showUnreadOnly && (
                                <button
                                    onClick={() => setShowUnreadOnly(false)}
                                    className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white flex items-center gap-1"
                                    style={{ backgroundColor: 'var(--color-accent)' }}
                                >
                                    Unread {totalUnreadChats > 0 ? `(${totalUnreadChats})` : ''} ×
                                </button>
                            )}
                            {showAiOffOnly && (
                                <button
                                    onClick={() => setShowAiOffOnly(false)}
                                    className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white flex items-center gap-1"
                                    style={{ backgroundColor: '#64748b' }}
                                >
                                    AI Off ×
                                </button>
                            )}
                            {allTags.map(tag => (
                                <button
                                    key={tag.id}
                                    onClick={() => setSelectedTagFilter(selectedTagFilter === tag.id ? null : tag.id)}
                                    className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all"
                                    style={selectedTagFilter === tag.id ? {
                                        backgroundColor: tag['tag hex'] || '#10b981',
                                        color: '#fff',
                                    } : {
                                        backgroundColor: `${tag['tag hex']}15`,
                                        color: tag['tag hex'] || '#64748b',
                                        border: `1px solid ${tag['tag hex']}30`,
                                    }}
                                >
                                    {tag['tag name']}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Contact List */}
                <PullToRefresh onRefresh={fetchContacts} className="flex-1 min-h-0">
                    {loading ? (
                        <div className="text-center text-xs py-6 animate-pulse" style={{ color: 'var(--color-accent)' }}>Scanning...</div>
                    ) : filteredContacts.length === 0 ? (
                        <div className="text-center text-slate-400 text-xs py-10 px-4">
                            No conversations match your search
                        </div>
                    ) : (
                        filteredContacts.map((contact) => {
                            const color = getAvatarColor(contact.id);
                            return (
                                <button
                                    key={contact.id}
                                    onClick={() => onSelectChat(contact.id)}
                                    className="mx-2 my-1 p-2.5 sm:p-3 flex items-center gap-3 transition-all cursor-pointer rounded-xl select-none active:scale-[0.98] active:opacity-80"
                                    style={{
                                        width: 'calc(100% - 1rem)',
                                        border: selectedChat === contact.id
                                            ? `1px solid ${config.colorPrimary}50`
                                            : contact.unreadCount > 0
                                                ? `1px solid ${config.colorAccent}50`
                                                : `1px solid ${config.colorAccent}25`,
                                        backgroundColor: selectedChat === contact.id
                                            ? `${config.colorPrimary}18`
                                            : contact.unreadCount > 0
                                                ? `${config.colorAccent}14`
                                                : '#f8fafc',
                                    }}
                                >
                                    {/* Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <div
                                            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-semibold text-sm sm:text-base shadow-sm"
                                            style={{
                                                background: `linear-gradient(135deg, ${color.from}, ${color.to})`
                                            }}
                                        >
                                            {contact.name?.[0]?.toUpperCase() || <User size={18} />}
                                        </div>
                                        {contact.unreadCount > 0 && selectedChat !== contact.id && (
                                            <div className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-sm z-10" style={{ backgroundColor: 'var(--color-accent)' }}>
                                                {contact.unreadCount}
                                            </div>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <span className="font-semibold text-slate-900 truncate text-sm sm:text-base text-left">
                                                {contact.name || `+${contact.id}`}
                                            </span>
                                            <span className={`text-[9px] sm:text-[10px] ml-1.5 flex-shrink-0 ${contact.unreadCount > 0 && selectedChat !== contact.id ? 'text-[var(--color-primary)] font-bold' : 'text-slate-400'}`}>
                                                {formatTime(contact.lastMessageTime)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <p className={`text-xs truncate flex-1 text-left flex items-center gap-1 ${contact.unreadCount > 0 && selectedChat !== contact.id ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
                                                {contact.lastMessageIsOutgoing && contact.lastMessage && (
                                                    <CheckCheck size={12} className="flex-shrink-0" style={{ color: 'var(--color-primary)', opacity: 0.7 }} />
                                                )}
                                                <span className={`truncate ${!contact.lastMessage ? 'italic text-slate-300' : ''}`}>
                                                    {contact.lastMessage || 'No messages yet'}
                                                </span>
                                            </p>
                                        </div>
                                        {/* Tags Display + Assign Button */}
                                        <div className="flex items-center gap-1 mt-1.5">
                                            <div className="flex flex-wrap gap-1 flex-1">
                                                {contact.tags && contact.tags.length > 0 && contact.tags.map(tagId => {
                                                    const tag = getTagById(tagId);
                                                    if (!tag) return null;
                                                    return (
                                                        <span
                                                            key={tag.id}
                                                            className="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-medium leading-none"
                                                            style={{
                                                                backgroundColor: `${tag['tag hex']}15`,
                                                                color: tag['tag hex'] || '#ef4444',
                                                                border: `1px solid ${tag['tag hex']}30`
                                                            }}
                                                        >
                                                            {tag['tag name']}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                            <button
                                                onClick={(e) => openTagManagerForContact(e, contact.id, contact.tags || [])}
                                                className="p-0.5 rounded text-slate-300 hover:text-[var(--color-primary)] transition-colors flex-shrink-0"
                                                title="Assign tags"
                                            >
                                                <TagIcon size={12} />
                                            </button>
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </PullToRefresh>

                {/* Footer */}
                <div className="hidden sm:flex h-8 px-4 items-center justify-center border-t border-slate-100 flex-shrink-0" style={{ backgroundColor: 'var(--color-sidebar-bg)' }}>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{config.footerText}</span>
                </div>
            </div>

            {/* Tag Manager Modal */}
            <TagManager
                isOpen={tagManagerOpen}
                onClose={() => setTagManagerOpen(false)}
                onTagsChanged={handleTagsChanged}
                contactId={tagManagerContactId}
                contactTags={tagManagerContactTags}
            />
        </>
    );
};
