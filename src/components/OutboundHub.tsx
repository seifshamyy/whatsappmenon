import { useState, useRef, useCallback } from 'react';
import { Send, Mic, Paperclip, X, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { WhatsAppMessage } from '../types';
import { useConfig } from '../context/ConfigContext';

interface OutboundHubProps {
    recipientId: string | null;
    onMessageSent?: (message: any) => void;
    addOptimisticMessage: (message: Partial<WhatsAppMessage>) => void;
}

// ... existing constants and helper functions (generateRandomId, postToWebhook, sendWhatsAppText, etc.) ...
// NOTE: I am keeping the unchanged helper functions to save context, but in a real replace I would need to be careful not to delete them if I replaced the whole file. 
// Since I am replacing the top part, I need to ensure I don't cut off helpers if I don't include them in replacement.
// Actually, looking at the instruction, I should probably use `multi_replace` or be very careful.
// Let's look at the file again. The prompt says "Add addOptimisticMessage prop".
// I will replace the component definition and the `handleSend` function.

// ... (KEEPING CONSTANTS SAME) ...
// match lines 1-150 roughly


// Supabase Storage (infrastructure-level, not app config)
const SUPABASE_STORAGE_URL = 'https://whmbrguzumyatnslzfsq.supabase.co/storage/v1/object/public/TREE';

// Generate random ID (1 to 1 billion)
const generateRandomId = () => Math.floor(Math.random() * 1000000000) + 1;

// POST to webhook
const postToWebhook = async (mid: string, data: string, type: string, to: string, webhookUrl: string) => {
    try {
        const payload = { mid, data, type, id: generateRandomId(), to };
        console.log('Posting to webhook:', payload);
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            mode: 'no-cors'
        });
    } catch (err) {
        console.error('Webhook error:', err);
    }
};

// Send text via WhatsApp API
const sendWhatsAppText = async (to: string, text: string, apiUrl: string, token: string) => {
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: text },
        }),
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Failed to send');
    }
    return response.json();
};

// Send image via WhatsApp API
const sendWhatsAppImage = async (to: string, imageUrl: string, apiUrl: string, token: string, caption?: string) => {
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'image',
            image: { link: imageUrl, caption: caption || '' },
        }),
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Failed to send image');
    }
    return response.json();
};

// Send audio via WhatsApp API
const sendWhatsAppAudio = async (to: string, audioUrl: string, apiUrl: string, token: string) => {
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'audio',
            audio: { link: audioUrl },
        }),
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Failed to send audio');
    }
    return response.json();
};

// Upload file to Supabase Storage
const uploadToStorage = async (file: File | Blob, fileName: string): Promise<string> => {
    const { data, error } = await supabase.storage
        .from('TREE')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });

    if (error) throw new Error(`Upload failed: ${error.message}`);
    return `${SUPABASE_STORAGE_URL}/${data.path}`;
};

// Store message in database - with 'to' field
const storeMessage = async (
    type: string,
    text: string | null,
    mediaUrl: string | null,
    mid: string,
    toNumber: string,
    tableMessages: string
) => {
    const insertData = {
        type,
        text,
        media_url: mediaUrl,
        from: null, // null = sent from our account
        to: toNumber,
        is_reply: 'false',
        mid,
        created_at: new Date().toISOString(),
    };

    console.log('Storing message:', insertData);

    const { data, error } = await supabase.from(tableMessages).insert(insertData).select();

    if (error) {
        console.error('DB store failed:', error);
        throw new Error(`DB error: ${error.message}`);
    }

    console.log('Message stored:', data);
    return data?.[0];
};

