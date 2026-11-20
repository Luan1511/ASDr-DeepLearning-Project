import { describe, expect, it } from 'vitest'
import { chatErrorMessage } from './chatErrors'

const error = (status: number, data: unknown) => ({ isAxiosError: true, response: { status, data } })
describe('chatErrorMessage', () => {
  it('does not display a Cloudflare page or raw English text', () => {
    for (const data of ['The origin web server returned an invalid or incomplete response to Cloudflare.', '<html>Bad Gateway</html>', { message: 'The origin web server returned an invalid response' }]) {
      const message = chatErrorMessage(error(502, data))
      expect(message).toContain('Kết nối tới trợ lý')
      expect(message).not.toContain('Cloudflare')
      expect(message).not.toContain('<html>')
    }
  })
  it('shows the known model error rather than an arbitrary upstream message', () => {
    expect(chatErrorMessage(error(503, { error: 'CHAT_LANGUAGE_ERROR', message: 'private upstream text' }))).toContain('tiếng Việt')
    expect(chatErrorMessage(error(503, { error: 'CHAT_CITATION_ERROR' }))).toContain('nguồn')
    expect(chatErrorMessage(error(503, { error: '__proto__', message: 'private' }))).not.toContain('private')
  })
  it('distinguishes timeout, auth, stale conversation and offline states', () => {
    expect(chatErrorMessage(error(524, 'Cloudflare timeout'))).toContain('lâu hơn')
    expect(chatErrorMessage(error(401, {}))).toContain('đăng nhập')
    expect(chatErrorMessage(error(409, {}))).toContain('tin nhắn mới')
    expect(chatErrorMessage({ isAxiosError: true, code: 'ECONNABORTED' })).toContain('lâu hơn')
    expect(chatErrorMessage(new Error('private'))).not.toContain('private')
  })
})
