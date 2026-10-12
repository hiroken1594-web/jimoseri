// メール送信（メールアドレスの確認・パスワード再設定）。
// 送信方法を差し替えやすいよう、SMTP の設定は環境変数だけで決める（初期設定は Gmail）。
import { appendFileSync, mkdirSync } from 'node:fs'
import nodemailer, { type Transporter } from 'nodemailer'
import { serviceName } from './config.js'

interface Mail {
  to: string
  subject: string
  text: string
}

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return null
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user, pass },
  })
  return transporter
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)
}

export async function sendMail(mail: Mail): Promise<void> {
  const smtp = getTransporter()
  if (!smtp) {
    if (process.env.VERCEL) {
      // 本番で設定漏れのまま「送ったことにする」ことはしない
      console.error('[mail] SMTP is not configured; mail was not sent')
      return
    }
    // ローカル開発：実際には送らず、内容をファイルに残す（テストから読み取る）
    mkdirSync('.dev-mail', { recursive: true })
    appendFileSync('.dev-mail/outbox.jsonl', JSON.stringify({ ...mail, at: Date.now() }) + '\n')
    console.log(`[mail:dev] to=${mail.to} subject=${mail.subject}`)
    return
  }
  try {
    await smtp.sendMail({
      from: process.env.MAIL_FROM || `"${serviceName()}" <${process.env.SMTP_USER}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    })
  } catch (error) {
    console.error('[mail] failed to send:', error instanceof Error ? error.message : error)
  }
}

const footer = () =>
  `\n\n――――――――\n${serviceName()}\nこのメールに心当たりがない場合は、何もせずに破棄してください。このメールは送信専用です。`

export const verificationMail = (to: string, url: string): Mail => ({
  to,
  subject: `【${serviceName()}】メールアドレスの確認`,
  text: `${serviceName()}へのご登録ありがとうございます。\n\n下のリンクを開くと、メールアドレスの確認が完了します（有効期限：1時間）。\n\n${url}${footer()}`,
})

export const resetPasswordMail = (to: string, url: string): Mail => ({
  to,
  subject: `【${serviceName()}】パスワードの再設定`,
  text: `パスワード再設定のお申し込みを受け付けました。\n\n下のリンクを開いて、新しいパスワードを設定してください（有効期限：1時間）。\n\n${url}${footer()}`,
})
