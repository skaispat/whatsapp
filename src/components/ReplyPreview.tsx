import React from 'react';
import { X } from 'lucide-react';

interface ReplyPreviewProps {
  senderName: string;
  content: string;
  onClick?: () => void;
  onClear?: () => void;
  isOutbound?: boolean;
}

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  // Use a nice readable green/teal/blue color palette for WhatsApp style
  return `hsl(${h}, 50%, 40%)`;
};

export const ReplyPreview: React.FC<ReplyPreviewProps> = ({
  senderName,
  content,
  onClick,
  onClear,
  isOutbound = false,
}) => {
  const nameColor = stringToColor(senderName);

  return (
    <div
      onClick={onClick}
      className={`
        w-full min-w-0 flex items-stretch rounded-[6px] overflow-hidden text-left mb-1.5 transition-all select-none
        ${onClick ? 'cursor-pointer hover:bg-black/5 active:bg-black/10' : ''}
        ${
          isOutbound
            ? 'bg-[#005c4b]/10 text-[#111b21]'
            : 'bg-[#f0f2f5]/90 text-[#111b21]'
        }
      `}
      style={{ minHeight: '44px', maxHeight: '60px' }}
    >
      {/* Left indicator line */}
      <div
        className="w-1.5 shrink-0"
        style={{ backgroundColor: nameColor }}
      />

      {/* Content wrapper */}
      <div className="flex-1 min-w-0 p-2 flex flex-col justify-center text-xs leading-tight">
        <span
          className="font-bold truncate mb-0.5"
          style={{ color: nameColor }}
        >
          {senderName}
        </span>
        <span className="truncate text-gray-600">
          {content}
        </span>
      </div>

      {/* Close button (when used above input field) */}
      {onClear && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="px-2.5 flex items-center justify-center hover:bg-black/5 active:bg-black/10 text-gray-500 hover:text-gray-700 transition-colors"
          title="Cancel reply"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default ReplyPreview;
