import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './ContextMenu.css';

// ✅ = 完了マーカー（業務メモ 6/27 小野さん要望）。先頭で押しやすく。
const REACTION_EMOJIS = ['✅', '👍', '❤️', '😂', '🎉', '👀', '🙏'];

export interface ContextMenuItem {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
  onReaction?: (emoji: string) => void;
}

function ContextMenu({ items, position, onClose, onReaction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: position.x, y: position.y });

  useEffect(() => {
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [onClose]);

  // Adjust position after render based on actual menu size
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(10, Math.min(position.x, window.innerWidth - rect.width - 10));
    const y = Math.max(10, Math.min(position.y, window.innerHeight - rect.height - 10));
    setAdjustedPos({ x, y });
  }, [position]);

  return (
    <div className="context-menu-overlay">
      <div className="context-menu" ref={menuRef} style={{ top: adjustedPos.y, left: adjustedPos.x }}>
        {onReaction && (
          <div className="context-menu-reactions">
            {REACTION_EMOJIS.map(emoji => (
              <button key={emoji} className="reaction-emoji-btn" onClick={() => onReaction(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
        {items.map((item, i) => (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ContextMenu;
