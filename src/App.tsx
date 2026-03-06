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

    useEffect(() => {
        registerServiceWorker();
    }, []);

    const handleSelectChat = (contactId: string) => {
        setSelectedChat(contactId);
        setContactId(contactId);
        setShowMobileChat(true);
    };

    const handleBack = useCallback(() => {
        setShowMobileChat(false);
        setSelectedChat(null);
        setContactId(null);
    }, [setContactId]);

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
            // Only activate when chat is showing and touch starts in edge zone
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

            // Must swipe right, far enough, and more horizontal than vertical
            if (deltaX > MIN_SWIPE && deltaX > deltaY * 1.5) {
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
    }, [handleBack]);

    return (
        <Routes>
            {/* TODO: Add auth guard */}
            <Route path="/adminconfiguration" element={<AdminConfig />} />
            <Route path="*" element={<ChatApp rootRef={rootRef} selectedChat={selectedChat} showMobileChat={showMobileChat} handleSelectChat={handleSelectChat} handleBack={handleBack} handleMessageSent={handleMessageSent} addOptimisticMessage={addOptimisticMessage} refetch={refetch} />} />
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
        <div ref={rootRef} className="w-full h-full overflow-hidden bg-white">
            {/* 
              Mobile: Sliding container (200vw width)
              Desktop: Normal Flex container (100% width)
            */}
            <div
                className="flex h-full transition-transform duration-300 ease-out md:transform-none md:w-full"
                style={{
                    // On mobile, we need 2 screens width. On desktop, we let CSS handle it (w-full).
                    width: window.innerWidth < 768 ? '200vw' : '100%',
                    transform: window.innerWidth < 768
                        ? (showMobileChat ? 'translateX(-50%)' : 'translateX(0)')
                        : 'none',
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
                <div className="w-[50%] md:flex-1 h-full flex flex-col bg-white min-w-0">
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
                        <div className="flex-1 flex items-center justify-center bg-white">
                            <div className="text-center px-4">
                                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100">
                                    <svg viewBox="0 0 24 24" width="40" className="text-emerald-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
