'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useDashStore } from '@/lib/store';
import {
  CSV_MIME_TYPES,
  WHATSAPP_DOCUMENT_ACCEPT,
  WHATSAPP_SUPPORTED_DOCUMENT_MIME_TYPES,
  WHATSAPP_SUPPORTED_FORMATS_LABEL,
  WHATSAPP_SUPPORTED_IMAGE_MIME_TYPES,
  WHATSAPP_SUPPORTED_VIDEO_MIME_TYPES,
  getFileExtension,
  getSupportedMimeType,
  isCsvFile,
} from '@/lib/mediaSupport';
import dynamic from 'next/dynamic';
import TemplateSender from '@/components/dash/TemplateSender';
import {
  Search, Send, Image as ImageIcon, FileText, Smile, Phone,
  MoreVertical, CheckCheck, Check, Archive, VolumeX, ShieldAlert,
  UserX, UserCheck, ChevronLeft, ChevronRight, SmilePlus, Download, Play, Paperclip, X, ZoomIn, ZoomOut,
  Reply, ChevronDown, Trash2, Copy, Forward, Pin, Star,
} from 'lucide-react';
import { useMessageNavigation } from '@/hooks/useMessageNavigation';
import { ReplyPreview } from '@/components/ReplyPreview';
import TemplateButtonsBlock from '@/components/dash/TemplateButtonsBlock';

// Dynamic import — EmojiPicker only runs in browser (no SSR)
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

/* ─── Helpers ────────────────────────────────────────────────── */

