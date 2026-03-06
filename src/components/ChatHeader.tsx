import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, MoreVertical, User, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ContactEbp } from '../types';
import { ContactInfoPanel } from './ContactInfoPanel';
import { useConfig } from '../context/ConfigContext';

interface ChatHeaderProps {
    contactId: string | null;
    onBack?: () => void;
    showBackButton?: boolean;
    onChatDeleted?: () => void;
}

export const ChatHeader = ({ contactId, onBack, showBackButton, onChatDeleted }: ChatHeaderProps) => {
    const { config } = useConfig();
    const [contact, setContact] = useState<ContactEbp | null>(null);
    const [aiEnabled, setAiEnabled] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const fetchContact = useCallback(async () => {
        if (!contactId) return;
        const { data } = await supabase
            .from(config.tableContacts)
            .select('*')
            .eq('id', contactId)
            .single();

        if (data) {
            const c = data as ContactEbp;
            setContact(c);
            setAiEnabled(c.AI_replies === 'true');
        }
    }, [contactId]);

    useEffect(() => {
        fetchContact();
    }, [fetchContact]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
                setConfirmDelete(false);
            }
        };
        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [menuOpen]);

    const handleToggle = async () => {
        if (!contactId || toggling) return;
        setToggling(true);
        const newState = !aiEnabled;
        setAiEnabled(newState);

        await supabase
            .from(config.tableContacts)
            .update({ AI_replies: newState ? 'true' : 'false' })
            .eq('id', contactId);

        setToggling(false);
    };

    const handleDeleteChat = async () => {
        if (!contactId || deleting) return;
        setDeleting(true);

        // Delete all messages where this contact is sender or receiver
        await supabase
            .from(config.tableMessages)
            .delete()
            .or(`from.eq.${contactId},to.eq.${contactId}`);

        setDeleting(false);
        setMenuOpen(false);
        setConfirmDelete(false);

        // Navigate back and refresh messages
        onChatDeleted?.();
        onBack?.();
    };

    if (!contactId) return null;

    const displayName = contact?.name_WA || `+${contactId}`;

    return (
        <>
            <div
                className="px-2 flex items-center justify-between border-b border-slate-200 bg-white flex-shrink-0"
                style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))', paddingBottom: '0.5rem', minHeight: '52px' }}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {showBackButton && (
                        <button onClick={onBack} className="p-2 -ml-1 rounded-full hover:bg-slate-100 text-emerald-500 active:bg-slate-200">
                            <ArrowLeft size={22} />
                        </button>
                    )}

                    <button onClick={() => setInfoOpen(true)} className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm active:scale-95 transition-transform">
                        <User size={18} className="text-white" />
                    </button>

                    <button onClick={() => setInfoOpen(true)} className="min-w-0 flex-1 ml-1 text-left active:opacity-70 transition-opacity">
                        <h2 className="text-slate-900 font-bold text-sm truncate">{displayName}</h2>
                        {contact?.name_WA && (
                            <p className="text-slate-500 text-[10px] truncate">+{contactId}</p>
                        )}
                    </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Toggle Switch + AI Label */}
                    <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-bold transition-colors duration-300 ${aiEnabled ? 'text-emerald-500' : 'text-slate-400'}`}>AI</span>

                        <button
                            onClick={handleToggle}
                            disabled={toggling}
                            className="relative flex-shrink-0 self-center"
                            style={{
                                width: '38px',
                                height: '22px',
                                minHeight: '22px',
                                maxHeight: '22px',
                                borderRadius: '11px',
                                backgroundColor: aiEnabled ? '#10b981' : '#e2e8f0',
                                transition: 'background-color 0.3s',
                                border: '1.5px solid',
                                borderColor: aiEnabled ? '#10b981' : '#cbd5e1',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                style={{
                                    position: 'absolute',
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '50%',
                                    backgroundColor: '#fff',
                                    top: '1.5px',
                                    left: aiEnabled ? '18px' : '2px',
                                    transition: 'left 0.3s',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                }}
                            />
                        </button>
                    </div>

                    {/* Three-dot menu */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => { setMenuOpen(!menuOpen); setConfirmDelete(false); }}
                            className="p-2 rounded-full hover:bg-slate-100 text-slate-400"
                        >
                            <MoreVertical size={18} />
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50 modal-panel">
                                {!confirmDelete ? (
                                    <button
                                        onClick={() => setConfirmDelete(true)}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors"
                                    >
                                        <Trash2 size={16} />
                                        Delete Chat
                                    </button>
                                ) : (
                                    <div className="p-3">
                                        <p className="text-xs text-slate-600 mb-3 font-medium">Delete all messages with this contact?</p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setConfirmDelete(false)}
                                                className="flex-1 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleDeleteChat}
                                                disabled={deleting}
                                                className="flex-1 px-3 py-2 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                                            >
                                                {deleting ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {contactId && (
                <ContactInfoPanel
                    contactId={contactId}
                    isOpen={infoOpen}
                    onClose={() => setInfoOpen(false)}
                />
            )}
        </>
    );
};
