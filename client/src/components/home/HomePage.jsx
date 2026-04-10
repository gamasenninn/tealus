import { useState } from 'react';
import BottomNav from '../common/BottomNav';
import './HomePage.css';

function HomePage() {
  const [activeTab, setActiveTab] = useState('announcements');

  return (
    <div className="home-container">
      <header className="home-header">
        <h1>ホーム</h1>
      </header>

      <div className="home-tabs">
        <button
          className={`home-tab ${activeTab === 'announcements' ? 'active' : ''}`}
          onClick={() => setActiveTab('announcements')}
        >
          お知らせ
        </button>
      </div>

      <div className="home-content">
        {activeTab === 'announcements' && (
          <div className="home-empty">
            お知らせはありません
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

export default HomePage;
