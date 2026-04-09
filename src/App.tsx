import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatHeader } from './components/ChatHeader';
import { NeuralFeed } from './components/NeuralFeed';
import { OutboundHub } from './components/OutboundHub';
import { AdminConfig } from './pages/AdminConfig';
import { useMessages } from './hooks/useMessages';
import { useConfig } from './context/ConfigContext';
import { registerServiceWorker } from './lib/pushNotifications';

function App() {
    const [selectedChat, setSelectedChat] = useState<string | null>(null);
    const [showMobileChat, setShowMobileChat] = useState(false);
    const { addOptimisticMessage, refetch, setContactId } = useMessages();
    const rootRef = useRef<HTMLDivElement>(null);
    // Ref so the popstate listener always reads the latest value without re-subscribing
    const showMobileChatRef = useRef(false);

    useEffect(() => {
        showMobileChatRef.current = showMobileChat;
    }, [showMobileChat]);

    useEffect(() => {
        registerServiceWorker();
    }, []);

    // Fix: on Android devices that use keyboard-overlay mode (Samsung, etc.) the
    // viewport does NOT shrink when the keyboard appears, so fixed/flex-bottom elements
    // are hidden under the keyboard. visualViewport.height always reflects the truly
    // visible area above the keyboard on ALL devices (both resize and overlay modes).
    // Setting --vv-height lets the root container match the visible area exactly.
    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        const update = () => {
            // iOS Safari scrolls the layout viewport (offsetTop > 0) to center the
            // focused input when the keyboard opens. Reset that scroll so our app
            // doesn't jump — the visual viewport height already accounts for the keyboard.
            if (vv.offsetTop > 0) {
                window.scrollTo(0, 0);
            }
            document.documentElement.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
        };

        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        update(); // set initial value

        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
        };
    }, []);

    const handleSelectChat = (contactId: string) => {
        setSelectedChat(contactId);
        setContactId(contactId);
        setShowMobileChat(true);
        // Push a history entry so the Android hardware back button returns to the
        // sidebar instead of exiting the PWA entirely.
        if (window.innerWidth < 768) {
            window.history.pushState({ mobileChat: true }, '');
        }
    };

    // Pure state reset — does NOT touch history (called by popstate handler too).
    // selectedChat is cleared AFTER the slide animation finishes (220ms) so the
    // NeuralFeed stays mounted and visible during the back-slide — no content flicker.
    const handleBack = useCallback(() => {
        setShowMobileChat(false);
        setContactId(null);
        setTimeout(() => setSelectedChat(null), 230);
    }, [setContactId]);

    // Used by in-app back button and swipe gesture.
    // If we pushed a history entry when opening the chat, pop it — this triggers
    // the popstate handler which calls handleBack(). Otherwise call directly.
    const handleBackButton = useCallback(() => {
        if (window.history.state?.mobileChat) {
            window.history.back(); // → fires popstate → handleBack()
        } else {
            handleBack();
        }
    }, [handleBack]);

    // Android hardware back button: intercept popstate and go back to sidebar
    useEffect(() => {
        const onPopState = () => {
            if (showMobileChatRef.current) {
                handleBack();
            }
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [handleBack]);

    const handleMessageSent = () => {
        // Realtime subscription handles this automatically
    };

    // Edge swipe-right to go back (mobile only)
    useEffect(() => {
        const EDGE_ZONE = 30;      // px from left edge to start swipe
        const MIN_SWIPE = 80;      // min horizontal distance to trigger
        let startX = 0;
        let startY = 0;
        let isEdgeSwipe = false;

        const onTouchStart = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (touch.clientX <= EDGE_ZONE) {
                startX = touch.clientX;
                startY = touch.clientY;
                isEdgeSwipe = true;
            } else {
                isEdgeSwipe = false;
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!isEdgeSwipe) return;
            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = Math.abs(touch.clientY - startY);

            if (deltaX > MIN_SWIPE && deltaX > deltaY * 1.5) {
                handleBackButton(); // pops history + resets state
            }
            isEdgeSwipe = false;
        };

        const el = rootRef.current;
        if (el) {
            el.addEventListener('touchstart', onTouchStart, { passive: true });
            el.addEventListener('touchend', onTouchEnd, { passive: true });
        }

        return () => {
            if (el) {
                el.removeEventListener('touchstart', onTouchStart);
                el.removeEventListener('touchend', onTouchEnd);
            }
        };
    }, [handleBackButton]);

    return (
        <Routes>
            {/* TODO: Add auth guard */}
            <Route path="/adminconfiguration" element={<AdminConfig />} />
            <Route path="*" element={<ChatApp rootRef={rootRef} selectedChat={selectedChat} showMobileChat={showMobileChat} handleSelectChat={handleSelectChat} handleBack={handleBackButton} handleMessageSent={handleMessageSent} addOptimisticMessage={addOptimisticMessage} refetch={refetch} />} />
        </Routes>
    );
}

