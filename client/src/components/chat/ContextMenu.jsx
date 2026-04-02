import { useEffect, useRef, useState } from 'react';
import './ContextMenu.css';

function ContextMenu({ items, position, onClose }) {
  const menuRef = useRef(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: position.x, y: position.y });

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
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
