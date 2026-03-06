import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, MessageSquare, Calendar, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ContactEbp, Tag, WhatsAppMessage } from '../types';
import { useConfig } from '../context/ConfigContext';

interface ContactInfoPanelProps {
    contactId: string;
    isOpen: boolean;
    onClose: () => void;
}

export const ContactInfoPanel = ({ contactId, isOpen, onClose }: ContactInfoPanelProps) => {
    const { config } = useConfig();
    const [contact, setContact] = useState<ContactEbp | null>(null);
    const [tags, setTags] = useState<Tag[]>([]);
    const [contactTags, setContactTags] = useState<Tag[]>([]);
    const [messageCount, setMessageCount] = useState(0);
    const [firstMessageDate, setFirstMessageDate] = useState<string | null>(null);
    const [lastMessageDate, setLastMessageDate] = useState<string | null>(null);
    const [aiEnabled, setAiEnabled] = useState(false);
    const [toggling, setToggling] = useState(false);

    const fetchData = useCallback(async () => {
        if (!contactId) return;

        // Fetch contact
        const { data: contactData } = await supabase
            .from(config.tableContacts)
            .select('*')
            .eq('id', contactId)
            .single();

        if (contactData) {
            const c = contactData as ContactEbp;
            setContact(c);
            setAiEnabled(c.AI_replies === 'true');
        }

        // Fetch all tags
        const { data: tagData } = await supabase.from(config.tableTags).select('*');
        if (tagData) setTags(tagData as Tag[]);

        // Fetch messages for stats
        const { data: msgData } = await supabase
            .from(config.tableMessages)
            .select('*')
            .or(`from.eq.${contactId},to.eq.${contactId}`)
            .order('created_at', { ascending: true });

        if (msgData) {
            const msgs = msgData as WhatsAppMessage[];
            setMessageCount(msgs.length);
            if (msgs.length > 0) {
                setFirstMessageDate(msgs[0].created_at);
                setLastMessageDate(msgs[msgs.length - 1].created_at);
            }
        }
    }, [contactId]);

    useEffect(() => {
        if (isOpen) fetchData();
    }, [isOpen, fetchData]);

    // Resolve contact tags
    useEffect(() => {
        if (contact?.tags && tags.length > 0) {
            const resolved = (contact.tags as number[])
                .map(id => tags.find(t => t.id === id))
                .filter(Boolean) as Tag[];
            setContactTags(resolved);
        } else {
            setContactTags([]);
        }
    }, [contact, tags]);

    const handleToggleAI = async () => {
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

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '—';
        try {
            return new Date(dateStr).toLocaleDateString([], {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch { return '—'; }
    };

    if (!isOpen) return null;

    const displayName = contact?.name_WA || `+${contactId}`;

    return createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center modal-overlay" onClick={onClose}>
            <div className="w-full sm:w-[380px] max-h-[85vh] bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 flex flex-col shadow-2xl modal-panel overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* Header with avatar */}
                <div className="relative bg-gradient-to-br from-red-500 to-red-600 px-6 pt-8 pb-6 text-center">
                    <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors">
                        <X size={16} />
                    </button>
                    <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-3 border-2 border-white/30">
                        <User size={36} className="text-white" />
                    </div>
                    <h2 className="text-white font-bold text-lg">{displayName}</h2>
                    {contact?.name_WA && (
                        <p className="text-white/70 text-sm mt-0.5">+{contactId}</p>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* AI Toggle */}
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl p-4">
                        <div>
                            <p className="text-slate-900 font-semibold text-sm">AI Replies</p>
                            <p className="text-slate-500 text-xs mt-0.5">{aiEnabled ? 'AI is responding' : 'AI is paused'}</p>
                        </div>
                        <button
                            onClick={handleToggleAI}
                            disabled={toggling}
                            className="relative flex-shrink-0"
                            style={{
                                width: '44px', height: '26px', minHeight: '26px', borderRadius: '13px',
                                backgroundColor: aiEnabled ? '#ef4444' : '#e2e8f0',
                                transition: 'background-color 0.3s',
                                border: '1.5px solid', borderColor: aiEnabled ? '#ef4444' : '#cbd5e1',
                            }}
                        >
                            <div style={{
                                position: 'absolute', width: '20px', height: '20px', borderRadius: '50%',
                                backgroundColor: '#fff', top: '1.5px',
                                left: aiEnabled ? '20px' : '2px', transition: 'left 0.3s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                        </button>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-xl p-3">
                            <div className="flex items-center gap-2 mb-1">
                                <MessageSquare size={14} className="text-red-500" />
                                <span className="text-slate-500 text-xs">Messages</span>
                            </div>
                            <p className="text-slate-900 font-bold text-lg">{messageCount}</p>
                        </div>
                        <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-emerald-500"><Calendar size={14} /></span>
                                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Last Activity</span>
                            </div>
                            <p className="text-slate-900 font-bold text-sm truncate">+{contactId}</p>
                        </div>
                    </div>

                    {/* Dates */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
                            <div className="flex items-center gap-2">
                                <Calendar size={14} className="text-green-500" />
                                <span className="text-slate-500 text-xs">First message</span>
                            </div>
                            <span className="text-slate-900 text-xs font-medium">{formatDate(firstMessageDate)}</span>
                        </div>
                        <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
                            <div className="flex items-center gap-2">
                                <Calendar size={14} className="text-blue-500" />
                                <span className="text-slate-500 text-xs">Last message</span>
                            </div>
                            <span className="text-slate-900 text-xs font-medium">{formatDate(lastMessageDate)}</span>
                        </div>
                    </div>

                    {/* Tags */}
                    {contactTags.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-emerald-500"><MessageSquare size={14} /></span>
                                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Messages</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {contactTags.map(tag => (
                                    <span
                                        key={tag.id}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                        style={{
                                            backgroundColor: `${tag['tag hex']}15`,
                                            color: tag['tag hex'] || '#ef4444',
                                            border: `1px solid ${tag['tag hex']}30`
                                        }}
                                    >
                                        {tag['tag name']}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