interface ChatAppProps {
    rootRef: React.RefObject<HTMLDivElement>;
    selectedChat: string | null;
    showMobileChat: boolean;
    handleSelectChat: (id: string) => void;
    handleBack: () => void;
    handleMessageSent: () => void;
    addOptimisticMessage: (msg: any) => any;
    refetch: () => Promise<void>;
}

function ChatApp({ rootRef, selectedChat, showMobileChat, handleSelectChat, handleBack, handleMessageSent, addOptimisticMessage, refetch }: ChatAppProps) {
    const { config } = useConfig();
    return (
        <div ref={rootRef} className="w-full overflow-hidden" style={{ height: 'var(--vv-height, 100%)', backgroundColor: 'var(--color-chat-bg)' }}>
            {/* 
              Mobile: Sliding container (200vw width)
              Desktop: Normal Flex container (100% width)
            */}
            <div
                className="flex h-full md:transform-none md:w-full"
                style={{
                    width: window.innerWidth < 768 ? '200vw' : '100%',
                    transform: window.innerWidth < 768
                        ? (showMobileChat ? 'translateX(-50%)' : 'translateX(0)')
                        : 'none',
                    // WhatsApp-style slide: fast attack (200ms), spring-like cubic-bezier
                    transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                    willChange: 'transform',
                }}
            >
                {/* Sidebar: 50% width on mobile (1 screen), fixed width on desktop */}
                <div className="w-[50%] md:w-80 lg:w-96 h-full flex-shrink-0">
                    <ChatSidebar
                        onSelectChat={handleSelectChat}
                        selectedChat={selectedChat}
                    />
                </div>

                {/* Chat Area: 50% width on mobile (1 screen), flex-1 on desktop */}
                <div className="w-[50%] md:flex-1 h-full flex flex-col min-w-0" style={{ backgroundColor: 'var(--color-chat-bg)' }}>
                    {selectedChat ? (
                        <>
                            <ChatHeader
                                contactId={selectedChat}
                                onBack={handleBack}
                                showBackButton={true}
                                onChatDeleted={refetch}
                            />
                            <NeuralFeed key={selectedChat} selectedChat={selectedChat} />
                            <OutboundHub
                                recipientId={selectedChat}
                                onMessageSent={handleMessageSent}
                                addOptimisticMessage={addOptimisticMessage}
                            />
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-chat-bg)' }}>
                            <div className="text-center px-4">
                                <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center border border-slate-100" style={{ backgroundColor: `${config.colorPrimary}18` }}>
                                    <svg viewBox="0 0 24 24" width="40" style={{ color: 'var(--color-primary)' }} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                    </svg>
                                </div>
                                <h2 className="text-slate-900 text-2xl font-bold mb-2">{config.appName}</h2>
                                <p className="text-slate-500 text-sm">Select a conversation to get started</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
