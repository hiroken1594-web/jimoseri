/** 自然文入力の文字数上限（画面とサーバーの両方で使う） */
export const MAX_TEXT_LENGTH = 300

export const USERNAME_MIN = 4
export const USERNAME_MAX = 20

// なりすましに使われやすい名前は登録させない
const RESERVED = ['admin', 'administrator', 'root', 'system', 'support', 'staff', 'official', 'jimoseri', 'unei', 'null', 'undefined']

/** ユーザー名：半角の英小文字・数字・アンダースコア。英字で始める。 */
export function isValidUsername(value: string): boolean {
  return (
    value.length >= USERNAME_MIN &&
    value.length <= USERNAME_MAX &&
    /^[a-z][a-z0-9_]*$/.test(value) &&
    !RESERVED.includes(value)
  )
}