function Avatar({ name, color, size = 9 }: any) {
  const initials = name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 shadow-sm`}
      style={{ background: color || '#25D366', fontSize: size <= 8 ? 11 : 13 }}
    >
      {initials}
    </div>
  );
}

function MsgStatus({ status }: any) {
  if (status === 'sending') return <div className="w-3 h-3 border border-[var(--color-wa-muted)] border-t-transparent rounded-full animate-spin-slow" />;
  if (status === 'read')      return <CheckCheck size={13} color="#25D366" />;
  if (status === 'delivered') return <CheckCheck size={13} color="var(--color-wa-muted)" />;
  return <Check size={13} color="var(--color-wa-muted)" />;
}

function renderWhatsAppInline(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIndex = 0;
  let matchIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const value = match[0];
    const inner = value.slice(1, -1);
    const key = `${keyPrefix}-${matchIndex}`;

    if (value.startsWith('*')) {
      parts.push(<strong key={key} className="font-semibold">{inner}</strong>);
    } else {
      parts.push(<span key={key} className="italic">{inner}</span>);
    }

    lastIndex = match.index + value.length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function WhatsAppMessageText({
  text,
  isTemplate = false,
  className = '',
}: {
  text: string;
  isTemplate?: boolean;
  className?: string;
}) {
  const lines = text.split('\n');

  return (
    <div className={`text-[13px] leading-relaxed break-words ${className}`}>
      {lines.map((line, index) => {
        if (line.length === 0) {
          return <div key={`blank-${index}`} className="h-3" />;
        }

        const trimmed = line.trim();
        const isFooterLine = isTemplate && /^_[^_]+_$/.test(trimmed);

        return (
          <div
            key={`${index}-${line}`}
            className={isFooterLine ? 'text-[var(--color-wa-muted)]' : undefined}
          >
            {renderWhatsAppInline(line, `line-${index}`)}
          </div>
        );
      })}
    </div>
  );
}

function groupByDate(messages: any[]) {
  const groups: { date: string; messages: any[] }[] = [];
  let currentDate = '';

  for (const msg of messages) {
    const d = new Date(msg.created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    let label: string;
    if (d.toDateString() === today.toDateString()) {
      label = 'TODAY';
    } else if (d.toDateString() === yesterday.toDateString()) {
      label = 'YESTERDAY';
    } else {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      label = `${day}/${month}/${year}`;
    }

    if (label !== currentDate) {
      currentDate = label;
      groups.push({ date: label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

/* ─── Page ───────────────────────────────────────────────────── */

const getMessageBodyOnly = (msg: any, templatesList: any[]) => {
  if (!msg) return '';
  if (msg.message_type !== 'template' && !msg.template_name) {
    return msg.content || '';
  }

  const normalizedKey = msg.template_name?.toLowerCase().replace(/_/g, '').trim();
  const template = templatesList.find((t: any) => t.template_name?.toLowerCase().replace(/_/g, '').trim() === normalizedKey);
  
  if (template) {
    const parameters = msg.metadata?.parameters || [];
    let paramIndex = 0;
    const bodyText = template.body || '';
    
    const resolvedBody = bodyText.replace(/\{\{(\d+)\}\}/g, () => {
      const val = parameters[paramIndex++];
      return val !== undefined && val !== null ? String(val) : '';
    });
    return resolvedBody;
  }

  let parsedContent = msg.content || '';
  
  if (parsedContent.startsWith('*')) {
    const headerEndIndex = parsedContent.indexOf('*\n\n');
    if (headerEndIndex !== -1) {
      parsedContent = parsedContent.substring(headerEndIndex + 3);
    }
  }
  
  const footerStartIndex = parsedContent.lastIndexOf('\n\n_');
  if (footerStartIndex !== -1 && parsedContent.endsWith('_')) {
    parsedContent = parsedContent.substring(0, footerStartIndex);
  }
  
  return parsedContent;
};

export default function InboxPage() {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    fetchConversations,
    messages,
    sendMessage,
    sendReaction,
    searchQuery,
    setSearchQuery,
    hasMoreMessages,
    loadingOlderMessages,
    fetchOlderMessages,
    replyingToMessage,
    setReplyingToMessage,
    deleteMessage,
    deleteMessages,
    templates,
  } = useDashStore();

  const { activeHighlightId, navigateToMessage, loading: loadingNav, error: navError } = useMessageNavigation();

  const scrollContainerRef  = useRef<HTMLDivElement>(null);
  const prevMessagesRef     = useRef<any[]>([]);
  const prevScrollHeightRef = useRef<number>(0);
  const isPrependingRef     = useRef<boolean>(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    if (container.scrollTop < 100 && !loadingOlderMessages && hasMoreMessages) {
      prevScrollHeightRef.current = container.scrollHeight;
      isPrependingRef.current = true;
      if (activeConversationId) {
        fetchOlderMessages(activeConversationId);
      }
    }
  };

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const prevMessages = prevMessagesRef.current;
    const currentMessages = messages;
    prevMessagesRef.current = currentMessages;

    if (currentMessages.length === 0) return;

    // 1. Initial Load / Active Conversation Switch
    const isFirstLoad = prevMessages.length === 0 || 
      (prevMessages[0] && prevMessages[0].conversation_id !== currentMessages[0].conversation_id);

    if (isFirstLoad) {
      container.scrollTop = container.scrollHeight;
      isPrependingRef.current = false;
      return;
    }

    // 2. Prepend (Stabilize viewport scroll position)
    if (isPrependingRef.current && prevMessages.length > 0 && currentMessages.length > prevMessages.length) {
      const firstPrevId = prevMessages[0].id;
      const firstCurrId = currentMessages[0].id;
      
      if (firstPrevId !== firstCurrId) {
        const delta = container.scrollHeight - prevScrollHeightRef.current;
        container.scrollTop = delta;
      }
      isPrependingRef.current = false;
      return;
    }

    // 3. New Message (Smooth scroll to bottom if close to bottom, or outbound)
    if (prevMessages.length > 0 && currentMessages.length > prevMessages.length) {
      const lastPrevId = prevMessages[prevMessages.length - 1].id;
      const lastCurrId = currentMessages[currentMessages.length - 1].id;
      
      if (lastPrevId !== lastCurrId) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
        const isLastMessageOutbound = currentMessages[currentMessages.length - 1].direction === 'outbound';
        
        if (isNearBottom || isLastMessageOutbound) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          });
        }
      }
    }
  }, [messages]);

  useEffect(() => {
    if (activeConversationId) {
      useDashStore.getState().fetchMessages(activeConversationId, true);
    }
  }, [activeConversationId]);

  const [inputText, setInputText]       = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [showMenu, setShowMenu]         = useState(false);
  const [showEmoji, setShowEmoji]       = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [reactingToId, setReactingToId] = useState<string | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Media preview & upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'document' | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Full-screen WhatsApp-style media viewer states
  const [viewerMessage, setViewerMessage] = useState<any>(null);
  const [zoomScale, setZoomScale] = useState(1);

  // Track downloaded status for PDF and other media items
  const [downloadedMedia, setDownloadedMedia] = useState<Record<string, boolean>>({});

  // Selection / Deletion states
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [menuMessage, setMenuMessage] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const isEligibleForEveryoneDelete = () => {
    const msgsToCheck = isSelectionMode
      ? messages.filter((m) => selectedMessageIds.includes(m.id))
      : menuMessage
      ? [menuMessage]
      : [];

    if (msgsToCheck.length === 0) return false;

    return msgsToCheck.every((msg) => {
      if (msg.direction !== 'outbound') return false;
      const msgTime = new Date(msg.created_at).getTime();
      const minutesElapsed = (Date.now() - msgTime) / (1000 * 60);
      return minutesElapsed <= 20;
    });
  };

  const handleExecuteDelete = async (type: 'me' | 'everyone') => {
    setShowDeleteModal(false);
    const idsToDelete = isSelectionMode
      ? selectedMessageIds
      : menuMessage
      ? [menuMessage.id]
      : [];

    if (idsToDelete.length === 0) return;

    try {
      if (idsToDelete.length === 1) {
        await deleteMessage(idsToDelete[0], type);
      } else {
        await deleteMessages(idsToDelete, type);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setIsSelectionMode(false);
      setSelectedMessageIds([]);
      setMenuMessage(null);
    }
  };

  const handleDownloadMedia = async (url: string, fileName: string, messageId: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      
      setDownloadedMedia(prev => ({ ...prev, [messageId]: true }));
    } catch (err) {
      console.error('Failed to download file:', err);
      window.open(url, '_blank');
      setDownloadedMedia(prev => ({ ...prev, [messageId]: true }));
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef  = useRef<HTMLInputElement>(null);
  const docInputRef    = useRef<HTMLInputElement>(null);
  const attachRef      = useRef<HTMLDivElement>(null);

  /* ─ data fetch & realtime ──────────────────────────────────── */

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    const interval = setInterval(() => {
      useDashStore.getState().fetchConversations();
      const activeId = useDashStore.getState().activeConversationId;
      if (activeId) {
        useDashStore.getState().fetchMessages(activeId, false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  /* ─ derived ────────────────────────────────────────────────── */

  const filtered = conversations.filter(c => {
    const name = c.contact?.name || c.contact?.phone_number || '';
    const matchSearch =
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.contact?.phone_number || '').includes(searchQuery);
    if (!matchSearch) return false;

    if (activeFilter === 'unseen') return c.unread_count > 0;
    if (activeFilter === 'seen')   return c.unread_count === 0;
    return true;
  });

  const selectedConv    = conversations.find(c => c.id === activeConversationId);
  const selectedContact = selectedConv?.contact;

  // Legacy scroll-to-bottom replaced by useLayoutEffect viewport controller

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  /* ─ handlers ───────────────────────────────────────────────── */

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConversationId || !selectedContact?.phone_number) return;
    try {
      const replyToId = replyingToMessage?.wa_message_id || replyingToMessage?.id || undefined;
      const replyPreview = replyingToMessage
        ? {
            sender_name: replyingToMessage.direction === 'outbound'
              ? 'You'
              : (selectedContact?.name || selectedContact?.phone_number || 'Sender'),
            content: replyingToMessage.content || `[${replyingToMessage.message_type}]`,
          }
        : undefined;

      await sendMessage(
        selectedContact.phone_number,
        inputText.trim(),
        activeConversationId,
        replyToId,
        replyPreview
      );
      setInputText('');
      setReplyingToMessage(null);
      setShowEmoji(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendTemplate = async (
    templateName: string,
    languageCode: string,
    components: any[],
    resolvedText: string
  ) => {
    if (!selectedContact?.phone_number || !activeConversationId) return;
    try {
      const res = await fetch('/api/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedContact.phone_number,
          templateName,
          languageCode,
          components,
          conversationId: activeConversationId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send template');
      }
    } catch (err) {
      console.error('Send template failed:', err);
      throw err;
    }
  };

  const handleEmojiClick = (emojiData: any) => {
    setInputText(prev => prev + emojiData.emoji);
  };

  const handleImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleDocClick = () => {
    docInputRef.current?.click();
  };

  const convertCsvToXlsx = async (file: File) => {
    const XLSX = await import('xlsx');
    const csvText = await file.text();
    const workbook = XLSX.read(csvText, { type: 'string' });
    const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const xlsxName = file.name.replace(/\.csv$/i, '.xlsx');

    return new File([xlsxBuffer], xlsxName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified: file.lastModified,
    });
  };

  const withDocumentMimeType = (file: File) => {
    const mimeType = getSupportedMimeType(file);

    if (!mimeType || mimeType === file.type) {
      return file;
    }

    return new File([file], file.name, {
      type: mimeType,
      lastModified: file.lastModified,
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Meta-supported MIME types
    const SUPPORTED: Record<string, string[]> = {
      image:    [...WHATSAPP_SUPPORTED_IMAGE_MIME_TYPES],
      video:    [...WHATSAPP_SUPPORTED_VIDEO_MIME_TYPES],
      document: [...WHATSAPP_SUPPORTED_DOCUMENT_MIME_TYPES, ...CSV_MIME_TYPES],
    };
    const UNSUPPORTED_IMAGE_MSG: Record<string, string> = {
      'image/webp': 'WebP',
      'image/heic': 'HEIC',
      'image/heif': 'HEIF',
      'image/avif': 'AVIF',
      'image/bmp':  'BMP',
      'image/tiff': 'TIFF',
      'image/gif':  'GIF',
    };

    let uploadFile = file;
    const detectedMimeType = getSupportedMimeType(file);

    // Check if it's an unsupported image format
    if (UNSUPPORTED_IMAGE_MSG[detectedMimeType]) {
      setUploadError(
        `❌ ${UNSUPPORTED_IMAGE_MSG[detectedMimeType]} format not supported by WhatsApp. Please convert to JPEG or PNG first.`
      );
      setSelectedFile(file); // still show the preview overlay so user sees error
      setMediaType('image');
      setMediaPreviewUrl(null);
      e.target.value = '';
      return;
    }

    // Check general support
    if (isCsvFile(file)) {
      try {
        uploadFile = await convertCsvToXlsx(file);
      } catch (err) {
        console.error('CSV conversion failed:', err);
        setUploadError('❌ Could not convert this CSV to XLSX. Please check the file and try again.');
        setSelectedFile(file);
        setMediaType('document');
        setMediaPreviewUrl(null);
        e.target.value = '';
        return;
      }
    } else if (type === 'document') {
      uploadFile = withDocumentMimeType(file);
    }

    const allSupported = [...SUPPORTED.image, ...SUPPORTED.video, ...SUPPORTED.document];
    const uploadMimeType = getSupportedMimeType(uploadFile);
    if (!allSupported.includes(detectedMimeType) && !allSupported.includes(uploadMimeType)) {
      const format = uploadMimeType || getFileExtension(file.name).toUpperCase() || 'unknown';
      setUploadError(`❌ Unsupported format (${format}). WhatsApp supports: ${WHATSAPP_SUPPORTED_FORMATS_LABEL}.`);
      setSelectedFile(file);
      setMediaType('document');
      setMediaPreviewUrl(null);
      e.target.value = '';
      return;
    }

    setSelectedFile(uploadFile);
    setMediaCaption('');
    setUploadError(null);

    // Determine type: 'image' | 'video' | 'document'
    if (uploadMimeType.startsWith('image/')) {
      setMediaType('image');
      setMediaPreviewUrl(URL.createObjectURL(uploadFile));
    } else if (uploadMimeType.startsWith('video/')) {
      setMediaType('video');
      setMediaPreviewUrl(URL.createObjectURL(uploadFile));
    } else {
      setMediaType('document');
      setMediaPreviewUrl(null);
    }

    // Reset input value so it can be selected again
    e.target.value = '';
  };

  const clearSelectedMedia = () => {
    if (mediaPreviewUrl) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }
    setSelectedFile(null);
    setMediaPreviewUrl(null);
    setMediaType(null);
    setMediaCaption('');
    setUploadingMedia(false);
    setUploadError(null);
  };

  const handleSendMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !activeConversationId || !selectedContact?.phone_number) return;

    setUploadingMedia(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('to', selectedContact.phone_number);
      formData.append('type', mediaType || 'document');
      formData.append('conversationId', activeConversationId);
      if (mediaCaption.trim()) {
        formData.append('caption', mediaCaption.trim());
      }

      const res = await fetch('/api/send-media', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to upload and send media');
      }

      // Success - clear states
      clearSelectedMedia();
    } catch (err: any) {
      console.error('Media upload error:', err);
      setUploadError(err.message || 'Failed to send media file');
    } finally {
      setUploadingMedia(false);
    }
  };

  /* ─ render ─────────────────────────────────────────────────── */

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--color-wa-bg)] w-full h-full min-h-0">
      {/* ── Contact list ────────────────────────────────────────── */}
      <div className={`
        w-full md:w-[300px] flex-shrink-0 border-r border-[var(--color-wa-border)] flex flex-col bg-[var(--color-wa-surface)]
        ${activeConversationId ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Filters */}
        <div className="px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-[var(--color-wa-border)] bg-[var(--color-wa-bg)]/30">
          {[
            { id: 'all', label: 'All' },
            { id: 'unseen', label: 'Unseen' },
            { id: 'seen', label: 'Seen' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all whitespace-nowrap
                ${activeFilter === f.id
                  ? 'bg-[var(--color-wa-green)] text-white shadow-sm'
                  : 'bg-white text-[var(--color-wa-muted)] border border-[var(--color-wa-border)] hover:bg-[var(--color-wa-bg)]'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[var(--color-wa-border)]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-wa-muted)]" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search chats…" style={{ paddingLeft: '34px', fontSize: 13 }} />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c, idx) => {
            const name = c.contact?.name || c.contact?.phone_number || 'Unknown';
            return (
              <div
                key={c.id ? `${c.id}-${idx}` : idx}
                onClick={() => setActiveConversation(c.id)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--color-wa-bg)] transition border-b border-[var(--color-wa-border)]/50
                  ${activeConversationId === c.id ? 'bg-[var(--color-wa-bg)]' : ''}`}
              >
                <Avatar name={name} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="text-[13px] font-medium text-[var(--color-wa-text)] truncate">{name}</p>
                    <span className="text-[10px] text-[var(--color-wa-muted)] flex-shrink-0 ml-2">
                      {c.last_message_at ? new Date(c.last_message_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1 min-w-0">
                      <p className="text-[11px] text-[var(--color-wa-muted)] truncate">{c.last_message}</p>
                    </div>
                    {c.unread_count > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#25D366] text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0 ml-1 shadow-sm">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Chat area ───────────────────────────────────────────── */}
      {activeConversationId ? (
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-wa-bg)] relative">
          <div className="absolute inset-0 z-0 opacity-40 pointer-events-none" style={{
            backgroundImage: 'radial-gradient(var(--color-wa-border) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
            backgroundAttachment: 'local',
          }} />

          {/* Chat header */}
          <div className="h-14 flex items-center justify-between px-4 bg-[var(--color-wa-surface)] border-b border-[var(--color-wa-border)] flex-shrink-0 z-10">
            <div className="flex items-center gap-3">
              <button
                className="md:hidden p-1 -ml-1 text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)]"
                onClick={() => setActiveConversation(null)}
              >
                <ChevronLeft size={20} />
              </button>
              <Avatar name={selectedContact?.name || selectedContact?.phone_number} size={8} />
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-wa-text)]">{selectedContact?.name || selectedContact?.phone_number}</p>
                <p className="text-[11px] text-[var(--color-wa-muted)]">{selectedContact?.phone_number}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 relative">
              <button className="p-2 text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)]"><Phone size={16} /></button>
              <button
                className={`p-2 transition-colors rounded-full ${showMenu ? 'bg-[var(--color-wa-bg)] text-[var(--color-wa-text)]' : 'text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)]'}`}
                onClick={() => setShowMenu(!showMenu)}
              >
                <MoreVertical size={16} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto py-4 flex flex-col gap-3 z-10"
          >
            {loadingOlderMessages && (
              <div className="flex justify-center py-2 shrink-0">
                <div className="w-5 h-5 border-2 border-[var(--color-wa-green)] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[var(--color-wa-muted)] text-[13px] font-medium">No messages yet. Say hello! 👋</p>
              </div>
            )}
            {groupByDate(messages).map(group => (
              <div key={group.date} className="flex flex-col gap-3">
                {/* Date Divider */}
                <div className="flex justify-center my-2 sticky top-2 z-20">
                  <span className="bg-[#ffffff] text-[#54656f] border border-[#e9edef] text-[11px] px-3 py-1.5 rounded-[7px] shadow-sm font-medium uppercase tracking-wide">
                    {group.date}
                  </span>
                </div>

                {group.messages.map(m => {
                  const isOut = m.direction === 'outbound';
                  const isSelected = selectedMessageIds.includes(m.id);
                  const isRevoked = m.message_type === 'revoked' || m.content === '🚫 This message was deleted';
                  return (
                  <div 
                    key={m.id} 
                    id={`msg-${m.id}`}
                    className={`w-full flex items-center px-4 py-1.5 transition-colors relative group/row ${
                      isSelectionMode ? 'cursor-pointer hover:bg-white/5' : ''
                    } ${
                      isSelected && isSelectionMode ? 'bg-[#00a884]/8' : ''
                    }`}
                    onClick={isSelectionMode ? () => {
                      if (isSelected) {
                        setSelectedMessageIds(selectedMessageIds.filter(id => id !== m.id));
                      } else {
                        setSelectedMessageIds([...selectedMessageIds, m.id]);
                      }
                    } : undefined}
                  >
                    {isSelectionMode && (
                      <div className="flex items-center justify-center pr-4 shrink-0 select-none">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          isSelected 
                            ? 'bg-[#00a884] border-[#00a884] text-white' 
                            : 'border-[#8696a0]'
                        }`}>
                          {isSelected && <Check size={14} strokeWidth={3} />}
                        </div>
                      </div>
                    )}
                    <div className={`flex-1 flex ${isOut ? 'justify-end' : 'justify-start'} min-w-0`}>
                      <div className="relative group max-w-[85%] md:max-w-[70%] min-w-0">
                        {/* Bubble */}
                      <div 
                        id={m.wa_message_id ? `msg-${m.wa_message_id}` : undefined}
                        className={`
                          ${isOut ? 'chat-bubble-out' : 'chat-bubble-in'} 
                          relative transition-all duration-300 group/bubble min-w-0
                          ${(activeHighlightId === m.id || (m.wa_message_id && activeHighlightId === m.wa_message_id)) ? 'animate-messageHighlight' : ''}
                        `}
                      >
                        {!isSelectionMode && !isRevoked && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setMenuAnchor({ x: rect.left, y: rect.bottom + window.scrollY });
                              setMenuMessage(m);
                            }}
                            className="absolute top-1.5 right-1.5 p-0.5 rounded text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942]/30 opacity-0 group-hover/bubble:opacity-100 transition-opacity z-20 cursor-pointer"
                          >
                            <ChevronDown size={14} />
                          </button>
                        )}
                        {/* Reply Preview inside Bubble */}
                        {m.context_message_id && (() => {
                          const parentMsg = messages.find(pm => pm.id === m.context_message_id || pm.wa_message_id === m.context_message_id);
                          const senderName = m.metadata?.reply_to_message?.sender_name || 
                                            (parentMsg 
                                              ? (parentMsg.direction === 'outbound' ? 'You' : (selectedContact?.name || selectedContact?.phone_number || 'Sender'))
                                              : 'Message');
                          const replyContent = m.metadata?.reply_to_message?.content || 
                                              (parentMsg ? parentMsg.content : 'Click to view');
                          return (
                            <ReplyPreview
                              senderName={senderName}
                              content={replyContent}
                              isOutbound={isOut}
                              onClick={() => navigateToMessage(m.context_message_id!)}
                            />
                          );
                        })()}

                        {/* Native WhatsApp Style Media Header Frame */}
                        {(() => {
                          if (isRevoked) return null;

                          // Helper to extract a clean filename from url
                          const getFileName = (url: string) => {
                            if (!url) return "Document.pdf";
                            try {
                              const decoded = decodeURIComponent(url);
                              const base = decoded.split('/').pop()?.split('?')[0];
                              return base && base.includes('.') ? base : "Document.pdf";
                            } catch(e) {
                              return "Document.pdf";
                            }
                          };

                          let mediaUrl = m.media_url || m.metadata?.media_url || '';
                          let fileName = m.file_name || m.metadata?.file_name || getFileName(mediaUrl);
                          let isTemplateMedia = m.message_type === 'template' || !!m.template_name;

                          if (!mediaUrl) {
                            const mediaObj = m.media && Array.isArray(m.media) && m.media.length > 0 ? m.media[0] : null;
                            const mediaId = mediaObj?.id || m.media_url;
                            if (mediaId && m.message_type === 'document') {
                              mediaUrl = mediaId.startsWith('http') ? mediaId : `/api/media/${mediaId}`;
                              fileName = m.file_name || mediaObj?.fileName || 'Document';
                            }
                          }

                          if (!mediaUrl) return null;

                          const mediaUrlLower = mediaUrl.toLowerCase();

                          const isImage = 
                            ((mediaUrlLower.match(/\.(jpg|jpeg|png|webp|gif)($|\?)/i) || 
                              mediaUrlLower.includes("image") ||
                              m.message_type === "image" ||
                              m.mime_type?.startsWith("image/")) && 
                             isTemplateMedia);

                          const isDocument = 
                            mediaUrlLower.includes(".pdf") || 
                            (mediaUrlLower.includes("drive.google.com") && !isImage) ||
                            m.message_type === "document" ||
                            m.mime_type === "application/pdf" ||
                            !!m.file_name?.toLowerCase().endsWith('.pdf');

                          if (isImage) {
                            return (
                              <div className={`w-[calc(100%+24px)] mb-2 overflow-hidden -mx-3 -mt-2 select-none ${
                                isOut ? 'rounded-tl-[8px] rounded-tr-none' : 'rounded-tl-none rounded-tr-[8px]'
                              }`}>
                                <img 
                                  src={mediaUrl} 
                                  alt="Broadcast Graphic Preview" 
                                  className="w-full h-auto max-h-[300px] object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                  onClick={() => {
                                    setViewerMessage(m);
                                    setZoomScale(1);
                                  }}
                                />
                              </div>
                            );
                          }

                          if (isDocument) {
                            return (
                              <div className={`w-[calc(100%+24px)] mb-2 bg-black/20 hover:bg-black/30 transition-colors p-3 flex items-center justify-between -mx-3 -mt-2 border-b border-black/5 text-white ${
                                isOut ? 'rounded-tl-[8px] rounded-tr-none' : 'rounded-tl-none rounded-tr-[8px]'
                              }`}>
                                <div className="flex items-center space-x-3 overflow-hidden pr-2">
                                  <svg className="w-6 h-6 shrink-0 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  <div className="flex flex-col truncate text-left">
                                    <span className="text-sm font-medium truncate tracking-wide text-gray-100">
                                      {fileName}
                                    </span>
                                    <span className="text-xs text-gray-300 font-light mt-0.5">
                                      PDF Document
                                    </span>
                                  </div>
                                </div>
                                
                                <button 
                                  onClick={() => handleDownloadMedia(mediaUrl, fileName, m.id)}
                                  className="p-1.5 rounded-full hover:bg-white/10 text-gray-200 cursor-pointer"
                                  title="Download Document"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                </button>
                              </div>
                            );
                          }

                          return null;
                        })()}


                        {/* Media Render */}
                        {isRevoked ? (
                          <span className="italic text-[#8696a0] flex items-center gap-1.5 py-1 select-none pr-6">
                            <span>🚫</span> This message was deleted
                          </span>
                        ) : (() => {
                          const mediaObj = m.media && Array.isArray(m.media) && m.media.length > 0 ? m.media[0] : null;
                          const mediaId = mediaObj?.id || m.media_url;
                          const mediaType = m.message_type;

                          if (!mediaId) {
                            return (
                              <WhatsAppMessageText
                                text={m.content || ''}
                                isTemplate={mediaType === 'template'}
                              />
                            );
                          }

                          const fileSrc = mediaId.startsWith('http') ? mediaId : `/api/media/${mediaId}`;

                          switch (mediaType) {
                            case 'image':
                              return (
                                <div className="flex flex-col gap-1.5">
                                  <div className="rounded-lg overflow-hidden border border-[var(--color-wa-border)] bg-black/5 max-w-[280px]">
                                    <img
                                      src={fileSrc}
                                      alt="Image"
                                      className="w-full h-auto max-h-[220px] object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                      onClick={() => {
                                        setViewerMessage(m);
                                        setZoomScale(1);
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center gap-4 px-1 py-1 text-xs font-semibold select-none">
                                    {!downloadedMedia[m.id] ? (
                                      <button
                                        onClick={() => handleDownloadMedia(fileSrc, mediaObj?.fileName || 'image.jpg', m.id)}
                                        className="text-[#25D366] hover:underline cursor-pointer flex items-center gap-1"
                                      >
                                        <Download size={14} /> Download
                                      </button>
                                    ) : (
                                      <>
                                        <a href={fileSrc} target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline cursor-pointer">Open</a>
                                        <a href={fileSrc} download={mediaObj?.fileName || 'image.jpg'} target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline cursor-pointer">Save as...</a>
                                      </>
                                    )}
                                  </div>
                                  {m.content && m.content !== '[Image]' && (
                                    <WhatsAppMessageText text={m.content} className="mt-1" />
                                  )}
                                </div>
                              );
                            case 'video':
                              return (
                                <div className="flex flex-col gap-1.5">
                                  <div className="rounded-lg overflow-hidden border border-[var(--color-wa-border)] bg-black/5 max-w-[280px]">
                                    <video
                                      src={fileSrc}
                                      controls
                                      className="w-full h-auto max-h-[220px] object-contain"
                                    />
                                  </div>
                                  <div className="flex items-center gap-4 px-1 py-1 text-xs font-semibold select-none">
                                    {!downloadedMedia[m.id] ? (
                                      <button
                                        onClick={() => handleDownloadMedia(fileSrc, mediaObj?.fileName || 'video.mp4', m.id)}
                                        className="text-[#25D366] hover:underline cursor-pointer flex items-center gap-1"
                                      >
                                        <Download size={14} /> Download
                                      </button>
                                    ) : (
                                      <>
                                        <a href={fileSrc} target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline cursor-pointer">Open</a>
                                        <a href={fileSrc} download={mediaObj?.fileName || 'video.mp4'} target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline cursor-pointer">Save as...</a>
                                      </>
                                    )}
                                  </div>
                                  {m.content && m.content !== '[Video]' && (
                                    <WhatsAppMessageText text={m.content} className="mt-1" />
                                  )}
                                </div>
                              );
                            case 'document': {
                              const fileName = m.file_name || mediaObj?.fileName || 'Document';
                              const isPdf = fileName.toLowerCase().endsWith('.pdf') || fileSrc.toLowerCase().endsWith('.pdf') || fileSrc.toLowerCase().includes('pdf');
                              const isDocFormat = fileName.match(/\.(doc|docx|xls|xlsx)($|\?)/i) || fileSrc.match(/\.(doc|docx|xls|xlsx)($|\?)/i);
                              
                              if (isPdf || isDocFormat) {
                                return m.content && m.content !== '[Document]' ? (
                                  <WhatsAppMessageText text={m.content} className="mt-1" />
                                ) : null;
                              }

                              const fileSizeStr = m.file_size
                                ? `${(m.file_size / 1024 / 1024).toFixed(2)} MB`
                                : mediaObj?.file_size
                                ? `${(mediaObj.file_size / 1024 / 1024).toFixed(2)} MB`
                                : 'Unknown size';
                              return (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-3 p-2.5 bg-[var(--color-wa-bg)] border border-[var(--color-wa-border)] rounded-lg transition-colors max-w-[280px]">
                                    <div className="bg-red-500 text-white p-2 rounded-lg shrink-0">
                                      <FileText size={20} />
                                    </div>
                                    <div className="flex-1 overflow-hidden min-w-0 text-left">
                                      <p className="text-[12px] font-medium text-[var(--color-wa-text)] truncate">{fileName}</p>
                                      <p className="text-[10px] text-[var(--color-wa-muted)] mt-0.5 uppercase font-mono">{fileSizeStr}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4 px-3 pb-1 pt-1 text-xs font-semibold select-none border-t border-[var(--color-wa-border)]/30 mt-1">
                                    {!downloadedMedia[m.id] ? (
                                      <button
                                        onClick={() => handleDownloadMedia(fileSrc, fileName, m.id)}
                                        className="text-[#25D366] hover:underline cursor-pointer flex items-center gap-1"
                                      >
                                        <Download size={14} /> Download
                                      </button>
                                    ) : (
                                      <>
                                        <a href={fileSrc} target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline cursor-pointer">Open</a>
                                        <a href={fileSrc} download={fileName} target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline cursor-pointer">Save as...</a>
                                      </>
                                    )}
                                  </div>
                                  {m.content && m.content !== '[Document]' && (
                                    <WhatsAppMessageText text={m.content} className="mt-1" />
                                  )}
                                </div>
                              );
                            }
                            default:
                              return (
                                <WhatsAppMessageText
                                  text={m.content || ''}
                                  isTemplate={mediaType === 'template'}
                                />
                              );
                          }
                        })()}

                        <div className={`flex items-center gap-1 mt-1.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                          <span className={`text-[10px] ${isOut ? 'text-[var(--color-wa-teal)]' : 'text-[var(--color-wa-muted)]'}`}>
                            {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isOut && <MsgStatus status={m.status} />}
                        </div>

                        {!isRevoked && <TemplateButtonsBlock buttons={m.buttons} isOutbound={isOut} />}

                        {/* Reaction badges */}
                        {(() => {
                          const dbReactions = m.reactions || [];
                          const allReactions = [...dbReactions];
                          // Add local optimistic reaction if not already in DB
                          if (m.myReaction && !dbReactions.some((r: any) => r.sender === 'me')) {
                            allReactions.push({ emoji: m.myReaction, sender: 'me' });
                          }
                          if (allReactions.length === 0) return null;
                          return (
                            <div className={`absolute -bottom-3 ${isOut ? 'right-2' : 'left-2'} flex gap-0.5`}>
                              {allReactions.map((r: any, idx: number) => (
                                <button
                                  key={idx}
                                  onClick={() => {
                                    if (r.sender === 'me' && m.wa_message_id && selectedContact?.phone_number) {
                                      sendReaction(selectedContact.phone_number, m.wa_message_id, '', m.id);
                                    }
                                  }}
                                  className="bg-white px-1.5 py-0.5 rounded-full shadow-md border border-[var(--color-wa-border)] text-sm hover:scale-110 transition-transform cursor-pointer"
                                  title={r.sender === 'me' ? 'Click to remove' : `Reacted by ${r.sender}`}
                                >
                                  {r.emoji}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {/* ── Floating actions (appear on hover) ── */}
                      <div className={`absolute -top-1 ${isOut ? '-left-16' : '-right-16'} opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 flex gap-1`}>
                        <button
                          type="button"
                          className="p-1.5 rounded-full shadow-sm border bg-white/95 text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] border-[var(--color-wa-border)] cursor-pointer"
                          onClick={() => setReplyingToMessage(m)}
                          title="Reply"
                        >
                          <Reply size={14} />
                        </button>
                        <button
                          className={`p-1.5 rounded-full shadow-sm border transition-all ${
                            reactingToId === m.id
                              ? 'bg-[var(--color-wa-green)] text-white border-[var(--color-wa-green)]'
                              : 'bg-white/95 text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] border-[var(--color-wa-border)]'
                          }`}
                          onClick={() => setReactingToId(reactingToId === m.id ? null : m.id)}
                        >
                          <SmilePlus size={14} />
                        </button>

                        {/* ── Reaction bar (WhatsApp-style dark pill) ── */}
                        {reactingToId === m.id && (
                          <div
                            className={`absolute top-0 ${
                              isOut ? 'right-full mr-1.5' : 'left-full ml-1.5'
                            } flex items-center bg-[#1F2C34] px-2 py-1.5 rounded-full shadow-xl gap-1 animate-scaleIn`}
                          >
                            {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => {
                                  if (m.wa_message_id && selectedContact?.phone_number) {
                                    sendReaction(selectedContact.phone_number, m.wa_message_id, emoji, m.id);
                                  }
                                  setReactingToId(null);
                                }}
                                className="text-xl p-0.5 hover:scale-[1.35] transition-transform duration-150 hover:bg-white/10 rounded"
                              >
                                {emoji}
                              </button>
                            ))}
                            <div className="w-px h-5 bg-white/20 mx-0.5" />
                            <button
                              onClick={() => {
                                setReactingToId(null);
                                setShowEmoji(true);
                              }}
                              className="text-white/70 hover:text-white p-1 hover:bg-white/10 rounded transition-colors"
                              title="More emojis"
                            >
                              <SmilePlus size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                  );
                })}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Input Area ─────────────────────────────────────────── */}
          {isSelectionMode ? (
            <div className="px-6 py-3 bg-[var(--color-wa-surface)] border-t border-[var(--color-wa-border)] flex-shrink-0 z-10 relative flex items-center justify-between h-[60px] animate-slideUp">
              <div className="flex items-center gap-4 text-[var(--color-wa-text)]">
                <button
                  onClick={() => {
                    setIsSelectionMode(false);
                    setSelectedMessageIds([]);
                  }}
                  className="p-1.5 hover:bg-[var(--color-wa-bg)] rounded-full transition-colors text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] cursor-pointer"
                >
                  <X size={20} />
                </button>
                <span className="text-sm font-medium">
                  {selectedMessageIds.length} selected
                </span>
              </div>

              <button
                onClick={() => setShowDeleteModal(true)}
                disabled={selectedMessageIds.length === 0}
                className="w-10 h-10 rounded-full bg-[#ff5c5c]/10 text-[#ff5c5c] flex items-center justify-center shrink-0 hover:bg-[#ff5c5c]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 cursor-pointer"
                title="Delete Selected"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ) : (
            <div className="px-4 py-3 bg-[var(--color-wa-surface)] border-t border-[var(--color-wa-border)] flex-shrink-0 z-10 relative">
            {/* Input Reply Preview */}
            {replyingToMessage && (
              <div className="mb-2 bg-[#f0f2f5] p-1 rounded-lg border border-[var(--color-wa-border)] animate-fadeIn">
                <ReplyPreview
                  senderName={replyingToMessage.direction === 'outbound'
                    ? 'You'
                    : (selectedContact?.name || selectedContact?.phone_number || 'Sender')}
                  content={replyingToMessage.content || `[${replyingToMessage.message_type}]`}
                  onClear={() => setReplyingToMessage(null)}
                />
              </div>
            )}
            {/* Hidden file inputs */}
            <input
              type="file"
              ref={imageInputRef}
              onChange={e => handleFileSelect(e, 'image')}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={docInputRef}
              onChange={e => handleFileSelect(e, 'document')}
              accept={WHATSAPP_DOCUMENT_ACCEPT}
              className="hidden"
            />

            {/* Media Upload / Preview Mode */}
            {selectedFile ? (
              <div className="flex flex-col gap-3 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-[var(--color-wa-border)] pb-2">
                  <span className="text-[11px] font-bold text-[var(--color-wa-muted)] uppercase tracking-wider">
                    Send {mediaType}
                  </span>
                  <button
                    type="button"
                    onClick={clearSelectedMedia}
                    className="p-1 hover:bg-[var(--color-wa-bg)] rounded-full text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] transition-colors cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
                
                <div className="flex items-center gap-3 bg-[var(--color-wa-bg)] p-3 rounded-lg border border-[var(--color-wa-border)]">
                  {mediaPreviewUrl ? (
                    mediaType === 'image' ? (
                      <img src={mediaPreviewUrl} className="w-12 h-12 object-cover rounded border border-[var(--color-wa-border)] shadow-sm" alt="Preview" />
                    ) : (
                      <video src={mediaPreviewUrl} className="w-12 h-12 object-cover rounded border border-[var(--color-wa-border)] shadow-sm" />
                    )
                  ) : (
                    <div className="w-12 h-12 bg-red-500 rounded flex items-center justify-center text-white shrink-0 shadow-sm">
                      <FileText size={22} />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-wa-text)] truncate">{selectedFile.name}</p>
                    <p className="text-[10px] text-[var(--color-wa-muted)] mt-0.5">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                {uploadError && (
                  <div className="text-xs text-red-500 font-medium px-1">
                    {uploadError}
                  </div>
                )}

                <form onSubmit={handleSendMedia} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={mediaCaption}
                    onChange={e => setMediaCaption(e.target.value)}
                    placeholder="Add a caption..."
                    className="flex-1 text-sm bg-white border border-[var(--color-wa-border)] rounded-lg py-2 px-3 focus:outline-none focus:border-[var(--color-wa-green)]"
                    disabled={uploadingMedia || !!uploadError}
                  />
                  <button
                    type="submit"
                    disabled={uploadingMedia || !!uploadError}
                    className={`p-2 rounded-full text-white transition-all shrink-0 cursor-pointer ${
                      uploadingMedia || !!uploadError
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-[var(--color-wa-green)] hover:bg-[#1ebe5d] active:scale-95 shadow-md'
                    }`}
                  >
                    {uploadingMedia ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                  </button>
                </form>
              </div>
            ) : (
              /* Regular Message Mode */
              <>
                {/* Emoji picker */}
                {showEmoji && (
                  <div className="absolute bottom-16 left-4 z-40 shadow-2xl border border-[var(--color-wa-border)] rounded-xl overflow-hidden animate-scaleIn bg-white">
                    <EmojiPicker
                      onEmojiClick={handleEmojiClick}
                      width={320}
                      height={360}
                    />
                  </div>
                )}

                {/* Template picker */}
                {showTemplatePicker && (
                  <TemplateSender
                    onSend={async (name, lang, comps, text) => {
                      await handleSendTemplate(name, lang, comps, text);
                      setShowTemplatePicker(false);
                    }}
                    onClose={() => setShowTemplatePicker(false)}
                  />
                )}

                <form onSubmit={handleSend} className="flex items-center gap-3">
                  {/* Attachment dropdown */}
                  <div className="relative shrink-0" ref={attachRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(!showAttachMenu);
                        setShowEmoji(false);
                        setShowTemplatePicker(false);
                      }}
                      className={`p-2 rounded-full transition cursor-pointer ${
                        showAttachMenu
                          ? 'bg-[var(--color-wa-green)]/15 text-[var(--color-wa-teal)]'
                          : 'text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] hover:bg-[var(--color-wa-bg)]'
                      }`}
                      title="Attach file"
                    >
                      <Paperclip size={20} />
                    </button>
                    
                    {/* Click menu */}
                    {showAttachMenu && (
                      <div className="absolute bottom-12 left-0 flex flex-col bg-white border border-[var(--color-wa-border)] rounded-xl shadow-xl py-1 w-44 z-30 transition-all">
                        <button
                          type="button"
                          onClick={() => {
                            handleImageClick();
                            setShowAttachMenu(false);
                          }}
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--color-wa-text)] hover:bg-[var(--color-wa-bg)] w-full text-left transition-colors cursor-pointer"
                        >
                          <ImageIcon size={16} className="text-[#007FFF]" />
                          <span>Photos & Videos</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleDocClick();
                            setShowAttachMenu(false);
                          }}
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--color-wa-text)] hover:bg-[var(--color-wa-bg)] w-full text-left transition-colors cursor-pointer"
                        >
                          <FileText size={16} className="text-[#FF5733]" />
                          <span>Document</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Emoji Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmoji(!showEmoji);
                      setShowTemplatePicker(false);
                      setShowAttachMenu(false);
                    }}
                    className={`p-2 rounded-full transition shrink-0 cursor-pointer ${
                      showEmoji
                        ? 'bg-[var(--color-wa-green)]/15 text-[var(--color-wa-teal)]'
                        : 'text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] hover:bg-[var(--color-wa-bg)]'
                    }`}
                    title="Emojis"
                  >
                    <Smile size={20} />
                  </button>

                  {/* Text Input */}
                  <input
                    type="text"
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onFocus={() => {
                      setShowEmoji(false);
                      setShowTemplatePicker(false);
                      setShowAttachMenu(false);
                    }}
                    placeholder="Type a message"
                    className="flex-1 bg-[var(--color-wa-bg)]/50 border border-[var(--color-wa-border)] rounded-lg py-2 px-4 focus:outline-none focus:border-[var(--color-wa-green)] focus:bg-white text-sm"
                  />

                  {/* Send Button */}
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className={`p-2.5 rounded-full text-white transition shrink-0 cursor-pointer ${
                      inputText.trim()
                        ? 'bg-[var(--color-wa-green)] hover:bg-[#1ebe5d] active:scale-95 shadow-md'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Send size={18} />
                  </button>
                </form>
              </>
            )}
          </div>
          )}
        </div>
      ) : (
        <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-4 bg-[var(--color-wa-bg)]">
          <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-sm border border-[var(--color-wa-border)]">
            <Search size={32} className="text-[var(--color-wa-green)]" />
          </div>
          <div className="text-center">
            <p className="text-[var(--color-wa-text)] text-[16px] font-semibold">WhatsApp Web</p>
            <p className="text-[var(--color-wa-muted)] text-[13px] mt-1">Select a contact to start chatting and manage your business.</p>
          </div>
        </div>
      )}

      {/* ── WhatsApp-style Full Screen Media Viewer ───────────────────── */}
      {viewerMessage && (() => {
        const mediaObj = viewerMessage.media && Array.isArray(viewerMessage.media) && viewerMessage.media.length > 0 ? viewerMessage.media[0] : null;
        const mediaId = mediaObj?.id || viewerMessage.media_url;
        if (!mediaId) return null;

        const fileSrc = mediaId.startsWith('http') ? mediaId : `/api/media/${mediaId}`;
        const isOut = viewerMessage.direction === 'outbound';

        // Sender details
        const senderName = isOut ? 'You' : (selectedContact?.name || selectedContact?.phone_number || 'Sender');

        // Filter image messages to support left/right arrow navigation
        const imageMessages = messages.filter(m => m.message_type === 'image');
        const currentIndex = imageMessages.findIndex(img => img.id === viewerMessage.id);

        const handlePrev = () => {
          if (currentIndex > 0) {
            setViewerMessage(imageMessages[currentIndex - 1]);
            setZoomScale(1);
          }
        };

        const handleNext = () => {
          if (currentIndex < imageMessages.length - 1) {
            setViewerMessage(imageMessages[currentIndex + 1]);
            setZoomScale(1);
          }
        };

        // File download trigger
        const handleDownload = async () => {
          try {
            const response = await fetch(fileSrc);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = mediaObj?.fileName || `whatsapp_image_${viewerMessage.id}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
          } catch (err) {
            console.error('Failed to download file:', err);
            // fallback
            window.open(fileSrc, '_blank');
          }
        };

        return (
          <div className="fixed inset-0 z-[1000] bg-[#0b141a] select-none flex flex-col justify-between text-white overflow-hidden animate-fadeIn">
            {/* Header */}
            <div className="bg-[#0b141a]/95 px-6 py-3 flex items-center justify-between z-10 border-b border-[#ffffff0a]">
              <div className="flex items-center gap-3">
                <Avatar name={senderName} size={10} />
                <div>
                  <p className="text-[14px] font-semibold text-white">{senderName}</p>
                  <p className="text-[11px] text-gray-400">
                    {new Date(viewerMessage.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} at{' '}
                    {new Date(viewerMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>

              {/* Tools row */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setZoomScale(z => Math.min(z + 0.25, 3))}
                  className="p-2 text-gray-300 hover:text-white rounded-full hover:bg-white/5 transition cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomScale(z => Math.max(z - 0.25, 0.5))}
                  className="p-2 text-gray-300 hover:text-white rounded-full hover:bg-white/5 transition cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="p-2 text-gray-300 hover:text-white rounded-full hover:bg-white/5 transition cursor-pointer"
                  title="Download"
                >
                  <Download size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewerMessage(null)}
                  className="p-2 text-gray-300 hover:text-white rounded-full hover:bg-white/5 transition cursor-pointer"
                  title="Close"
                >
                  <X size={22} />
                </button>
              </div>
            </div>

            {/* Media Area */}
            <div className="relative flex-1 flex items-center justify-center p-4 bg-[#0b141a]/95">

              {/* Left arrow */}
              {currentIndex > 0 && (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="absolute left-6 z-20 w-12 h-12 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center cursor-pointer transition text-white border border-white/5"
                >
                  <ChevronLeft size={28} />
                </button>
              )}

              {/* Centered Image */}
              <div className="relative overflow-hidden max-h-[80vh] max-w-[85vw] flex items-center justify-center transition-transform duration-200">
                <img
                  src={fileSrc}
                  alt="Viewer media"
                  className="max-h-[75vh] max-w-[80vw] object-contain shadow-2xl rounded-md transition-transform duration-100 ease-out select-none"
                  style={{ transform: `scale(${zoomScale})` }}
                />
              </div>

              {/* Right arrow */}
              {currentIndex < imageMessages.length - 1 && (
                <button
                  type="button"
                  onClick={handleNext}
                  className="absolute right-6 z-20 w-12 h-12 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center cursor-pointer transition text-white border border-white/5"
                >
                  <ChevronRight size={28} />
                </button>
              )}
            </div>

            {/* Footer / Caption */}
            {viewerMessage.content && viewerMessage.content !== '[Image]' && (
              <div className="bg-[#0b141a]/95 border-t border-[#ffffff0a] py-5 px-8 text-center z-10 flex flex-col items-center">
                <p className="text-[14.2px] text-gray-200 font-normal leading-relaxed max-w-[70%] text-center">
                  {viewerMessage.content}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Context/Dropdown Menu Backing Overlay */}
      {menuAnchor && (
        <div 
          className="fixed inset-0 z-[99]" 
          onClick={() => { setMenuAnchor(null); setMenuMessage(null); }} 
          onContextMenu={(e) => { e.preventDefault(); setMenuAnchor(null); setMenuMessage(null); }}
        />
      )}

      {/* Custom Dropdown Menu matching WhatsApp Web */}
      {menuAnchor && menuMessage && (
        <div 
          className="fixed z-[100] bg-[#ffffff] border border-[#e9edef] rounded-lg shadow-lg py-1.5 w-[170px] text-[#111b21] overflow-hidden animate-fadeIn"
          style={{ top: Math.min(menuAnchor.y, window.innerHeight - 200), left: Math.min(menuAnchor.x - 140, window.innerWidth - 190) }}
        >
          <button 
            onClick={() => { 
              setReplyingToMessage(menuMessage);
              setMenuAnchor(null);
              setMenuMessage(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#f5f6f6] text-[#111b21] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <Reply size={15} className="text-[#54656f]" /> Reply
          </button>
          <button 
            onClick={() => { 
              navigator.clipboard.writeText(getMessageBodyOnly(menuMessage, templates));
              setMenuAnchor(null);
              setMenuMessage(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#f5f6f6] text-[#111b21] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <Copy size={15} className="text-[#54656f]" /> Copy
          </button>
          
          <div className="border-t border-[#f0f2f5] my-1" />

          <button 
            onClick={() => { 
              setIsSelectionMode(true);
              setSelectedMessageIds([menuMessage.id]);
              setMenuAnchor(null);
              setMenuMessage(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#f5f6f6] text-[#111b21] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <CheckCheck size={15} className="text-[#54656f]" /> Select
          </button>
          
          <div className="border-t border-[#f0f2f5] my-1" />

          <button 
            onClick={() => { 
              setShowDeleteModal(true);
              setMenuAnchor(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] text-[#ff5c5c] hover:bg-[#f5f6f6] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <Trash2 size={15} className="text-[#ff5c5c]" /> Delete
          </button>
        </div>
      )}

      {/* Elegant Deletion Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-gray-100 rounded-xl shadow-2xl w-[320px] p-6 text-[#111b21] animate-scaleUp">
            <h3 className="text-[17px] font-semibold mb-3 text-[#111b21]">Delete message?</h3>
            <p className="text-[13.5px] text-[#667781] mb-6">
              {isSelectionMode
                ? `Do you want to delete ${selectedMessageIds.length} selected messages?`
                : 'Do you want to delete this message?'}
            </p>
            <div className="flex flex-col gap-2">
              {isEligibleForEveryoneDelete() && (
                <button
                  onClick={() => handleExecuteDelete('everyone')}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#00a884] text-white hover:bg-[#009071] text-[14px] font-semibold transition-colors cursor-pointer"
                >
                  Delete for Everyone
                </button>
              )}
              <button
                onClick={() => handleExecuteDelete('me')}
                className="w-full py-2.5 px-4 rounded-lg bg-[#f0f2f5] text-[#3b4a54] hover:bg-[#e1e3e6] text-[14px] font-semibold transition-colors cursor-pointer"
              >
                Delete for Me
              </button>
              <button
                onClick={() => { 
                  setShowDeleteModal(false); 
                  if (!isSelectionMode) setMenuMessage(null);
                }}
                className="w-full py-2.5 px-4 rounded-lg text-[#667781] hover:text-[#111b21] text-[14px] font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
