/**
 * 届け先に打つ文面のひな型 (docs/12 §8 の 1・3・16)。
 * ★ 本文は入れない (書いた人が user として指示できてしまう)。入れるのは班・件数・最新の id・手順の名前だけ
 * ★ 1 行 (改行を入れない。打つことと Enter を分けるため)
 * ★ id と project は形を確かめてから入れる (SSH の引用で壊れる文字を通さない)
 */
import { QUEUE_ID_RE } from './queue.mts';
import { isValidProject } from './cursor.mts';

export function buildNotice(project: string, count: number, lastId: string, lost: boolean): string {
  if (!isValidProject(project)) throw new Error('project 名の形が違います');
  if (!QUEUE_ID_RE.test(lastId)) throw new Error('id の形が違います');
  const what = lost ? '新着あり' : `新着 ${Math.max(1, Math.floor(count))} 件`;
  return `Tealus: @cc-${project} に${what} (最新 id=${lastId})。handle-tealus の手順で読んで対応してください`;
}
