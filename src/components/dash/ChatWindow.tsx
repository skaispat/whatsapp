'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useDashStore } from '@/lib/store';
import type { DashMessage } from '@/lib/store';
import { formatTime, formatFullDateTime, getInitials, generateAvatarColor } from '@/lib/utils';
import { 
  Send, 
  ArrowDown, 
  Info, 
  Clock, 
  Check, 
  CheckCheck, 
  AlertCircle, 
  Loader2, 
  FileText, 
  ArrowLeft,
  ChevronDown,
  Trash2,
  X,
  Reply,
  Copy,
  Forward,
  Pin,
  Star,
  ShieldAlert
} from 'lucide-react';
import TemplateSender from './TemplateSender';

export default function DashChatWindow() {
  const {
    messages,
    conversations,
    activeConversationId,
    loadingMessages,
    sendMessage,
    setActiveConversation,
    deleteMessage,
    deleteMessages,
  } = useDashStore();

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [statusTooltip, setStatusTooltip] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Selection / Deletion states
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [menuMessage, setMenuMessage] = useState<DashMessage | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const contact = activeConv?.contact;
  const contactName = contact?.name || contact?.phone_number || 'Unknown';
  const contactPhone = contact?.phone_number || '';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const isNear = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isNear) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Scroll to bottom on conversation switch
  useEffect(() => {
    setSelectedMessageIds([]);
    setIsSelectionMode(false);
    setMenuAnchor(null);
    setMenuMessage(null);
    setShowDeleteModal(false);
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 100);
  }, [activeConversationId]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    setShowScrollBtn(
      container.scrollHeight - container.scrollTop - container.clientHeight > 300
    );
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !contactPhone || !activeConversationId) return;

    setInputText('');
    setSending(true);
    try {
      await sendMessage(contactPhone, text, activeConversationId);
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

  // Group messages by date
  const groupedMessages = groupByDate(messages);

  // Send template function
  const handleSendTemplate = async (
    templateName: string,
    languageCode: string,
    components: any[],
    resolvedText: string
  ) => {
    if (!contactPhone || !activeConversationId) return;
    try {
      const res = await fetch('/api/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: contactPhone,
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative">
      {/* Header */}
      <div className="h-[60px] bg-[#202c33] px-2 md:px-4 flex items-center gap-2 md:gap-3 shrink-0 border-b border-[#2a3942]/30">
        <button
          onClick={() => setActiveConversation(null)}
          className="p-2 -ml-1 md:hidden text-[#8696a0] hover:text-[#e9edef] rounded-full transition-colors active:bg-[#2a3942]"
        >
          <ArrowLeft size={20} />
        </button>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[15px] font-semibold shrink-0"
          style={{ backgroundColor: generateAvatarColor(contactName) }}
        >
          {getInitials(contactName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] text-[#e9edef] font-medium truncate">
            {contactName}
          </div>
          <div className="text-[12px] text-[#8696a0] truncate">{contactPhone}</div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-[#0b141a]">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'url("/backgroundImage.webp")',
          backgroundRepeat: 'repeat',
          backgroundSize: '412px',
        }} />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto pt-4 pb-2 px-4 relative z-10"
        >
          {loadingMessages ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="bg-[#182229] px-6 py-3 rounded-lg text-[#8696a0] text-sm">
                No messages yet. Send a message to start the conversation.
              </div>
            </div>
          ) : (
            groupedMessages.map((group) => (
              <div key={group.date}>
                {/* Date Divider */}
                <div className="flex justify-center my-4">
                  <span className="bg-[#182229] text-[#8696a0] text-[11px] px-3 py-1 rounded-[7px] shadow-sm font-medium uppercase tracking-wide">
                    {group.date}
                  </span>
                </div>

                {/* Messages */}
                {group.messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    onShowStatus={(id) =>
                      setStatusTooltip(statusTooltip === id ? null : id)
                    }
                    showStatus={statusTooltip === msg.id}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedMessageIds.includes(msg.id)}
                    onToggleSelect={() => {
                      if (selectedMessageIds.includes(msg.id)) {
                        setSelectedMessageIds(selectedMessageIds.filter((id) => id !== msg.id));
                      } else {
                        setSelectedMessageIds([...selectedMessageIds, msg.id]);
                      }
                    }}
                    onOpenDropdown={(e, msg) => {
                      setMenuAnchor({ x: e.clientX, y: e.clientY });
                      setMenuMessage(msg);
                    }}
                  />
                ))}
              </div>
            ))
          )}
          <div ref={bottomRef} className="h-2" />
        </div>

        {/* Scroll to bottom */}
        {showScrollBtn && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-4 right-6 w-10 h-10 bg-[#202c33] rounded-full flex items-center justify-center shadow-lg text-[#8696a0] hover:text-[#e9edef] transition-colors z-20"
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>

      {/* Template Sender Popup */}
      {showTemplatePicker && (
        <TemplateSender
          onSend={handleSendTemplate}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      {/* Bottom control bar: Selection vs Message Input */}
      {isSelectionMode ? (
        <div className="bg-[#202c33] h-[60px] px-6 flex items-center justify-between shrink-0 border-t border-[#2a3942]/30 relative z-20 animate-slideUp">
          <div className="flex items-center gap-4 text-[#e9edef]">
            <button
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedMessageIds([]);
              }}
              className="p-1.5 hover:bg-[#2a3942] rounded-full transition-colors text-[#8696a0] hover:text-[#e9edef]"
            >
              <X size={20} />
            </button>
            <span className="text-[14px] font-medium">
              {selectedMessageIds.length} selected
            </span>
          </div>

          <button
            onClick={() => setShowDeleteModal(true)}
            disabled={selectedMessageIds.length === 0}
            className="w-10 h-10 rounded-full bg-[#ff5c5c]/10 text-[#ff5c5c] flex items-center justify-center shrink-0 hover:bg-[#ff5c5c]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            title="Delete Selected"
          >
            <Trash2 size={18} />
          </button>
        </div>
      ) : (
        <div className="bg-[#202c33] px-4 py-3 flex items-end gap-3 shrink-0 border-t border-[#2a3942]/30 relative z-20">
          <button
            onClick={() => setShowTemplatePicker(!showTemplatePicker)}
            title="Send Template"
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${
              showTemplatePicker
                ? 'bg-[#00a884] text-[#111b21]'
                : 'bg-[#2a3942] text-[#8696a0] hover:text-[#e9edef] hover:bg-[#3b4a54]'
            }`}
          >
            <FileText size={18} />
          </button>

          <div className="flex-1 bg-[#2a3942] rounded-lg px-4 py-2.5 flex items-end">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message"
              rows={1}
              className="flex-1 bg-transparent border-none outline-none text-[14px] text-[#e9edef] placeholder:text-[#8696a0]/50 resize-none max-h-[120px]"
              style={{ minHeight: '24px' }}
            />
          </div>

          <button
            onClick={handleSend}
            disabled={sending || !inputText.trim()}
            className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-[#111b21] shrink-0 hover:bg-[#00a884]/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            {sending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      )}

      {/* Context/Dropdown Menu Backing Overlay */}
      {menuAnchor && (
        <div 
          className="fixed inset-0 z-[99]" 
          onClick={() => { setMenuAnchor(null); setMenuMessage(null); }} 
          onContextMenu={(e) => { e.preventDefault(); setMenuAnchor(null); setMenuMessage(null); }}
        />
      )}

      {/* Custom Dropdown Menu matching the image */}
      {menuAnchor && menuMessage && (
        <div 
          className="fixed z-[100] bg-[#233138] border border-[#2f3b43] rounded-lg shadow-xl py-1.5 w-[170px] text-[#e9edef] overflow-hidden"
          style={{ top: Math.min(menuAnchor.y, window.innerHeight - 320), left: Math.min(menuAnchor.x, window.innerWidth - 190) }}
        >
          <button onClick={() => { setMenuAnchor(null); }} className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3">
            <Reply size={15} className="text-[#8696a0]" /> Reply
          </button>
          <button 
            onClick={() => { 
              navigator.clipboard.writeText(menuMessage.content);
              setMenuAnchor(null);
              setMenuMessage(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3"
          >
            <Copy size={15} className="text-[#8696a0]" /> Copy
          </button>
          <button onClick={() => { setMenuAnchor(null); }} className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3">
            <Forward size={15} className="text-[#8696a0]" /> Forward
          </button>
          <button onClick={() => { setMenuAnchor(null); }} className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3">
            <Pin size={15} className="text-[#8696a0]" /> Pin
          </button>
          <button onClick={() => { setMenuAnchor(null); }} className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3">
            <Star size={15} className="text-[#8696a0]" /> Star
          </button>
          
          <div className="border-t border-[#2a3942]/50 my-1" />

          <button 
            onClick={() => { 
              setIsSelectionMode(true);
              setSelectedMessageIds([menuMessage.id]);
              setMenuAnchor(null);
              setMenuMessage(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3"
          >
            <CheckCheck size={15} className="text-[#8696a0]" /> Select
          </button>
          
          <div className="border-t border-[#2a3942]/50 my-1" />

          <button onClick={() => { setMenuAnchor(null); }} className="w-full text-left px-4 py-2 text-[13.5px] hover:bg-[#182229] transition-colors flex items-center gap-3">
            <ShieldAlert size={15} className="text-[#8696a0]" /> Report
          </button>
          <button 
            onClick={() => { 
              setShowDeleteModal(true);
              setMenuAnchor(null);
            }} 
            className="w-full text-left px-4 py-2 text-[13.5px] text-[#ff5c5c] hover:bg-[#182229] transition-colors flex items-center gap-3"
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

// ---- Message Bubble ----
function MessageBubble({
  message,
  onShowStatus,
  showStatus,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  onOpenDropdown,
}: {
  message: DashMessage;
  onShowStatus: (id: string) => void;
  showStatus: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpenDropdown: (e: React.MouseEvent, msg: DashMessage) => void;
}) {
  const isMe = message.direction === 'outbound';
  const isRevoked = message.message_type === 'revoked' || message.content === '🚫 This message was deleted';

  return (
    <div className={`flex items-center gap-3 mb-1 px-2 ${isMe ? 'justify-end' : 'justify-start'} group/row`}>
      {isSelectionMode && (
        <input 
          type="checkbox" 
          checked={isSelected}
          onChange={onToggleSelect}
          className="w-4 h-4 cursor-pointer accent-[#00a884] shrink-0 z-10"
        />
      )}

      <div
        onClick={isSelectionMode ? onToggleSelect : undefined}
        className={`relative max-w-[65%] px-3 py-1.5 rounded-lg text-[14px] leading-[19px] shadow-sm group/bubble ${
          isSelectionMode ? 'cursor-pointer hover:opacity-95' : ''
        } ${
          isMe
            ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none'
            : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
        }`}
      >
        {/* Dropdown Chevron matching WhatsApp hover button */}
        {!isSelectionMode && !isRevoked && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDropdown(e, message);
            }}
            className="absolute top-1 right-1 p-0.5 rounded text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942]/30 opacity-0 group-hover/bubble:opacity-100 transition-opacity z-10"
          >
            <ChevronDown size={14} />
          </button>
        )}

        {/* Content */}
        {isRevoked ? (
          <span className="italic text-[#8696a0] flex items-center gap-1.5">
            <span>🚫</span> This message was deleted
          </span>
        ) : (
          <span className="whitespace-pre-wrap break-words pr-2">{message.content}</span>
        )}

        {/* Meta row: time + status */}
        <span className="float-right ml-3 mt-1 flex items-center gap-1 text-[11px] text-[#ffffff99] select-none">
          <span>{formatTime(message.created_at)}</span>
          {isMe && !isRevoked && <StatusIcon status={message.status} onClick={() => onShowStatus(message.id)} />}
        </span>

        {/* Status Details Tooltip */}
        {showStatus && isMe && !isRevoked && (
          <div className="absolute bottom-full right-0 mb-1 bg-[#182229] border border-[#2a3942] rounded-lg px-4 py-3 text-[12px] shadow-xl z-30 w-[220px]">
            <div className="text-[#e9edef] font-medium mb-2 flex items-center gap-1.5">
              <Info size={14} className="text-[#00a884]" /> Message Info
            </div>
            <div className="space-y-1.5 text-[#8696a0]">
              <div className="flex justify-between">
                <span>Status</span>
                <span className={`font-medium ${
                  message.status === 'read' ? 'text-[#53BDEB]' :
                  message.status === 'delivered' ? 'text-[#8696a0]' :
                  message.status === 'failed' ? 'text-[#ff5c5c]' :
                  'text-[#8696a0]'
                }`}>{message.status}</span>
              </div>
              {message.delivered_at && (
                <div className="flex justify-between">
                  <span>Delivered</span>
                  <span className="text-[#e9edef]">{formatFullDateTime(message.delivered_at)}</span>
                </div>
              )}
              {message.seen_at && (
                <div className="flex justify-between">
                  <span>Seen</span>
                  <span className="text-[#53BDEB]">{formatFullDateTime(message.seen_at)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Status Ticks ----
function StatusIcon({ status, onClick }: { status: string; onClick: () => void }) {
  const baseClass = 'cursor-pointer';
  switch (status) {
    case 'read':
      return <CheckCheck size={16} className={`${baseClass} text-[#53BDEB]`} onClick={onClick} />;
    case 'delivered':
      return <CheckCheck size={16} className={`${baseClass} text-[#ffffff80]`} onClick={onClick} />;
    case 'sent':
      return <Check size={16} className={`${baseClass} text-[#ffffff80]`} onClick={onClick} />;
    case 'failed':
      return <AlertCircle size={14} className={`${baseClass} text-[#ff5c5c]`} onClick={onClick} />;
    default:
      return <Clock size={13} className={`${baseClass} text-[#ffffff60]`} onClick={onClick} />;
  }
}

// ---- Group by Date ----
function groupByDate(messages: DashMessage[]) {
  const groups: { date: string; messages: DashMessage[] }[] = [];
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
      label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
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
