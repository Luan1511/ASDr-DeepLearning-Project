import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessageContent } from './ChatMessageContent'

const render = (content: string) => renderToStaticMarkup(<ChatMessageContent content={content} />)

describe('ChatMessageContent', () => {
  it('formats emphasis, lists, headings and preserves citation markers', () => {
    const html = render('### Hỗ trợ trẻ\n\n**Dấu hiệu sớm** và *lưu ý* [1]\n\n- Giao tiếp\n- Vận động\n\n1. Quan sát\n2. Ghi lại')
    expect(html).toMatch(/<h4[^>]*>Hỗ trợ trẻ<\/h4>/)
    expect(html).toMatch(/<strong[^>]*>Dấu hiệu sớm<\/strong>/)
    expect(html).toContain('<em>lưu ý</em> [1]')
    expect(html).toMatch(/<ul[^>]*>/)
    expect(html).toMatch(/<ol[^>]*>/)
    expect(html).not.toContain('**')
  })

  it('renders GFM tables and safe source links', () => {
    const html = render('| Nội dung | Gợi ý |\n| --- | --- |\n| Ngủ | Giờ cố định |\n\n[Nguồn](https://example.com/source)')
    expect(html).toContain('<table')
    expect(html).toContain('href="https://example.com/source"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('does not execute embedded HTML or create unsafe links or remote images', () => {
    const html = render('<script>alert(1)</script>\n\n[Nhấn](javascript:alert%281%29)\n\n<img src="x" onerror="alert(1)">\n\n![Theo dõi](https://example.com/track.png)')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('onerror')
    expect(html).toContain('Nhấn')
  })
})
