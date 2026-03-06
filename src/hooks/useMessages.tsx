import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { WhatsAppMessage } from '../types';
import { useConfig } from '../context/ConfigContext';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

interface MessagesContextType {
    messages: WhatsAppMessage[];
    loading: boolean;
    error: string | null;
    addOptimisticMessage: (message: Partial<WhatsAppMessage>) => WhatsAppMessage;
    refetch: () => Promise<void>;
    setContactId: (id: string | null) => void;
}

const MessagesContext = createContext<MessagesContextType | null>(null);

// Module-level singleton channel
let sharedChannel: RealtimeChannel | null = null;
let fetchRef: (() => void) | null = null;

export const MessagesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const setMessagesRef = useRef(setMessages);
    setMessagesRef.current = setMessages;

    const { config } = useConfig();
    // Capture table name at mount time for the singleton channel
    const tableMessagesRef = useRef(config.tableMessages);
    tableMessagesRef.current = config.tableMessages;

    // Ref holds the current contact ID so the singleton channel
    // and resilience callbacks always use the latest value.
    const contactIdRef = useRef<string | null>(null);

    const fetchMessages = useCallback(async (forContactId?: string | null) => {
        const id = forContactId !== undefined ? forContactId : contactIdRef.current;

        // No contact selected — nothing to fetch
        if (!id) {
            setMessages([]);
            setLoading(false);
            return;
        }

        try {
            // Do NOT setLoading(true) here — background refetches must not
            // unmount the NeuralFeed / AudioPlayer (which destroys WaveSurfer).
            // Loading is set by setContactId before calling this.
            setError(null);

            // Fetch only this contact's messages.
            // Root-cause fix: Supabase silently truncates unfiltered queries at 1000 rows.
            // Scoping to one contact makes the row limit irrelevant.
            const { data, error: fetchError } = await supabase
                .from(tableMessagesRef.current)
                .select('*')
                .or(`from.eq.${id},to.eq.${id}`)
                .order('created_at', { ascending: true });

            if (fetchError) throw fetchError;
            setMessagesRef.current((data ?? []) as WhatsAppMessage[]);
        } catch (err: unknown) {
            console.error('Fetch error:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchMessagesRef = useRef(fetchMessages);
    fetchMessagesRef.current = fetchMessages;

    const setContactId = useCallback((id: string | null) => {
        contactIdRef.current = id;
        setMessages([]); // Clear immediately on chat switch to avoid stale flash
        setLoading(true); // Show spinner only on contact switch, not background refetches
        fetchMessages(id);
    }, [fetchMessages]);

    const addOptimisticMessage = useCallback((message: Partial<WhatsAppMessage>) => {
        const newMsg: WhatsAppMessage = {
            id: message.id || Date.now(),
            type: (message.type as WhatsAppMessage['type']) || 'text',
            from: message.from ?? null,
            to: message.to ?? null,
            text: message.text ?? null,
            media_url: message.media_url ?? null,
            is_reply: message.is_reply ?? null,
            reply_to_mid: message.reply_to_mid ?? null,
            mid: message.mid ?? null,
            created_at: message.created_at || new Date().toISOString(),
            status: 'sending'
        };

        setMessages((prev) => {
            const exists = prev.some(
                (m) => m.id === newMsg.id || (m.mid && newMsg.mid && m.mid === newMsg.mid)
            );
            if (exists) return prev;
            return [...prev, newMsg];
        });

        return newMsg;
    }, []);

    useEffect(() => {
        // Keep module-level ref updated
        fetchRef = () => fetchMessagesRef.current();

        // Singleton Realtime channel
        if (!sharedChannel) {
            sharedChannel = supabase
                .channel('messages-realtime-v7')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: tableMessagesRef.current },
                    (payload: RealtimePostgresChangesPayload<WhatsAppMessage>) => {
                        const currentId = contactIdRef.current;
                        if (!currentId) return; // no chat open

                        console.log('[Realtime] message event:', payload.eventType);
                        if (payload.eventType === 'INSERT') {
                            const newMsg = payload.new as WhatsAppMessage;

                            // Only handle messages for the currently viewed contact
                            const msgContact = newMsg.from && /^\d+$/.test(newMsg.from)
                                ? newMsg.from
                                : newMsg.to;
                            if (msgContact !== currentId) return;

                            setMessagesRef.current((prev) => {
                                const existingIndex = prev.findIndex(
                                    (m) =>
                                        m.id === newMsg.id ||
                                        (m.mid && newMsg.mid && m.mid === newMsg.mid) ||
                                        // Match optimistic outgoing message that hasn't received a mid yet
                                        (m.status === 'sending' && !m.mid &&
                                            m.to === newMsg.to && m.type === newMsg.type &&
                                            (m.type !== 'text' || m.text === newMsg.text))
                                );
                                if (existingIndex !== -1) {
                                    const updated = [...prev];
                                    updated[existingIndex] = { ...newMsg, status: 'sent' };
                                    return updated;
                                }
                                return [...prev, { ...newMsg, status: 'sent' }];
                            });
                        } else if (payload.eventType === 'UPDATE') {
                            const updatedMsg = payload.new as WhatsAppMessage;
                            const msgContact = updatedMsg.from && /^\d+$/.test(updatedMsg.from)
                                ? updatedMsg.from
                                : updatedMsg.to;
                            if (msgContact !== currentId) return;

                            setMessagesRef.current((prev) =>
                                prev.map((m) =>
                                    m.id === updatedMsg.id ? { ...updatedMsg, status: 'sent' } : m
                                )
                            );
                        } else if (payload.eventType === 'DELETE') {
                            const deletedId = (payload.old as { id: number }).id;
                            setMessagesRef.current((prev) => prev.filter((m) => m.id !== deletedId));
                        }
                    }
                )
                .subscribe((status: string) => {
                    console.log('[Realtime] messages channel status:', status);
                    // On reconnect, refetch to catch any messages missed while disconnected
                    if (status === 'SUBSCRIBED') {
                        fetchRef?.();
                    }
                });
        }

        // RESILIENCE 1: Refetch when tab becomes visible again
        // (WebSocket silently dies when browser tabs sleep)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('[Realtime] Tab visible — refetching messages');
                fetchMessagesRef.current();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        // RESILIENCE 2: Refetch when network comes back online
        const onOnline = () => {
            console.log('[Realtime] Network back online — refetching messages');
            fetchMessagesRef.current();
        };
        window.addEventListener('online', onOnline);

        // RESILIENCE 3: Safety-net poll every 30s
        const safetyPoll = setInterval(() => {
            fetchMessagesRef.current();
        }, 30000);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('online', onOnline);
            clearInterval(safetyPoll);
        };
    }, [fetchMessages]);

    const value: MessagesContextType = {
        messages,
        loading,
        error,
        addOptimisticMessage,
        refetch: fetchMessages,
        setContactId,
    };

    return (
        <MessagesContext.Provider value={value}>
            {children}
        </MessagesContext.Provider>
    );
};

// Drop-in replacement for the old useMessages hook
export const useMessages = (): MessagesContextType => {
    const context = useContext(MessagesContext);
    if (!context) {
        throw new Error('useMessages must be used within a MessagesProvider');
    }
    return context;
};
