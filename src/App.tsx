import { useState, useEffect, useRef, useCallback, Component } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatHeader } from './components/ChatHeader';
import { NeuralFeed } from './components/NeuralFeed';
import { OutboundHub } from './components/OutboundHub';
import { AdminConfig } from './pages/AdminConfig';
import { useMessages } from './hooks/useMessages';
import { useConfig } from './context/ConfigContext';
import { registerServiceWorker } from './lib/pushNotifications';

// Local error boundary scoped to the chat feed area.
// If NeuralFeed crashes (bad message data, render error) this shows an
// inline error + retry instead of leaving the chat area silently white.
class ChatFeedBoundary extends Component<
    { children: React.ReactNode; chatKey: string },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    componentDidCatch(error: Error) { console.error('[ChatFeedBoundary]', error); }
    // Reset when the selected chat changes so switching contacts retries
    componentDidUpdate(prev: { chatKey: string }) {
        if (prev.chatKey !== this.props.chatKey && this.state.error) {
            this.setState({ error: null });
        }
    }
    render() {
        if (this.state.error) {
            return (
                <div className="flex-1 flex items-center justify-center px-6" style={{ backgroundColor: 'var(--color-chat-bg)' }}>
                    <div className="text-center bg-white rounded-2xl border border-red-100 shadow-sm px-6 py-8 max-w-xs w-full">
                        <p className="text-red-500 font-semibold text-sm mb-1">Chat failed to load</p>
                        <p className="text-slate-400 text-xs mb-4 font-mono break-words">{this.state.error?.message}</p>
                        <button
                            onClick={() => this.setState({ error: null })}
                            className="px-4 py-2 rounded-xl text-white text-sm font-semibold"
                            style={{ backgroundColor: 'var(--color-primary)' }}
                        >
                            Retry
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

function App() {
    const [selectedChat, setSelectedChat] = useState<string | null>(null);
    const [showMobileChat, setShowMobileChat] = useState(false);
    const { addOptimisticMessage, refetch, setContactId } = useMessages();
    const rootRef = useRef<HTMLDivElement>(null);
    // Ref so the popstate listener always reads the latest value without re-subscribing
    const showMobileChatRef = useRef(false);
    // Snapshot of selectedChat readable inside async callbacks without stale closure
    const selectedChatRef = useRef<string | null>(null);
    // Guard: prevent handleBack from firing more than once per navigation.
    const isNavigatingBackRef = useRef(false);

    useEffect(() => {
        showMobileChatRef.current = showMobileChat;
    }, [showMobileChat]);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

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
            const h = Math.round(vv.height);
            // Guard: never set --vv-height to 0 — this collapses the root container
            // to 0px and causes a silent white screen. Can happen during rotation or
            // Android keyboard flicker when the viewport briefly reports height=0.
            if (h > 100) {
                document.documentElement.style.setProperty('--vv-height', `${h}px`);
            }
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
        // Guard: drop second call if already mid-navigation (swipe + hardware-back race)
        if (isNavigatingBackRef.current) return;
        isNavigatingBackRef.current = true;
        setShowMobileChat(false);
        // Snapshot which chat we're leaving so the timeout doesn't accidentally
        // clear a NEW chat the user taps during the 230ms slide animation.
        const chatBeingLeft = selectedChatRef.current;
        setTimeout(() => {
            // Only null out selectedChat if the user hasn't opened a different one
            // during the animation. If they did, leave their new selection intact.
            setSelectedChat(prev => prev === chatBeingLeft ? null : prev);
            // Do NOT call setContactId(null) here — it races with setContactId(newId)
            // from handleSelectChat and wipes the new contact's fetch, leaving
            // NeuralFeed with loading=false + empty messages = white screen.
            isNavigatingBackRef.current = false;
        }, 230);
    }, []);

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
                // Call handleBack() directly — no async history.back() roundtrip.
                // replaceState clears the mobileChat flag synchronously so the
                // popstate listener doesn't fire handleBack() a second time.
                if (window.history.state?.mobileChat) {
                    window.history.replaceState({}, '');
                }
                handleBack();
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
                            <ChatFeedBoundary chatKey={selectedChat}>
                                <NeuralFeed key={selectedChat} selectedChat={selectedChat} />
                            </ChatFeedBoundary>
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
