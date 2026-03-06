import { useEffect, useRef, useState } from 'react';
import { useMessages } from '../hooks/useMessages';
import { MessageBubble } from './MessageBubble';
import { MessageSquare } from 'lucide-react';
import { getContactId } from '../types';
import { useConfig } from '../context/ConfigContext';

interface NeuralFeedProps {
    selectedChat: string | null;
}

export const NeuralFeed = ({ selectedChat }: NeuralFeedProps) => {
    const { messages, loading, error } = useMessages();
    const { config } = useConfig();
    const containerRef = useRef<HTMLDivElement>(null);
    const [prevMsgCount, setPrevMsgCount] = useState(0);

    // Filter messages for selected chat
    const filteredMessages = selectedChat
        ? messages.filter((m) => getContactId(m) === selectedChat)
        : messages;

    // Smooth scroll to bottom when NEW messages arrive (not on initial load)
    useEffect(() => {
        const hasNewMessages = filteredMessages.length > prevMsgCount;

        if (hasNewMessages && prevMsgCount > 0 && containerRef.current) {
            // In column-reverse, scrollTop=0 is the bottom
            // Check if user is near bottom (scrollTop close to 0)
            const isNearBottom = Math.abs(containerRef.current.scrollTop) < 100;
            if (isNearBottom) {
                containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        setPrevMsgCount(filteredMessages.length);
    }, [filteredMessages.length, prevMsgCount]);

    if (!selectedChat) {
        return (
            <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-chat-bg)' }}>
                <div className="text-center">
                    <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-100 shadow-sm" style={{ backgroundColor: 'var(--color-outgoing-bubble)' }}>
                        <MessageSquare size={40} style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <h3 className="text-slate-900 text-2xl font-bold mb-2">{config.appName}</h3>
                    <p className="text-slate-500 text-sm max-w-xs mx-auto">
                        Ready to assist. Select a conversation to manage your outreach.
                    </p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-chat-bg)' }}>
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '0ms' }} />
                    <div className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '150ms' }} />
                    <div className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '300ms' }} />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-chat-bg)' }}>
                <div className="text-red-600 text-sm font-bold bg-red-50 px-5 py-3 rounded-xl border border-red-200 shadow-sm text-center">
                    ⚠️ {error}
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-y-auto px-4 py-6"
            style={{
                display: 'flex',
                flexDirection: 'column-reverse',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2364748b' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                backgroundColor: config.colorChatBg
            }}
        >
            {/* Single wrapper div inside column-reverse container.
                column-reverse makes scrollTop=0 the bottom of content.
                Messages inside this div are in normal chronological order. */}
            <div className="space-y-4">
                {filteredMessages.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-center bg-white/50 backdrop-blur-sm p-8 rounded-3xl border border-slate-200/50">
                            <div className="text-5xl mb-4">✨</div>
                            <p className="text-slate-500 font-medium italic">Start the conversation</p>
                        </div>
                    </div>
                ) : (
                    filteredMessages.map((msg) => (
                        <MessageBubble key={msg.id || msg.mid} message={msg} allMessages={messages} />
                    ))
                )}
            </div>
        </div>
    );
};
