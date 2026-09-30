/**
 * 転送後のトーストを組み立てる (2026-09-30)。
 * ★ 部屋名・表示名は利用者が決める文字列なので、innerHTML に混ぜず textContent で入れる
 */
export function buildForwardToast(name: string, onOpen: () => void): HTMLDivElement {
  const toast = document.createElement('div');
  toast.className = 'forward-toast';
  const label = document.createElement('span');
  label.textContent = `📤 「${name}」に転送しました`;
  const button = document.createElement('button');
  button.className = 'forward-toast-open';
  button.textContent = '開く';
  button.addEventListener('click', onOpen);
  toast.append(label, button);
  return toast;
}