export const OutboundHub = ({ recipientId, onMessageSent, addOptimisticMessage }: OutboundHubProps) => {
    const { config } = useConfig();
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [filePreviews, setFilePreviews] = useState<string[]>([]);
    const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

    // Audio recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingIntervalRef = useRef<number | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Send recorded audio - extracted as separate function
    const sendAudioMessage = useCallback(async (audioBlob: Blob) => {
        if (!recipientId) return;

        console.log('Sending audio message, blob size:', audioBlob.size);
        setSending(true);
        setError(null);

        // OPTIMISTIC UPDATE
        const tempId = Date.now();
        const objectUrl = URL.createObjectURL(audioBlob);

        addOptimisticMessage({
            id: tempId,
            type: 'audio',
            text: null,
            media_url: objectUrl,
            from: null,
            to: recipientId,
            mid: null,
            created_at: new Date().toISOString(),
            status: 'sending'
        });

        try {
            const fileName = `${generateRandomId()}_recording.ogg`;
            console.log('Uploading audio to storage...');
            const mediaUrl = await uploadToStorage(audioBlob, fileName);
            console.log('Uploaded to:', mediaUrl);

            console.log('Sending to WhatsApp...');
            const apiResponse = await sendWhatsAppAudio(recipientId, mediaUrl, config.whatsappApiUrl, config.whatsappToken);
            console.log('WhatsApp response:', apiResponse);

            const mid = apiResponse.messages?.[0]?.id || `audio_${Date.now()}`;

            console.log('Storing in database...');
            // We don't need the returned data because we already have an optimistic message
            await storeMessage('audio', null, mediaUrl, mid, recipientId, config.tableMessages);

            console.log('Posting to webhook...');
            await postToWebhook(mid, mediaUrl, 'audio', recipientId, config.webhookUrl);

            if (onMessageSent) {
                // Optional: still call this if parent needs to know, 
                // but UI should already be updated via useMessages
                onMessageSent({
                    id: tempId,
                    type: 'audio',
                    text: null,
                    media_url: mediaUrl,
                    from: null,
                    to: recipientId,
                    mid
                });
            }

            console.log('Audio message sent successfully!');
        } catch (err: any) {
            console.error('Audio send error:', err);
            setError(err.message);
            // Ideally update optimistic message status to 'error' here
            setTimeout(() => setError(null), 5000);
        } finally {
            setSending(false);
        }
    }, [recipientId, onMessageSent, addOptimisticMessage]);

    // Start audio recording
    const startRecording = async () => {
        try {
            console.log('Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // WhatsApp supports: audio/ogg, audio/mpeg, audio/amr
            // Try ogg first (best WhatsApp compatibility), then fallback
            let mimeType = 'audio/ogg;codecs=opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'audio/webm;codecs=opus';
                if (!MediaRecorder.isTypeSupported(mimeType)) {
                    mimeType = 'audio/webm';
                }
            }
            console.log('Using mime type:', mimeType);

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                console.log('Audio data available, size:', e.data.size);
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                console.log('Recording stopped, chunks:', audioChunksRef.current.length);
                stream.getTracks().forEach(track => track.stop());

                if (audioChunksRef.current.length > 0) {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg' });
                    console.log('Created audio blob, size:', audioBlob.size);
                    sendAudioMessage(audioBlob);
                } else {
                    setError('No audio recorded');
                    setTimeout(() => setError(null), 3000);
                }
            };

            mediaRecorder.start(100); // Collect data every 100ms
            setIsRecording(true);
            setRecordingTime(0);

            recordingIntervalRef.current = window.setInterval(() => {
                setRecordingTime(t => t + 1);
            }, 1000);

            console.log('Recording started');
        } catch (err: any) {
            console.error('Recording error:', err);
            setError('Microphone access denied: ' + err.message);
            setTimeout(() => setError(null), 3000);
        }
    };

    // Stop recording
    const stopRecording = () => {
        console.log('Stopping recording...');
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (recordingIntervalRef.current) {
                clearInterval(recordingIntervalRef.current);
            }
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        setSelectedFiles(prev => [...prev, ...files]);

        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    setFilePreviews(prev => [...prev, ev.target?.result as string]);
                };
                reader.readAsDataURL(file);
            } else {
                // non-image (audio file via picker): placeholder
                setFilePreviews(prev => [...prev, '']);
            }
        });

        // Reset so the same file can be re-selected if removed
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const clearFiles = () => {
        setSelectedFiles([]);
        setFilePreviews([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
        setFilePreviews(prev => prev.filter((_, i) => i !== index));
    };

    const handleSend = async () => {
        const filesToSend = selectedFiles;
        const textToSend = input.trim();

        if (!textToSend && filesToSend.length === 0) return;
        if (!recipientId) return;

        setSending(true);
        setError(null);

        const baseTime = Date.now();

        // Add all optimistic bubbles upfront so user sees them immediately
        if (filesToSend.length > 0) {
            filesToSend.forEach((file, i) => {
                const type = file.type.startsWith('image/') ? 'image' : 'audio';
                addOptimisticMessage({
                    id: baseTime + i,
                    type,
                    text: i === 0 ? (textToSend || null) : null, // caption on first only
                    media_url: URL.createObjectURL(file),
                    from: null,
                    to: recipientId,
                    mid: null,
                    created_at: new Date(baseTime + i).toISOString(),
                    status: 'sending',
                });
            });
        } else {
            addOptimisticMessage({
                id: baseTime,
                type: 'text',
                text: textToSend,
                media_url: null,
                from: null,
                to: recipientId,
                mid: null,
                created_at: new Date(baseTime).toISOString(),
                status: 'sending',
            });
        }

        // Clear UI immediately and keep keyboard up
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.focus(); // keep keyboard visible after send
        }
        clearFiles();

        try {
            if (filesToSend.length > 0) {
                // All files upload + send concurrently — no waiting for each other
                setUploadProgress({ current: 0, total: filesToSend.length });
                let completed = 0;

                const results = await Promise.allSettled(
                    filesToSend.map(async (file, i) => {
                        const fileName = `${generateRandomId()}_${file.name}`;
                        const mediaUrl = await uploadToStorage(file, fileName);
                        const caption = i === 0 ? (textToSend || undefined) : undefined;

                        let apiResponse;
                        let msgType: string;

                        if (file.type.startsWith('image/')) {
                            msgType = 'image';
                            apiResponse = await sendWhatsAppImage(recipientId, mediaUrl, config.whatsappApiUrl, config.whatsappToken, caption);
                        } else {
                            msgType = 'audio';
                            apiResponse = await sendWhatsAppAudio(recipientId, mediaUrl, config.whatsappApiUrl, config.whatsappToken);
                        }

                        const mid = apiResponse.messages?.[0]?.id || `${msgType}_${Date.now()}`;
                        await storeMessage(msgType, i === 0 ? (textToSend || null) : null, mediaUrl, mid, recipientId, config.tableMessages);
                        await postToWebhook(mid, mediaUrl, msgType, recipientId, config.webhookUrl);

                        // Update counter as each one finishes
                        completed += 1;
                        setUploadProgress({ current: completed, total: filesToSend.length });
                    })
                );

                const failed = results.filter(r => r.status === 'rejected').length;
                if (failed > 0) {
                    setError(`${failed} file${failed > 1 ? 's' : ''} failed to send`);
                    setTimeout(() => setError(null), 5000);
                }
            } else {
                const apiResponse = await sendWhatsAppText(recipientId, textToSend, config.whatsappApiUrl, config.whatsappToken);
                const mid = apiResponse.messages?.[0]?.id || `text_${Date.now()}`;
                await storeMessage('text', textToSend, null, mid, recipientId, config.tableMessages);
                await postToWebhook(mid, textToSend, 'text', recipientId, config.webhookUrl);
            }

            if (onMessageSent) onMessageSent({ id: baseTime });

        } catch (err: any) {
            console.error('Send error:', err);
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        } finally {
            setSending(false);
            setUploadProgress(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const autoResize = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (!recipientId) return null;

    return (
        <div className="border-t border-slate-200 bg-white px-2 py-2 relative flex-shrink-0 shadow-[0_-1px_3px_rgba(0,0,0,0.02)]">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
            />

            {error && (
                <div className="absolute bottom-full left-2 right-2 sm:left-4 sm:right-4 mb-2 text-white text-[11px] sm:text-xs px-4 py-2 rounded-xl z-50 shadow-lg font-bold" style={{ backgroundColor: 'var(--color-primary)' }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Recording UI */}
            {isRecording && (
                <div className="mb-2 p-2 sm:p-3 rounded-2xl flex items-center justify-between shadow-sm border" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)', borderColor: 'color-mix(in srgb, var(--color-primary) 20%, white)' }}>
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-primary)' }} />
                        <span className="font-bold text-xs sm:text-sm" style={{ color: 'var(--color-primary)' }}>{formatTime(recordingTime)}</span>
                    </div>
                    <button
                        onClick={stopRecording}
                        className="px-4 py-1.5 text-white rounded-full text-xs sm:text-sm font-bold shadow-sm"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                        Send Audio
                    </button>
                </div>
            )}

            {/* Upload progress indicator */}
            {sending && uploadProgress !== null && (
                <div className="mb-2 px-3 py-2 rounded-xl border" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 6%, white)', borderColor: 'color-mix(in srgb, var(--color-primary) 18%, white)' }}>
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                            <span className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--color-primary)' }}>
                                {uploadProgress.total > 1
                                    ? `Sending ${uploadProgress.current} of ${uploadProgress.total}`
                                    : 'Sending…'}
                            </span>
                        </div>
                        {uploadProgress.total > 1 && (
                            <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--color-primary)' }}>
                                {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                            </span>
                        )}
                    </div>
                    {/* Progress bar */}
                    <div className="h-1 rounded-full overflow-hidden bg-slate-200">
                        <div
                            className="h-full rounded-full transition-all duration-300 ease-out"
                            style={{
                                backgroundColor: 'var(--color-primary)',
                                width: uploadProgress.total > 0
                                    ? `${(uploadProgress.current / uploadProgress.total) * 100}%`
                                    : '15%', // pulse-like start
                            }}
                        />
                    </div>
                </div>
            )}
            {/* Audio recording upload indicator */}
            {sending && isRecording === false && uploadProgress === null && (
                <div className="mb-2 p-2 rounded-xl flex items-center gap-2 border" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)', borderColor: 'color-mix(in srgb, var(--color-primary) 20%, white)' }}>
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                    <span className="text-xs font-bold" style={{ color: 'var(--color-primary)' }}>Sending…</span>
                </div>
            )}

            {/* Multi-file preview strip */}
            {selectedFiles.length > 0 && !isRecording && !sending && (
                <div className="mb-2 bg-slate-50 rounded-2xl border border-slate-100 p-2 shadow-sm">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {selectedFiles.map((_file, i) => (
                            <div key={i} className="relative flex-shrink-0">
                                {filePreviews[i] ? (
                                    <img
                                        src={filePreviews[i]}
                                        alt={`Preview ${i + 1}`}
                                        className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-xl border border-white shadow-sm"
                                    />
                                ) : (
                                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}>
                                        <Mic size={18} style={{ color: 'var(--color-primary)' }} />
                                    </div>
                                )}
                                <button
                                    onClick={() => removeFile(i)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center shadow-md"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                    {selectedFiles.length > 1 && (
                        <p className="text-[10px] text-slate-400 mt-1.5 font-medium">{selectedFiles.length} files · caption goes on first</p>
                    )}
                </div>
            )}

            {!isRecording && (
                <div className="flex items-end gap-1 sm:gap-2">

                    <button
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2.5 rounded-full text-slate-400 hover:text-[var(--color-primary)] transition-all"
                    >
                        <Paperclip size={20} />
                    </button>

                    <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-100 focus-within:bg-white transition-all">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => { setInput(e.target.value); autoResize(); }}
                            onKeyDown={handleKeyDown}
                            placeholder="Message..."
                            className="w-full bg-transparent text-slate-900 px-4 py-2 text-[14px] sm:text-[15px] resize-none focus:outline-none placeholder:text-slate-400 italic"
                            rows={1}
                            style={{ minHeight: '38px', maxHeight: '120px' }}
                        />
                    </div>

                    {(input.trim() || selectedFiles.length > 0) ? (
                        <button
                            onPointerDown={(e) => e.preventDefault()} // prevent textarea blur → keyboard stays up
                            onClick={handleSend}
                            disabled={sending && uploadProgress !== null}
                            className="p-2.5 rounded-full text-white transition-all shadow-md active:scale-95 disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-primary)' }}
                        >
                            {(sending && uploadProgress !== null) ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                        </button>
                    ) : (
                        <button
                            onClick={startRecording}
                            disabled={sending}
                            className="p-2.5 rounded-full text-slate-400 hover:text-[var(--color-primary)] transition-all active:scale-95 disabled:opacity-50"
                        >
                            <Mic size={20} />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
