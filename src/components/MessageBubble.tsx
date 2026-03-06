import { useState } from 'react';
import { WhatsAppMessage, isOutgoing } from '../types';
import { AudioPlayer } from './ui/AudioPlayer';
import { CheckCheck, Clock, X, Download, ZoomIn, ImageIcon } from 'lucide-react';

interface MessageBubbleProps {
    message: WhatsAppMessage;
    allMessages?: WhatsAppMessage[];
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function renderTextWithLinks(text: string) {
    const parts = text.split(URL_REGEX);
    return parts.map((part, i) =>
        URL_REGEX.test(part) ? (
            <a
                key={i}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="underline break-all"
                style={{ color: 'var(--color-primary)' }}
                onClick={e => e.stopPropagation()}
            >
                {part}
            </a>
        ) : part
    );
}

export const MessageBubble = ({ message, allMessages }: MessageBubbleProps) => {
    const isOwn = isOutgoing(message);
    const [showImageModal, setShowImageModal] = useState(false);

    const repliedTo = message.is_reply === 'true' && message.reply_to_mid && allMessages
        ? allMessages.find(m => m.mid === message.reply_to_mid) ?? null
        : null;

    const isRTL = message.text && /[\u0600-\u06FF]/.test(message.text);

    const formatTime = (timestamp: string) => {
        try {
            return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    };

    const handleDownload = async () => {
        if (!message.media_url) return;
        try {
            const response = await fetch(message.media_url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `image_${message.id || Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch {
            window.open(message.media_url, '_blank');
        }
    };

    return (
        <>
            <div className={`flex w-full px-2 sm:px-0 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div
                    className={`
            relative max-w-[85%] sm:max-w-[75%] md:max-w-[65%] px-3 py-2 rounded-2xl shadow-sm
            ${isOwn
                            ? 'text-slate-900 border rounded-br-sm'
                            : 'text-slate-900 border border-slate-100 rounded-bl-sm'
                        }
          `}
                    style={{
                        backgroundColor: isOwn ? 'var(--color-outgoing-bubble)' : 'var(--color-incoming-bubble)',
                        borderColor: isOwn ? 'var(--color-outgoing-bubble)' : undefined,
                    }}
                    dir={isRTL ? 'rtl' : 'ltr'}
                >
                    {/* Reply Indicator */}
                    {message.is_reply === 'true' && message.reply_to_mid && (
                        <div className="mb-2 rounded-lg bg-slate-50 border-l-2 overflow-hidden" style={{ borderColor: 'var(--color-primary)' }}>
                            {repliedTo ? (
                                repliedTo.type === 'image' && repliedTo.media_url ? (
                                    <img
                                        src={repliedTo.media_url}
                                        alt="Replied image"
                                        className="w-full max-h-24 object-cover"
                                    />
                                ) : (
                                    <p className="px-2 py-1.5 text-[11px] text-slate-500 truncate">
                                        {repliedTo.text || 'Media message'}
                                    </p>
                                )
                            ) : (
                                <div className="px-2 py-1.5 flex items-center gap-1.5">
                                    <ImageIcon size={10} className="text-slate-400 flex-shrink-0" />
                                    <span className="text-[11px] text-slate-400 italic">Original message</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Image */}
                    {message.type === 'image' && message.media_url && (
                        <div
                            className="mb-1.5 rounded-xl overflow-hidden -mx-1 -mt-1 cursor-pointer relative group border border-slate-100"
                            onClick={() => setShowImageModal(true)}
                        >
                            <img
                                src={message.media_url}
                                alt="Media"
                                className="w-full max-w-[280px] sm:max-w-sm h-auto object-cover"
                                loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <ZoomIn size={28} className="text-white drop-shadow-lg" />
                            </div>
                        </div>
                    )}

                    {/* Audio */}
                    {message.type === 'audio' && message.media_url && (
                        <div className="min-w-[200px] sm:min-w-[260px] my-1">
                            <AudioPlayer url={message.media_url} />
                        </div>
                    )}

                    {/* Video */}
                    {message.type === 'video' && message.media_url && (
                        <div className="mb-1.5 rounded-xl overflow-hidden -mx-1 -mt-1 border border-slate-100">
                            <video
                                src={message.media_url}
                                controls
                                className="w-full max-w-[280px] sm:max-w-sm h-auto"
                            />
                        </div>
                    )}

                    {/* Text */}
                    {message.text && (
                        <p className="text-[14px] sm:text-[15px] leading-relaxed whitespace-pre-wrap font-medium break-words">
                            {renderTextWithLinks(message.text)}
                        </p>
                    )}

                    {/* Timestamp & Status */}
                    <div className={`flex items-center gap-1.5 mt-1 ${isRTL ? 'justify-start' : 'justify-end'}`}>
                        <span className="text-[10px] text-slate-400 font-medium">
                            {formatTime(message.created_at)}
                        </span>
                        {isOwn && (
                            <>
                                {message.status === 'sending' && <Clock size={12} className="text-slate-400 animate-pulse" />}
                                {message.status === 'error' && <span className="text-emerald-600 text-[10px] font-bold">Retry</span>}
                                {(!message.status || message.status === 'sent') && (
                                    message.mid ? (
                                        <CheckCheck size={14} style={{ color: 'var(--color-primary)' }} />
                                    ) : (
                                        <Clock size={12} className="text-slate-300" />
                                    )
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Image Modal */}
            {showImageModal && message.media_url && (
                <div
                    className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-2 sm:p-4"
                    onClick={() => setShowImageModal(false)}
                >
                    <button
                        className="absolute top-2 right-2 sm:top-4 sm:right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                        onClick={() => setShowImageModal(false)}
                    >
                        <X size={20} />
                    </button>

                    <button
                        className="absolute top-2 left-2 sm:top-4 sm:left-4 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 shadow-lg"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDownload();
                        }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Save Image</span>
                    </button>

                    <img
                        src={message.media_url}
                        alt="Full size"
                        className="max-w-full max-h-[85vh] sm:max-h-[90vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </>
    );
};
