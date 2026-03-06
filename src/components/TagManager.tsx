import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Edit2, Trash2, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Tag, TAG_COLORS } from '../types';
import { useConfig } from '../context/ConfigContext';

interface TagManagerProps {
    isOpen: boolean;
    onClose: () => void;
    onTagsChanged: () => void;
    // For assigning tags to a contact
    contactId?: string;
    contactTags?: number[];
}

export const TagManager = ({ isOpen, onClose, onTagsChanged, contactId, contactTags = [] }: TagManagerProps) => {
    const { config } = useConfig();
    const [tags, setTags] = useState<Tag[]>([]);
    const [creating, setCreating] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [tagName, setTagName] = useState('');
    const [tagHex, setTagHex] = useState(TAG_COLORS[0].hex);
    const [loading, setLoading] = useState(false);
    const [localContactTags, setLocalContactTags] = useState<number[]>(contactTags);

    useEffect(() => {
        if (isOpen) {
            fetchTags();
            setLocalContactTags(contactTags);
        }
    }, [isOpen, contactTags]);

    const fetchTags = async () => {
        const { data } = await supabase.from(config.tableTags).select('*').order('id');
        if (data) setTags(data as Tag[]);
    };

    const createTag = async () => {
        if (!tagName.trim()) return;
        setLoading(true);
        const { error } = await supabase.from(config.tableTags).insert({ 'tag name': tagName.trim(), 'tag hex': tagHex });
        if (error) console.error('Create tag error:', error);
        setTagName('');
        setTagHex(TAG_COLORS[0].hex);
        setCreating(false);
        await fetchTags();
        onTagsChanged();
        setLoading(false);
    };

    const updateTag = async (id: number) => {
        if (!tagName.trim()) return;
        setLoading(true);
        const { error } = await supabase.from(config.tableTags).update({ 'tag name': tagName.trim(), 'tag hex': tagHex }).eq('id', id);
        if (error) console.error('Update tag error:', error);
        setEditingId(null);
        setTagName('');
        await fetchTags();
        onTagsChanged();
        setLoading(false);
    };

    const deleteTag = async (id: number) => {
        setLoading(true);
        await supabase.from(config.tableTags).delete().eq('id', id);
        await fetchTags();
        onTagsChanged();
        setLoading(false);
    };

    const toggleTagOnContact = async (tagId: number) => {
        if (!contactId) return;
        setLoading(true);
        const newTags = localContactTags.includes(tagId)
            ? localContactTags.filter(t => t !== tagId)
            : [...localContactTags, tagId];

        setLocalContactTags(newTags);

        await supabase
            .from(config.tableContacts)
            .update({ tags: newTags })
            .eq('id', contactId);

        onTagsChanged();
        setLoading(false);
    };

    const startEdit = (tag: Tag) => {
        setEditingId(tag.id);
        setTagName(tag['tag name'] || '');
        setTagHex(tag['tag hex'] || TAG_COLORS[0].hex);
        setCreating(false);
    };

    const startCreate = () => {
        setCreating(true);
        setEditingId(null);
        setTagName('');
        setTagHex(TAG_COLORS[0].hex);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 modal-overlay" onClick={onClose}>
            <div className="w-full sm:w-[400px] max-h-[80vh] bg-white rounded-2xl sm:rounded-3xl border border-slate-200 flex flex-col shadow-2xl modal-panel" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <h3 className="text-slate-900 font-bold text-lg">
                        {contactId ? 'Assign Tags' : 'Manage Tags'}
                    </h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Tag List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {tags.map(tag => (
                        <div key={tag.id} className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                            {editingId === tag.id ? (
                                // Edit mode
                                <div className="flex-1 flex flex-col gap-3">
                                    <input
                                        value={tagName}
                                        onChange={e => setTagName(e.target.value)}
                                        className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50"
                                        placeholder="Tag name"
                                        autoFocus
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        {TAG_COLORS.map(c => (
                                            <button
                                                key={c.hex}
                                                onClick={() => setTagHex(c.hex)}
                                                className="w-7 h-7 rounded-full transition-all hover:scale-110 active:scale-90"
                                                style={{
                                                    backgroundColor: c.hex,
                                                    border: tagHex === c.hex ? '3px solid white' : 'none',
                                                    boxShadow: tagHex === c.hex ? `0 0 0 2px ${c.hex}` : 'none',
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-1">
                                        <button
                                            onClick={() => updateTag(tag.id)}
                                            disabled={loading}
                                            className="px-4 py-2 text-white rounded-xl text-xs font-bold shadow-sm"
                                            style={{ backgroundColor: 'var(--color-accent)' }}
                                        >
                                            Save Changes
                                        </button>
                                        <button
                                            onClick={() => setEditingId(null)}
                                            className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // Display mode
                                <>
                                    {contactId ? (
                                        // Contact mode
                                        <button
                                            onClick={() => toggleTagOnContact(tag.id)}
                                            disabled={loading}
                                            className="flex items-center gap-3 flex-1 text-left group"
                                        >
                                            <div
                                                className="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all flex-shrink-0"
                                                style={localContactTags.includes(tag.id) ? {
                                                    borderColor: 'var(--color-accent)',
                                                    backgroundColor: 'var(--color-accent)',
                                                } : undefined}
                                            >
                                                {localContactTags.includes(tag.id) && <Check size={14} className="text-white" />}
                                            </div>
                                            <div
                                                className="w-4 h-4 rounded-full flex-shrink-0 shadow-sm"
                                                style={{ backgroundColor: tag['tag hex'] || '#64748b' }}
                                            />
                                            <span className="flex-1 text-slate-700 font-bold text-sm">{tag['tag name'] || 'Unnamed'}</span>
                                        </button>
                                    ) : (
                                        // Manager mode
                                        <>
                                            <div
                                                className="w-4 h-4 rounded-full flex-shrink-0 shadow-sm"
                                                style={{ backgroundColor: tag['tag hex'] || '#64748b' }}
                                            />
                                            <span className="flex-1 text-slate-700 font-bold text-sm">{tag['tag name'] || 'Unnamed'}</span>
                                            <button onClick={() => startEdit(tag)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-[var(--color-accent)] transition-colors">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={() => deleteTag(tag.id)} className="p-2 rounded-lg text-slate-400 hover:text-[var(--color-accent)] transition-colors">
                                                <Trash2 size={16} />
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    ))}

                    {tags.length === 0 && !creating && (
                        <div className="text-center py-10 px-4">
                            <div className="text-4xl mb-3">🏷️</div>
                            <p className="text-slate-400 text-sm">No tags found. Create one to organize your leads.</p>
                        </div>
                    )}

                    {/* Create form */}
                    {creating && (
                        <div className="p-4 rounded-2xl border space-y-3 animate-in zoom-in-95 duration-200" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, white)', borderColor: 'color-mix(in srgb, var(--color-accent) 15%, white)' }}>
                            <input
                                value={tagName}
                                onChange={e => setTagName(e.target.value)}
                                className="w-full bg-white border rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none shadow-sm border-slate-200"
                                placeholder="Enter tag name..."
                                autoFocus
                            />
                            <div className="flex flex-wrap gap-2">
                                {TAG_COLORS.map(c => (
                                    <button
                                        key={c.hex}
                                        onClick={() => setTagHex(c.hex)}
                                        className="w-7 h-7 rounded-full transition-all hover:scale-110 active:scale-90"
                                        style={{
                                            backgroundColor: c.hex,
                                            border: tagHex === c.hex ? '3px solid white' : 'none',
                                            boxShadow: tagHex === c.hex ? `0 0 0 2px ${c.hex}` : 'none',
                                        }}
                                    />
                                ))}
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={createTag}
                                    disabled={loading || !tagName.trim()}
                                    className="px-6 py-2 text-white rounded-xl text-xs font-bold shadow-md transition-colors disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--color-accent)' }}
                                >
                                    Create Tag
                                </button>
                                <button
                                    onClick={() => setCreating(false)}
                                    className="px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {!creating && editingId === null && (
                    <div className="p-5 border-t border-slate-100 flex gap-3">
                        <button
                            onClick={startCreate}
                            className="flex-1 py-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-600 font-bold flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95"
                        >
                            <Plus size={18} /> New Tag
                        </button>
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-2xl text-sm text-white font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                        >
                            <Check size={18} /> Finish
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};
