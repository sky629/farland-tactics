/**
 * Dialog 124 "스테이지 선택" — the original's title-screen choice: a list (1051) under "플레이할 화면을 선택해 주십시오.", 게임 개시(1)
 * and 불러오기(2). The retail game lists the single campaign; the stage names of the executable (00:신천지 … 24:우연한 만남) belong to
 * its debug stage select and are not offered [추정].
 */
import { DialogBox, type DialogHost } from '../dialog';

export type TitleChoice = 'new' | 'load';

export function titleChoice(id: number): TitleChoice | null { return id === 1 ? 'new' : id === 2 ? 'load' : null; }

export function titleDialog(host: DialogHost): Promise<TitleChoice> {
  const box = new DialogBox<TitleChoice>(host, 124);
  box.setList(1051, [{ text: '파랜드 택틱스 2  시간의 이정표' }], () => {});
  box.control(1051).firstElementChild?.classList.add('selected');
  box.onClick(1, () => box.close('new'));
  box.onClick(2, () => box.close('load'));
  return box.show();
}
