import React, { useState } from 'react';
import { CheckCheck, FileText, Download, Star as StarIcon } from 'lucide-react';
import type { Message } from '../types';
import MessageContextMenu from './MessageContextMenu';
import { users as allUsers } from '../data/chats';
import ReplyPreview from './ReplyPreview';

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  isGroup?: boolean;
  highlightQuery?: string;
  isFirst?: boolean;
  onReply?: (msg: Message) => void;
  onNavigateToMessage?: (targetId: string) => void;
  activeHighlightId?: string | null;
}

const formatTime = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const MessageBubble = React.memo(({
  message,
  isMe,
  isGroup,
  highlightQuery,
  isFirst = true,
  onReply,
  onNavigateToMessage,
  activeHighlightId
}: MessageBubbleProps) => {
  const { content, timestamp, status, isDeleted: initialDeleted, type = 'text', mediaUrl, fileName, fileSize, senderId } = message;

  const [isStarred, setIsStarred] = useState(false);
  const [isDeleted, setIsDeleted] = useState(initialDeleted || false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const sender = allUsers.find(u => u.id === senderId);

  const highlightText = (text: string, query: string) => {
    if (!query || !query.trim()) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() 
            ? <span key={i} className="bg-[#ffdc18] text-[#000] rounded-[2px] px-[1px]">{part}</span> 
            : part
        )}
      </>
    );
  };

  const renderContent = () => {
    if (isDeleted) {
      return <span className="italic text-[var(--text-secondary)] text-[13px] flex items-center gap-1.5"><span className="text-[12px]">🚫</span> This message was deleted</span>;
    }

    switch (type) {
      case 'image':
        return (
          <div className="relative rounded-md overflow-hidden -mx-1 -mt-1 mb-1.5 bg-[#1b282d]">
            <img src={mediaUrl} alt="Media" className="w-full block max-h-[420px] object-cover cursor-pointer hover:opacity-95 transition-opacity" />
            {content && content !== 'Image' && !content.startsWith('Sent image:') && (
              <p className="text-[14.2px] text-[var(--text-primary)] px-2 pt-2 pb-1 leading-relaxed">
                {highlightText(content, highlightQuery || '')}
              </p>
            )}
          </div>
        );
      case 'document':
        return (
          <div className="flex items-center gap-3 p-2 bg-[#1b282d] rounded-md mb-2 cursor-pointer hover:bg-[#202c33] transition-colors">
            <div className="bg-[#ff5c5c] p-2.5 rounded-md text-white shrink-0"><FileText size={20} /></div>
            <div className="flex-1 overflow-hidden min-w-0">
               <div className="text-[14px] font-normal text-[var(--text-primary)] truncate">{fileName}</div>
               <div className="text-[11px] text-[var(--text-secondary)] uppercase mt-0.5">{fileSize} • PDF</div>
            </div>
            <Download size={18} className="text-[var(--wa-green)] shrink-0" />
          </div>
        );
      default:
        return (
          <div className="flex flex-col">
            <p className="text-[14.2px] leading-[19px] text-[var(--text-primary)] whitespace-pre-wrap break-words m-0">
              {highlightText(content, highlightQuery || '')}
              <span className="inline-block w-[70px]" /> {/* Spacer for timestamp */}
            </p>
          </div>
        );
    }
  };

  return (
    <div 
      id={`mock-msg-${message.id}`}
      className={`flex w-full mb-1 px-[6%] ${isMe ? 'justify-end' : 'justify-start'} ${isFirst ? 'mt-2' : ''}`}
    >
      <div className={`relative max-w-[85%] sm:max-w-[65%] group flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        
        {/* SVG Tail */}
        {isFirst && (
          <div className={`absolute top-0 w-3 h-3 z-0 ${isMe ? '-right-2' : '-left-2'}`}>
             <svg viewBox="0 0 8 13" preserveAspectRatio="none" className="w-full h-full">
                <path 
                  d={isMe ? "M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" : "M6.467 3.568 0 12.193V1h5.188C6.958 1 7.526 2.156 6.467 3.568z"} 
                  fill={isMe ? "var(--bg-bubble-sent)" : "var(--bg-bubble-received)"}
                />
             </svg>
          </div>
        )}

        {/* The Bubble */}
        <div 
          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
          className={`relative px-2 pt-1.5 pb-1 rounded-[7.5px] shadow-sm select-text flex flex-col min-w-[60px] transition-all duration-300 ${
            isMe 
              ? 'bg-[var(--bg-bubble-sent)]' 
              : 'bg-[var(--bg-bubble-received)]'
          } ${isFirst ? (isMe ? 'rounded-tr-none' : 'rounded-tl-none') : ''} ${
            activeHighlightId === message.id ? 'animate-messageHighlight' : ''
          }`}
        >
          {isGroup && !isMe && sender && !isDeleted && isFirst && (
            <div className="text-[13px] font-semibold mb-1 leading-tight flex items-center justify-between" style={{ color: sender.avatarColor || '#53bdeb' }}>
              <span>{sender.name}</span>
            </div>
          )}

          {message.reply_to_message_id && message.reply_to_message && (
            <ReplyPreview
              senderName={message.reply_to_message.sender_name}
              content={message.reply_to_message.content}
              isOutbound={isMe}
              onClick={() => onNavigateToMessage?.(message.reply_to_message_id!)}
            />
          )}

          <div className="relative">
            {renderContent()}

            {/* Timestamp & Status Icon Row */}
            <div className={`flex items-center gap-1.5 self-end justify-end ml-2 h-4 select-none ${type === 'text' ? 'absolute -bottom-0.5 right-0' : 'float-right -mt-1 mb-0.5'}`}>
              {isStarred && <StarIcon size={10} className="fill-[var(--text-secondary)] text-[var(--text-secondary)] opacity-60" />}
              <span className="text-[11px] text-[var(--text-secondary)] opacity-90 uppercase translate-y-[1px]">{formatTime(timestamp)}</span>
              {isMe && !isDeleted && (
                <div className="flex items-center">
                  <CheckCheck size={16} className={`${status === 'read' ? 'text-[var(--wa-blue)]' : 'text-[var(--text-secondary)]'} opacity-90`} />
                </div>
              )}
            </div>
          </div>
        </div>

        {contextMenu && (
          <MessageContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            isMe={isMe}
            onReply={() => { onReply?.(message); setContextMenu(null); }}
            onCopy={() => navigator.clipboard.writeText(content)}
            onStar={() => setIsStarred(!isStarred)}
            onDelete={() => setIsDeleted(true)}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
