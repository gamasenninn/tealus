import './CallBanner.css';

function CallBanner() {
  const handleClick = () => {
    // 同名ウィンドウを再利用してフォーカスを戻す
    window.open('', 'tealus-call');
  };

  return (
    <div className="call-banner" onClick={handleClick}>
      📞 通話中 — タップで戻る
    </div>
  );
}

export default CallBanner;
