import { useEffect, useRef } from 'react';
import './ContextMenu.css';

function ContextMenu({ items, position, onClose }) {
  const menuRef = useRef(null);

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

  // Adjust position to stay within viewport
  const menuWidth = 180;
  const menuHeight = 150;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 10);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 10);
  const style = {
    top: Math.max(10, y),
    left: Math.max(10, x),
  };

  return (
    <div className="context-menu-overlay">
      <div className="context-menu" ref={menuRef} style={style}>
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
