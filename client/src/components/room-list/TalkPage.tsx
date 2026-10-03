/**
 * #487 `/talk` の本体。一覧そのもの (RoomList) はサイドバーの 1 つだけにする。
 *
 * ★ 以前はここにも RoomList を置いていて、一覧が 2 つ動いていた (PC では 2 つ並び、スマホでも裏で 2 つ動いて
 *   新着の音・一覧の取り直しが 2 回ずつ起きた)。スマホでは `/talk` のときサイドバーを全画面で出し、
 *   この案内は隠れる (DesktopShell.css の .desktop-shell--talk)。PC ではこの案内が本体に出る。
 */
import './TalkPage.css';

function TalkPage() {
  return (
    <div className="talk-placeholder">
      <p>左の一覧からトークを選んでください</p>
    </div>
  );
}

export default TalkPage;
