# Builds AIMBRACE_AI4Life_2026.pptx on top of "Template Slide AI4Life.pptx".
# Run from docs/ai4life_slide:  python build_deck.py
import copy
from pathlib import Path

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).parent
ASSETS = HERE / 'assets'
ICONS = ASSETS / 'icons'
SHOTS = HERE / 'shots'
CROPS = ASSETS / 'crops'
LOGO = HERE.parent.parent / 'frontend' / 'public' / 'logo-horizontal.png'
OUT = HERE / 'AIMBRACE_AI4Life_2026.pptx'

# Palette: template blue/yellow + AIMBRACE green
NAVY = RGBColor(0x0B, 0x2A, 0x6F)
BLUE = RGBColor(0x00, 0x39, 0xA6)
GREEN = RGBColor(0x1E, 0x6B, 0x45)
GREEN_SOFT = RGBColor(0xE6, 0xF2, 0xEA)
BLUE_SOFT = RGBColor(0xEC, 0xF2, 0xFC)
YELLOW = RGBColor(0xFF, 0xC7, 0x2C)
YELLOW_SOFT = RGBColor(0xFF, 0xF4, 0xD1)
AMBER = RGBColor(0xB7, 0x6E, 0x00)
INK = RGBColor(0x1F, 0x29, 0x37)
MUTE = RGBColor(0x5B, 0x67, 0x7A)
LINE = RGBColor(0xD5, 0xDC, 0xE6)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
RED_SOFT = RGBColor(0xFD, 0xEC, 0xEC)
RED = RGBColor(0xB4, 0x23, 0x18)

HEAD = 'Arial'
BODY = 'Calibri'

prs = Presentation(str(HERE / 'template.pptx'))
# Remove the template's 4 sample slides; keep its layouts and backgrounds.
for sld_id in list(prs.slides._sldIdLst):
    prs.part.drop_rel(sld_id.rId)
    prs.slides._sldIdLst.remove(sld_id)
LAYOUT = {l.name: l for l in prs.slide_layouts}
COVER, TITLE_BG, CONTENT = LAYOUT['Title Slide'], LAYOUT['1_Title Slide'], LAYOUT['1_Title and Content']

TOTAL = 20
state = {'n': 0}


# ---------------------------------------------------------------- helpers
def rgb_hex(c):
    return str(c)


def set_run(run, size=14, bold=False, color=INK, font=BODY, italic=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.name = font
    run.font.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    for tag in ('a:ea', 'a:cs'):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set('typeface', font)


def text(slide, x, y, w, h, paras, size=14, color=INK, bold=False, font=BODY, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, space_after=0, line_spacing=None, name=None):
    """paras: str | list[str | list[(text, opts)]] — one paragraph per item."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    if isinstance(paras, str):
        paras = [paras]
    for i, p in enumerate(paras):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = align
        if space_after:
            para.space_after = Pt(space_after)
        if line_spacing:
            para.line_spacing = line_spacing
        runs = [(p, {})] if isinstance(p, str) else p
        for t, o in runs:
            r = para.add_run()
            r.text = t
            set_run(r, size=o.get('size', size), bold=o.get('bold', bold), color=o.get('color', color),
                    font=o.get('font', font), italic=o.get('italic', False))
    return tb


def bullets(slide, x, y, w, h, items, size=14, color=INK, space_after=6, bullet_color=GREEN):
    tb = text(slide, x, y, w, h, [[('', {})] for _ in items], size=size, color=color)
    tf = tb.text_frame
    for para, item in zip(tf.paragraphs, items):
        for r in list(para.runs):
            r._r.getparent().remove(r._r)
        runs = [(item, {})] if isinstance(item, str) else item
        for t, o in runs:
            r = para.add_run()
            r.text = t
            set_run(r, size=o.get('size', size), bold=o.get('bold', False), color=o.get('color', color))
        para.space_after = Pt(space_after)
        pPr = para._p.get_or_add_pPr()
        pPr.set('marL', str(Inches(0.22)))
        pPr.set('indent', str(-Inches(0.22)))
        for tag in ('a:buNone', 'a:buChar', 'a:buAutoNum'):
            for el in pPr.findall(qn(tag)):
                pPr.remove(el)
        buClr = etree.SubElement(pPr, qn('a:buClr'))
        etree.SubElement(buClr, qn('a:srgbClr')).set('val', rgb_hex(bullet_color))
        etree.SubElement(pPr, qn('a:buFont')).set('typeface', 'Arial')
        etree.SubElement(pPr, qn('a:buChar')).set('char', '•')
    return tb


def shadow(shape, alpha=16):
    spPr = shape._element.spPr
    eff = etree.SubElement(spPr, qn('a:effectLst'))
    sh = etree.SubElement(eff, qn('a:outerShdw'), blurRad='88900', dist='19050', dir='5400000', algn='t', rotWithShape='0')
    clr = etree.SubElement(sh, qn('a:srgbClr'), val='0B2A6F')
    etree.SubElement(clr, qn('a:alpha'), val=str(alpha * 1000))


def box(slide, x, y, w, h, fill=WHITE, line=None, radius=0.08, shade=False, name=None, line_w=1):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                                 Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        shp.adjustments[0] = radius
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(line_w)
    if shade:
        shadow(shp)
    shp.text_frame.text = ''
    if name:
        shp.name = name
    return shp


def icon(slide, x, y, d, name, bg=GREEN, variant='w', pad=0.22):
    if bg is not None:
        c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(d), Inches(d))
        c.fill.solid()
        c.fill.fore_color.rgb = bg
        c.line.fill.background()
        c.name = f'icon bg {name}'
    p = d * pad
    pic = slide.shapes.add_picture(str(ICONS / f'{name}_{variant}.png'), Inches(x + p), Inches(y + p), Inches(d - 2 * p), Inches(d - 2 * p))
    pic.name = f'icon {name}'
    return pic


def arrow(slide, x1, y1, x2, y2, color=MUTE, width=1.5):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)
    ln = c.line._get_or_add_ln()
    etree.SubElement(ln, qn('a:tailEnd'), type='triangle', w='med', len='med')
    return c


def pill(slide, x, y, w, h, label, fill=GREEN_SOFT, color=GREEN, size=11, bold=True):
    b = box(slide, x, y, w, h, fill=fill, radius=0.5)
    tf = b.text_frame
    tf.margin_left = tf.margin_right = Inches(0.06)
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    set_run(r, size=size, bold=bold, color=color)
    return b


def crop(name, x0=0.0, y0=0.0, aspect=1.6, x1=1.0):
    CROPS.mkdir(parents=True, exist_ok=True)
    im = Image.open(SHOTS / f'{name}.png')
    W, H = im.size
    left, right = int(W * x0), int(W * x1)
    top = int(H * y0)
    bottom = min(H, top + int((right - left) / aspect))
    out = CROPS / f'{name}_{x0:.2f}_{y0:.2f}.png'
    im.crop((left, top, right, bottom)).save(out)
    return out, (right - left) / (bottom - top)


def browser(slide, img_path, aspect, x, y, w):
    """Screenshot inside a simple browser window frame; returns bottom y."""
    bar = 0.24
    h = w / aspect
    frame = box(slide, x, y, w, h + bar, fill=RGBColor(0xEE, 0xF1, 0xF6), line=LINE, radius=0.02, shade=True, name='browser frame')
    for i, c in enumerate((RGBColor(0xF2, 0x6B, 0x5B), RGBColor(0xF5, 0xBF, 0x4F), RGBColor(0x5A, 0xC2, 0x6B))):
        dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.12 + i * 0.16), Inches(y + 0.075), Inches(0.09), Inches(0.09))
        dot.fill.solid()
        dot.fill.fore_color.rgb = c
        dot.line.fill.background()
    pic = slide.shapes.add_picture(str(img_path), Inches(x), Inches(y + bar), Inches(w), Inches(h))
    pic.name = 'screenshot'
    return y + bar + h


def notes(slide, body):
    slide.notes_slide.notes_text_frame.text = body


def content_slide(kicker, title):
    state['n'] += 1
    s = prs.slides.add_slide(CONTENT)
    # Title placeholder moved next to the logos; body placeholder removed.
    for ph in list(s.placeholders):
        if ph.placeholder_format.type is not None and ph.placeholder_format.idx != 0:
            ph._element.getparent().remove(ph._element)
    t = s.shapes.title
    t.left, t.top, t.width, t.height = Inches(4.1), Inches(0.43), Inches(8.85), Inches(0.62)
    tf = t.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    r = p.add_run()
    r.text = title
    set_run(r, size=26, bold=True, color=NAVY, font=HEAD)
    text(s, 4.1, 0.16, 8.85, 0.27, kicker.upper(), size=11, bold=True, color=GREEN, font=HEAD, name='kicker')
    # page number sits on the template's blue band
    text(s, 0.45, 6.98, 3.0, 0.3, [[('AIMBRACE', {'bold': True}), (f'   {state["n"]}/{TOTAL}', {})]], size=11, color=WHITE, name='page number')
    return s


def title_slide():
    state['n'] += 1
    s = prs.slides.add_slide(TITLE_BG)
    for ph in list(s.placeholders):
        ph._element.getparent().remove(ph._element)
    return s


def source(slide, label, y=6.42):
    text(slide, 0.6, y, 12.1, 0.25, label, size=10, color=MUTE, name='sources')


# ================================================================ 1. Cover
state['n'] += 1
s = prs.slides.add_slide(COVER)
notes(s, 'Kính chào Ban giám khảo. Nhóm xin trình bày sản phẩm AIMBRACE tại bảng thi AI4Life.')

# ================================================================ 2. Title
s = title_slide()
s.shapes.add_picture(str(LOGO), Inches(3.67), Inches(1.45), Inches(6.0))
text(s, 1.4, 2.95, 10.53, 1.05,
     'Nền tảng AI đồng hành cùng phụ huynh: sàng lọc sớm nguy cơ tự kỷ qua dáng đi 3D và can thiệp ngay tại nhà',
     size=24, bold=True, color=NAVY, font=HEAD, align=PP_ALIGN.CENTER)
card = box(s, 2.67, 4.3, 8.0, 1.55, fill=WHITE, line=LINE, radius=0.1, shade=True)
text(s, 2.97, 4.45, 7.4, 1.3, [
    [('Nhóm thực hiện: ', {'bold': True, 'color': NAVY}), ('Phạm Viết Chí Luân · Nguyễn Văn Lâm · Nguyễn Văn Phụng', {})],
    [('Ngành Trí tuệ nhân tạo, lớp 23AI — Trường ĐH CNTT & Truyền thông Việt – Hàn', {'color': MUTE})],
    [('Giảng viên hướng dẫn: ', {'bold': True, 'color': NAVY}), ('TS. Lê Thị Thu Nga', {})],
    [('Sản phẩm đang chạy: ', {'bold': True, 'color': GREEN}), ('aimbrace.agriwatch.io.vn', {'bold': True, 'color': GREEN})],
], size=15, align=PP_ALIGN.CENTER, space_after=3)
notes(s, 'AIMBRACE là nền tảng web cho phụ huynh có con nghi ngờ hoặc có nguy cơ rối loạn phổ tự kỷ. '
         'Sản phẩm đang chạy thật tại aimbrace.agriwatch.io.vn; nhóm sẽ demo trực tiếp ở phần cuối.')

# ================================================================ 3. Problem
s = content_slide('Bối cảnh & vấn đề', 'Tự kỷ phổ biến nhưng thường phát hiện muộn')
stats = [
    ('1/100', 'trẻ em trên thế giới có rối loạn phổ tự kỷ', 'WHO, 2023'),
    ('1/31', 'trẻ 8 tuổi tại Mỹ được xác định tự kỷ (dữ liệu 2022)', 'CDC ADDM, 2025'),
    ('1/132', 'trẻ 18–30 tháng tại Việt Nam (khảo sát 40.243 trẻ, 7 tỉnh)', 'Khảo sát 2017–2018'),
]
for i, (big, label, src) in enumerate(stats):
    x = 0.6 + i * 4.1
    box(s, x, 1.3, 3.85, 1.9, fill=BLUE_SOFT, radius=0.08)
    text(s, x + 0.3, 1.42, 3.3, 0.85, big, size=44, bold=True, color=BLUE, font=HEAD)
    text(s, x + 0.3, 2.27, 3.3, 0.6, label, size=14, color=INK)
    text(s, x + 0.3, 2.86, 3.3, 0.25, src, size=10, color=MUTE)
pains = [
    ('Clock', 'Phát hiện muộn', 'Dấu hiệu có thể thấy từ nhỏ, nhưng chẩn đoán thường đến muộn hơn nhiều — bỏ lỡ giai đoạn can thiệp sớm.'),
    ('Hospital', 'Khó tiếp cận chuyên gia', 'Đánh giá chuyên sâu tập trung ở bệnh viện tuyến trên; gia đình ở xa phải chờ và đi lại nhiều.'),
    ('House', 'Phụ huynh thiếu công cụ', 'Sau sàng lọc, cha mẹ không biết tập gì với con và theo dõi tiến bộ thế nào tại nhà.'),
    ('Puzzle', 'Trẻ khó hợp tác', 'Bài tập lặp lại dễ nhàm chán; trẻ cần người làm mẫu và nhắc nhở liên tục.'),
]
for i, (ic, head, body) in enumerate(pains):
    x = 0.6 + (i % 2) * 6.15
    y = 3.5 + (i // 2) * 1.4
    icon(s, x, y + 0.05, 0.62, ic, bg=GREEN)
    text(s, x + 0.82, y, 5.1, 0.32, head, size=16, bold=True, color=NAVY)
    text(s, x + 0.82, y + 0.36, 5.1, 0.85, body, size=14, color=INK)
source(s, 'Nguồn: WHO, Autism fact sheet (2023); CDC, ADDM Network MMWR (4/2025); Thi và cs. (2021), khảo sát sàng lọc sớm tự kỷ tại 7 tỉnh Việt Nam.')
notes(s, 'Theo WHO khoảng 1/100 trẻ em có tự kỷ; tại Mỹ con số được xác định là 1/31 trẻ 8 tuổi. '
         'Ở Việt Nam, khảo sát trên 40 nghìn trẻ 18–30 tháng ở 7 tỉnh cho tỷ lệ khoảng 0,76%, tức 1/132. '
         'Vấn đề không chỉ là phát hiện, mà còn là sau khi phát hiện phụ huynh làm gì tại nhà. '
         '(Gợi ý: bổ sung kết quả khảo sát phụ huynh của nhóm vào slide này nếu có.)')

# ================================================================ 4. Solution
s = content_slide('Giải pháp', 'AIMBRACE: một nền tảng, ba trụ cột')
pillars = [
    ('Footprints', 'SÀNG LỌC', BLUE, ['Dáng đi 3D bằng cảm biến Kinect, AI phân tích khung xương',
                                      'Bảng hỏi chuẩn M-CHAT-R/F (16–30 tháng), chấm tự động',
                                      'Kết quả bằng lời dễ hiểu — tham khảo, không phải chẩn đoán']),
    ('PersonStanding', 'CAN THIỆP TẠI NHÀ', GREEN, ['Bài tập vận động bắt chước, AI chấm điểm từng bộ phận',
                                                   'Huấn luyện viên nhắc bằng giọng nói ngay khi trẻ tập',
                                                   '“Bạn Bin” trò chuyện, làm mẫu, hát cùng trẻ']),
    ('HeartHandshake', 'KẾT NỐI', AMBER, ['Chia sẻ hồ sơ với bác sĩ theo từng phần và có thời hạn',
                                          'Trợ lý AI trả lời dựa trên tài liệu y khoa chính thống',
                                          'Cộng đồng phụ huynh, nhắn tin riêng an toàn']),
]
for i, (ic, head, col, items) in enumerate(pillars):
    x = 0.6 + i * 4.1
    box(s, x, 1.3, 3.85, 3.7, fill=WHITE, line=LINE, radius=0.06, shade=True)
    icon(s, x + 0.3, 1.55, 0.8, ic, bg=col)
    text(s, x + 1.25, 1.7, 2.5, 0.5, head, size=18, bold=True, color=col, font=HEAD, anchor=MSO_ANCHOR.MIDDLE)
    bullets(s, x + 0.3, 2.6, 3.3, 2.75, items, size=15, space_after=10, bullet_color=col)
text(s, 0.6, 5.42, 2.2, 0.4, 'Dành cho:', size=15, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
for i, (ic, lab) in enumerate([('UserRound', 'Phụ huynh'), ('Baby', 'Trẻ'), ('Stethoscope', 'Bác sĩ'), ('ShieldCheck', 'Quản trị')]):
    x = 1.85 + i * 2.75
    icon(s, x, 5.4, 0.44, ic, bg=NAVY, pad=0.2)
    text(s, x + 0.55, 5.4, 2.0, 0.44, lab, size=15, color=INK, anchor=MSO_ANCHOR.MIDDLE)
notes(s, 'AIMBRACE khép kín vòng: sàng lọc, can thiệp tại nhà, và kết nối với chuyên gia. '
         'Bốn nhóm người dùng: phụ huynh, trẻ (qua Bạn Bin), bác sĩ được phụ huynh chia sẻ hồ sơ, và quản trị viên.')

# ================================================================ 5. Features
s = content_slide('Tính đúng & đầy đủ của tính năng', '8 tính năng chính đang chạy trên hệ thống thật')
feats = [
    ('Footprints', 'Sàng lọc dáng đi Kinect 3D', 'Hội đồng 3 mô hình × 5 seed bỏ phiếu', 'Đang chạy'),
    ('ClipboardList', 'Bảng hỏi M-CHAT-R/F', '20 câu, chấm tự động, phân nhóm nguy cơ', 'Đang chạy'),
    ('PersonStanding', 'Bài tập bắt chước', 'So khớp chuyển động với mẫu, điểm từng bộ phận', 'Đang chạy'),
    ('Activity', 'Huấn luyện viên trực tiếp', 'Nhận diện tư thế trên trình duyệt, nhắc bằng giọng', 'Đang chạy'),
    ('Bot', 'Bạn Bin', 'Nghe – nói tiếng Việt, biểu cảm, tranh minh họa, hát', 'Đang chạy'),
    ('MessageCircleQuestion', 'Trợ lý AI', 'RAG trên 73 tài liệu (CDC, NIMH, WHO, nghiên cứu)', 'Đang chạy'),
    ('Stethoscope', 'Chia sẻ với bác sĩ', 'Chọn phần chia sẻ, hết hạn 30/90/180 ngày', 'Đang chạy'),
    ('Users', 'Cộng đồng phụ huynh', 'Bài viết ẩn danh, nhắn riêng, kiểm duyệt', 'Đang chạy'),
]
for i, (ic, head, body, status) in enumerate(feats):
    x = 0.6 + (i % 4) * 3.07
    y = 1.3 + (i // 4) * 2.4
    box(s, x, y, 2.87, 2.2, fill=WHITE, line=LINE, radius=0.06, shade=True)
    icon(s, x + 0.25, y + 0.25, 0.62, ic, bg=GREEN if i % 4 != 0 or i == 0 else GREEN)
    pill(s, x + 1.47, y + 0.38, 1.2, 0.34, status, size=11)
    text(s, x + 0.25, y + 1.0, 2.45, 0.38, head, size=15, bold=True, color=NAVY)
    text(s, x + 0.25, y + 1.38, 2.45, 0.75, body, size=13, color=INK)
box(s, 0.6, 6.12, 12.15, 0.4, fill=YELLOW_SOFT, radius=0.2)
text(s, 0.8, 6.12, 11.8, 0.4, [[('Đã tạm ngưng: ', {'bold': True, 'color': AMBER}),
                                ('sàng lọc qua video điện thoại (OpenPose) — dữ liệu video lệch miền so với dữ liệu huấn luyện; chỉ quản trị viên dùng để nghiên cứu.', {})]],
     size=13, anchor=MSO_ANCHOR.MIDDLE)
notes(s, 'Tất cả 8 tính năng đều đã triển khai và chạy trên máy chủ của nhóm. '
         'Nhóm chủ động tạm ngưng sàng lọc bằng video điện thoại vì phát hiện mô hình học lối tắt từ cách quay video, '
         'và chuyển sang sàng lọc bằng khung xương 3D Kinect.')

# ================================================================ 6. User journeys
s = content_slide('Luồng sử dụng', 'Hành trình của từng nhóm người dùng')
lanes = [
    ('UserRound', 'Phụ huynh', BLUE, ['Tạo hồ sơ trẻ', 'Đồng ý từng mục đích', 'Sàng lọc Kinect + M-CHAT', 'Đọc kết quả, gợi ý', 'Tập cùng con mỗi ngày', 'Chia sẻ bác sĩ']),
    ('Baby', 'Trẻ (cùng Bin)', GREEN, ['Chào Bạn Bin', 'Xem Bin làm mẫu', 'Tập theo, nghe nhắc', 'Nhận sao, nghe nhạc']),
    ('Stethoscope', 'Bác sĩ', AMBER, ['Nhận lời mời, được xác minh', 'Xem hồ sơ được chia sẻ (chỉ đọc)', 'Theo dõi tiến độ, gửi lời khuyên ngoài app']),
]
for li, (ic, lab, col, steps) in enumerate(lanes):
    y = 1.35 + li * 1.68
    icon(s, 0.6, y + 0.22, 0.75, ic, bg=col)
    text(s, 0.6, y + 1.0, 1.6, 0.35, lab, size=13, bold=True, color=col)
    n = len(steps)
    x0, x1 = 2.25, 12.75
    w = (x1 - x0 + 0.12 * (n - 1)) / n
    for i, st in enumerate(steps):
        x = x0 + i * (w - 0.12)
        shp = s.shapes.add_shape(MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON, Inches(x), Inches(y + 0.15), Inches(w), Inches(0.95))
        shp.fill.solid()
        shp.fill.fore_color.rgb = col if i == n - 1 else (BLUE_SOFT if col == BLUE else GREEN_SOFT if col == GREEN else YELLOW_SOFT)
        shp.line.fill.background()
        shp.adjustments[0] = 0.28
        tf = shp.text_frame
        tf.margin_left = Inches(0.3 if i else 0.12)
        tf.margin_right = Inches(0.22)
        tf.margin_top = tf.margin_bottom = 0
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = st
        set_run(r, size=13, bold=True, color=WHITE if i == n - 1 else NAVY)
notes(s, 'Phụ huynh đi từ tạo hồ sơ, đồng ý cho từng mục đích sử dụng dữ liệu, sàng lọc, đến tập luyện hằng ngày và chia sẻ với bác sĩ. '
         'Trẻ chỉ tương tác với Bạn Bin; bác sĩ chỉ xem được phần phụ huynh cho phép.')

# ================================================================ 7. UI — screening
s = content_slide('Giao diện sản phẩm', 'Sàng lọc: từ trạm Kinect đến kết quả dễ hiểu')
steps = ['Kết nối trạm Kinect', 'Phụ huynh đồng ý', 'Ghi dáng đi (khung xương trực tiếp)', 'Tự phân tích, trả kết quả']
xs = 0.6
for i, st in enumerate(steps):
    w = [2.45, 2.25, 3.7, 3.15][i]
    c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(xs), Inches(1.3), Inches(0.4), Inches(0.4))
    c.fill.solid(); c.fill.fore_color.rgb = BLUE; c.line.fill.background()
    tf = c.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; r = p.add_run(); r.text = str(i + 1); set_run(r, size=13, bold=True, color=WHITE)
    text(s, xs + 0.5, 1.3, w - 0.6, 0.4, st, size=14, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
    xs += w
img1, a1 = crop('02_kinect_result', x0=0.185, y0=0.0, aspect=1.6, x1=1.0)
img2, a2 = crop('06_mchat_result', x0=0.25, y0=0.0, aspect=1.6, x1=0.985)
b1 = browser(s, img1, a1, 0.6, 1.95, 5.95)
b2 = browser(s, img2, a2, 6.8, 1.95, 5.95)
text(s, 0.6, b1 + 0.15, 5.95, 0.6, [[('Kết quả Kinect: ', {'bold': True, 'color': NAVY}), ('nói rõ “chưa thấy khác biệt” hoặc “nên theo dõi thêm”, kèm bước tiếp theo.', {})]], size=13)
text(s, 6.8, b2 + 0.15, 5.95, 0.6, [[('M-CHAT-R/F: ', {'bold': True, 'color': NAVY}), ('chấm điểm tự động, phân nhóm nguy cơ, tóm tắt sẵn cho bác sĩ.', {})]], size=13)
notes(s, 'Luồng Kinect gồm 4 bước. Khi phụ huynh bấm Dừng, hệ thống tự gửi toàn bộ bản ghi đi phân tích; '
         'phụ huynh không phải chỉnh gì. Kết quả được viết bằng lời, không đưa xác suất gây hiểu lầm. '
         '(Ảnh chụp từ môi trường thử nghiệm với dữ liệu mẫu.)')

# ================================================================ 8. UI — child
s = content_slide('Giao diện sản phẩm', 'Trẻ tập luyện cùng “Bạn Bin”')
img1, a1 = crop('07_buddy', x0=0.0, y0=0.0, aspect=1.6)
img2, a2 = crop('05_exercise_result', x0=0.185, y0=0.0, aspect=1.6)
b1 = browser(s, img1, a1, 0.6, 1.35, 5.95)
b2 = browser(s, img2, a2, 6.8, 1.35, 5.95)
text(s, 0.6, b1 + 0.2, 5.95, 1.1, [
    [('Bạn Bin: ', {'bold': True, 'color': NAVY}), ('nghe và nói tiếng Việt, đổi nét mặt theo câu chuyện, giơ tranh minh họa (nhà, mèo, hoa…), mở bài “Một con vịt”, chào bố mẹ khi nhận ra.', {})]], size=13)
text(s, 6.8, b2 + 0.2, 5.95, 1.1, [
    [('Kết quả bài tập: ', {'bold': True, 'color': NAVY}), ('điểm 0–100 và sao, chấm riêng tay trái, tay phải, chân, thân người; gợi ý cho lần tập sau.', {})]], size=13)
notes(s, 'Bạn Bin là nhân vật đồng hành giúp trẻ chịu tập. Bin làm mẫu động tác, nhắc khi trẻ tập, và khen khi trẻ làm tốt. '
         'Sau mỗi lượt, hệ thống chấm điểm từng bộ phận cơ thể so với mẫu.')

# ================================================================ 9. UI — parent hub & doctor
s = content_slide('Giao diện sản phẩm', 'Hồ sơ trẻ cá nhân hóa và cổng bác sĩ')
img1, a1 = crop('09_child', x0=0.185, y0=0.0, aspect=1.6)
img2, a2 = crop('12_doctor_patient', x0=0.185, y0=0.0, aspect=1.6)
b1 = browser(s, img1, a1, 0.6, 1.35, 5.95)
b2 = browser(s, img2, a2, 6.8, 1.35, 5.95)
text(s, 0.6, b1 + 0.2, 5.95, 1.1, [
    [('Hồ sơ trẻ: ', {'bold': True, 'color': NAVY}), ('sở thích, điều trẻ khó chịu, mục tiêu tuần; Bin và gợi ý bài tập dựa vào đây để phù hợp với từng trẻ.', {})]], size=13)
text(s, 6.8, b2 + 0.2, 5.95, 1.1, [
    [('Cổng bác sĩ: ', {'bold': True, 'color': NAVY}), ('chỉ đọc phần phụ huynh cho phép, hết hạn tự động; không bao giờ nhận video của trẻ.', {})]], size=13)
notes(s, 'Phụ huynh mô tả trẻ một lần, mọi tính năng dùng chung thông tin này. '
         'Bác sĩ chỉ thấy phần được chia sẻ; phụ huynh xem được lần cuối bác sĩ mở hồ sơ và ngừng chia sẻ bất cứ lúc nào.')

# ================================================================ 10. Architecture
s = content_slide('Giải pháp kỹ thuật', 'Kiến trúc hệ thống')
box(s, 0.6, 1.3, 3.35, 5.15, fill=BLUE_SOFT, radius=0.04)
text(s, 0.8, 1.42, 3.0, 0.3, 'PHÍA NGƯỜI DÙNG', size=12, bold=True, color=BLUE, font=HEAD)
cards_a = [
    ('Monitor', 'Ứng dụng web', 'React + TypeScript; phụ huynh, trẻ, bác sĩ, quản trị', 1.85),
    ('ScanFace', 'AI ngay trên trình duyệt', 'MediaPipe Pose (nhắc tập), MediaPipe Face + SFace (nhận ra bố mẹ)', 3.27),
    ('Laptop', 'Trạm Kinect', 'Laptop + cảm biến Kinect v2; chỉ gửi khung xương 3D', 4.85),
]
for ic, head, body, y in cards_a:
    box(s, 0.8, y, 2.95, 1.3, fill=WHITE, line=LINE, radius=0.06)
    icon(s, 0.95, y + 0.15, 0.48, ic, bg=BLUE, pad=0.2)
    text(s, 1.55, y + 0.15, 2.1, 0.48, head, size=13, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.95, y + 0.7, 2.7, 0.55, body, size=11, color=INK)
# middle column
pill(s, 4.55, 1.45, 3.4, 0.45, 'Cloudflare Tunnel · HTTPS', fill=YELLOW_SOFT, color=AMBER, size=12)
box(s, 4.55, 2.2, 3.4, 2.2, fill=WHITE, line=NAVY, radius=0.06, shade=True, line_w=1.5)
icon(s, 4.75, 2.38, 0.55, 'Server', bg=NAVY)
text(s, 5.42, 2.38, 2.4, 0.55, 'Backend API', size=15, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
bullets(s, 4.75, 3.05, 3.1, 1.3, ['Node.js, Express, Prisma', 'Hàng đợi job phân tích', 'Kiểm tra đồng ý trước mỗi lượt AI'], size=12, space_after=2)
box(s, 4.55, 4.85, 3.4, 1.3, fill=WHITE, line=LINE, radius=0.06)
icon(s, 4.75, 5.0, 0.5, 'Database', bg=NAVY, pad=0.2)
text(s, 5.38, 5.0, 2.5, 0.5, 'PostgreSQL 16', size=14, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
text(s, 4.75, 5.58, 3.1, 0.5, 'Hồ sơ, kết quả, đồng ý; pgvector cho trợ lý', size=11, color=INK)
# right column
box(s, 8.55, 1.3, 4.2, 3.55, fill=GREEN_SOFT, radius=0.04)
text(s, 8.75, 1.42, 3.9, 0.3, 'MÁY CHỦ GPU · RTX 5060 Ti · DOCKER', size=12, bold=True, color=GREEN, font=HEAD)
svc = [('Footprints', 'Hội đồng Kinect 3D', 'CPU · 357 ms/lượt'), ('Layers', 'OpenPose + ST-GCN', 'GPU · khung xương 2D'),
       ('Volume2', 'Giọng Bin', 'VieNeu-TTS'), ('BookOpen', 'Trợ lý RAG', 'LangGraph + pgvector')]
for i, (ic, head, body) in enumerate(svc):
    x = 8.75 + (i % 2) * 1.95
    y = 1.85 + (i // 2) * 1.45
    box(s, x, y, 1.85, 1.3, fill=WHITE, line=LINE, radius=0.06)
    icon(s, x + 0.12, y + 0.12, 0.42, ic, bg=GREEN, pad=0.2)
    text(s, x + 0.12, y + 0.6, 1.65, 0.35, head, size=12, bold=True, color=NAVY)
    text(s, x + 0.12, y + 0.93, 1.65, 0.3, body, size=10, color=MUTE)
box(s, 8.55, 5.05, 4.2, 1.4, fill=WHITE, line=LINE, radius=0.06)
icon(s, 8.75, 5.2, 0.5, 'Cloud', bg=AMBER, pad=0.2)
text(s, 9.38, 5.2, 3.3, 0.5, 'Dịch vụ AI bên ngoài', size=14, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
text(s, 8.75, 5.78, 3.9, 0.6, 'Groq gpt-oss-120b (lời Bin) · Deepgram nova-3 (nghe giọng bé) · NVIDIA Nemotron (trợ lý)', size=11, color=INK)
# arrows
arrow(s, 3.75, 2.5, 4.55, 2.9)
arrow(s, 3.75, 5.5, 4.55, 3.9)
arrow(s, 6.25, 1.9, 6.25, 2.2)
arrow(s, 6.25, 4.4, 6.25, 4.85)
arrow(s, 7.95, 3.0, 8.55, 3.0)
arrow(s, 7.95, 3.9, 8.55, 5.6)
notes(s, 'Toàn bộ hệ thống tự vận hành trên một máy chủ GPU của nhóm bằng Docker, công khai qua Cloudflare Tunnel. '
         'Phần nhạy cảm như nhận diện khuôn mặt bố mẹ và nhắc tập chạy ngay trên trình duyệt, không gửi ảnh lên máy chủ. '
         'Trạm Kinect chỉ gửi tọa độ khung xương.')

# ================================================================ 11. AI 1 — Kinect gait
s = content_slide('Tính phù hợp của công nghệ', 'AI #1 — Sàng lọc dáng đi từ khung xương 3D')
pipe = [
    ('Laptop', 'Thu khung xương', 'Kinect v2: 25 khớp 3D, 30 khung/giây; không có video màu'),
    ('Waves', 'Làm sạch', 'Khớp bị mất → nội suy theo thời gian; bỏ khung rỗng hai đầu'),
    ('Layers', 'Chuẩn hóa', 'Z-score hoặc hộp bao + vận tốc; lấy mẫu lại 128 khung'),
    ('Network', 'Hội đồng 3 mô hình', 'SRM, ST-GCN, ST-GCN hộp bao + vận tốc; mỗi mô hình 5 seed'),
    ('Vote', 'Bỏ phiếu', '≥ 3/5 seed và ≥ 2/3 mô hình; trả kết quả bằng lời'),
]
for i, (ic, head, body) in enumerate(pipe):
    x = 0.6 + i * 2.48
    box(s, x, 1.3, 2.22, 2.45, fill=WHITE, line=LINE, radius=0.06, shade=True)
    icon(s, x + 0.2, 1.48, 0.6, ic, bg=BLUE if i < 3 else GREEN)
    text(s, x + 0.2, 2.18, 1.9, 0.35, head, size=14, bold=True, color=NAVY)
    text(s, x + 0.2, 2.55, 1.9, 1.15, body, size=12, color=INK)
    if i < 4:
        arrow(s, x + 2.24, 2.52, x + 2.46, 2.52, color=NAVY, width=2)
box(s, 0.6, 4.0, 7.0, 2.45, fill=BLUE_SOFT, radius=0.05)
icon(s, 0.85, 4.18, 0.55, 'Brain', bg=NAVY, pad=0.2)
text(s, 1.55, 4.18, 5.8, 0.55, 'Vì sao dùng AI ở đây?', size=16, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
bullets(s, 0.85, 4.85, 6.6, 1.6, [
    'Khác biệt dáng đi (nhịp bước, dao động thân, phối hợp tay chân) rất tinh vi, mắt thường khó định lượng.',
    'ST-GCN coi khung xương là đồ thị, học quan hệ không gian – thời gian giữa các khớp.',
    'Chỉ dùng tọa độ khớp: bảo vệ hình ảnh trẻ, nhẹ để gửi và lưu.',
], size=13, space_after=4)
s.shapes.add_picture(str(ASSETS / 'skeleton_walk.png'), Inches(8.55), Inches(3.95), Inches(2.25), Inches(2.25))
s.shapes.add_picture(str(ASSETS / 'skeleton_front.png'), Inches(11.25), Inches(4.0), Inches(0.92), Inches(2.15))
text(s, 7.9, 6.2, 4.85, 0.3, 'Một chu kỳ bước (nhìn ngang và nhìn thẳng) — dữ liệu công khai Dryad', size=10, color=MUTE, align=PP_ALIGN.CENTER)
notes(s, 'Trạm Kinect ghi 25 khớp 3D. Dữ liệu được làm sạch, chuẩn hóa và đưa vào hội đồng 3 mô hình, mỗi mô hình 5 lần huấn luyện với seed khác nhau. '
         'Kết quả là đa số phiếu, không cộng điểm thành xác suất, để tránh hiểu nhầm là xác suất chẩn đoán. '
         'Model bundle được khóa bằng mã băm SHA-256; backend từ chối kết quả nếu mô hình bị thay đổi.')

# ================================================================ 12. Evaluation
s = content_slide('Hiệu quả & chất lượng', 'Đánh giá mô hình: trung thực với dữ liệu nhỏ')
stats = [
    ('0,92', 'AUC ± 0,01', 'Kiểm định chéo theo trẻ (80 trẻ, 5 fold × 3 seed), mô hình ST-GCN nghiên cứu nền'),
    ('11/12', 'đúng trên tập kiểm thử', 'Hội đồng 3 mô hình đang triển khai: 5/5 trẻ điển hình, 6/7 trẻ tự kỷ (Dryad)'),
    ('357 ms', 'thời gian suy luận', 'Trung vị trên CPU, p95 367 ms; chạy với 2 lõi CPU, < 1 GB RAM'),
]
for i, (big, unit, desc) in enumerate(stats):
    y = 1.3 + i * 1.62
    box(s, 0.6, y, 5.75, 1.45, fill=WHITE, line=LINE, radius=0.06, shade=True)
    text(s, 0.85, y + 0.12, 2.3, 0.75, big, size=34, bold=True, color=GREEN, font=HEAD, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.85, y + 0.88, 2.3, 0.4, unit, size=12, bold=True, color=NAVY)
    text(s, 3.2, y + 0.18, 2.95, 1.15, desc, size=13, color=INK, anchor=MSO_ANCHOR.MIDDLE)
cd = CategoryChartData()
cd.categories = ['Toàn bộ dữ liệu', 'Trong cùng nhóm chiều cao']
cd.add_series('Chỉ dùng chiều cao', (0.822, 0.505))
cd.add_series('Mô hình ST-GCN', (0.921, 0.87))
gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(6.65), Inches(1.3), Inches(6.1), Inches(3.75), cd)
ch = gf.chart
ch.has_title = True
ch.chart_title.text_frame.text = 'AUC: mô hình không chỉ học chiều cao'
tp = ch.chart_title.text_frame.paragraphs[0]
for r in tp.runs:
    set_run(r, size=14, bold=True, color=NAVY)
ch.has_legend = True
ch.legend.position = XL_LEGEND_POSITION.BOTTOM
ch.legend.include_in_layout = False
ch.legend.font.size = Pt(12)
ch.legend.font.color.rgb = INK
plot = ch.plots[0]
plot.gap_width = 70
plot.overlap = -10
plot.has_data_labels = True
dl = plot.data_labels
dl.number_format = '0.00'
dl.number_format_is_linked = False
dl.position = XL_LABEL_POSITION.OUTSIDE_END
dl.font.size = Pt(12)
dl.font.bold = True
dl.font.color.rgb = INK
for ser, colr in zip(plot.series, (RGBColor(0xB8, 0xC2, 0xD3), GREEN)):
    ser.format.fill.solid()
    ser.format.fill.fore_color.rgb = colr
va = ch.value_axis
va.maximum_scale = 1.0
va.minimum_scale = 0.0
va.has_major_gridlines = True
va.major_gridlines.format.line.color.rgb = RGBColor(0xE5, 0xE9, 0xF0)
va.tick_labels.font.size = Pt(11)
va.tick_labels.font.color.rgb = MUTE
va.format.line.fill.background()
ca = ch.category_axis
ca.tick_labels.font.size = Pt(12)
ca.tick_labels.font.color.rgb = INK
ca.format.line.color.rgb = LINE
box(s, 6.65, 5.3, 6.1, 1.0, fill=YELLOW_SOFT, radius=0.06)
icon(s, 6.82, 5.58, 0.42, 'TriangleAlert', bg=AMBER, pad=0.2)
text(s, 7.38, 5.38, 5.25, 0.88, [
    [('Giới hạn: ', {'bold': True, 'color': AMBER}),
     ('dữ liệu công khai Dryad (Al-Jubouri và cs., 2020) chỉ ~88 trẻ sau khi loại bản trùng, lệch tuổi và giới; tập kiểm thử 12 trẻ. '
      'Chưa đánh giá trên trẻ Việt Nam mới → kết quả là tham khảo, không phải chẩn đoán.', {})]], size=12)
notes(s, 'Nhóm tự kiểm toán dữ liệu: phát hiện bản trùng giữa các thư mục và lệch chiều cao giữa hai nhóm. '
         'Sau khi chia lại sạch theo trẻ, AUC còn 0,92. Khi so trong cùng nhóm chiều cao, chiều cao không còn phân biệt được (AUC 0,505) '
         'nhưng mô hình vẫn đạt khoảng 0,87 — mô hình học được nhiều hơn chiều cao. '
         'Hội đồng triển khai đúng 11/12 trẻ trên tập kiểm thử và 12/13 bản ghi thử nội bộ của nhóm được nhận định là điển hình.')

# ================================================================ 13. AI 2 — exercises
s = content_slide('Tính phù hợp của công nghệ', 'AI #2 — Chấm điểm bài tập và nhắc tập trực tiếp')
panels = [
    ('Server', 'Chấm điểm sau buổi tập', 'Trên máy chủ', BLUE, [
        ('Video lượt tập', 'xóa ngay sau khi chấm'),
        ('OpenPose', 'khung xương 2D, lấy mẫu 15 Hz'),
        ('Subsequence DTW', 'so góc khớp với mẫu người lớn, có chế độ soi gương'),
        ('Điểm 0–100', 'từng bộ phận + 10 tiêu chí lỗi động tác, sao ở mức 60 và 80'),
    ]),
    ('Activity', 'Nhắc tập trực tiếp', 'Ngay trên trình duyệt', GREEN, [
        ('Camera', 'hình ảnh không rời khỏi máy'),
        ('MediaPipe Pose Lite', 'chạy trong Web Worker, không làm giật giao diện'),
        ('Luật nhận diện lỗi', 'luân phiên, bắt chéo, mở rộng, cao hơn, vào khung, cử động'),
        ('Giọng nói nhắc', 'cách nhau ≥ 6,5 giây, xen lời khen để trẻ không nản'),
    ]),
]
for i, (ic, head, sub, col, steps_) in enumerate(panels):
    x = 0.6 + i * 6.15
    box(s, x, 1.3, 5.95, 5.15, fill=WHITE, line=LINE, radius=0.04, shade=True)
    icon(s, x + 0.3, 1.5, 0.7, ic, bg=col)
    text(s, x + 1.2, 1.5, 4.5, 0.4, head, size=17, bold=True, color=NAVY)
    text(s, x + 1.2, 1.9, 4.5, 0.3, sub, size=12, color=col, bold=True)
    for j, (t1, t2) in enumerate(steps_):
        y = 2.5 + j * 0.98
        n = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.4), Inches(y + 0.05), Inches(0.42), Inches(0.42))
        n.fill.solid(); n.fill.fore_color.rgb = col; n.line.fill.background()
        tf = n.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; r = p.add_run(); r.text = str(j + 1); set_run(r, size=12, bold=True, color=WHITE)
        if j < 3:
            ln = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x + 0.61), Inches(y + 0.5), Inches(x + 0.61), Inches(y + 1.0))
            ln.line.color.rgb = LINE; ln.line.width = Pt(2)
        text(s, x + 1.05, y, 4.6, 0.32, t1, size=14, bold=True, color=NAVY)
        text(s, x + 1.05, y + 0.32, 4.6, 0.55, t2, size=13, color=INK)
notes(s, 'Bài tập được chấm theo luật minh bạch, không cần huấn luyện mô hình riêng: so góc khớp của trẻ với mẫu do người lớn quay, '
         'bằng DTW để chịu được việc trẻ làm nhanh hay chậm. Nhắc tập chạy ngay trên trình duyệt để phản hồi tức thì và giữ hình ảnh trên máy.')

# ================================================================ 14. AI 3 — Bin & assistant
s = content_slide('Tính phù hợp của công nghệ', 'AI #3 — Bạn Bin và Trợ lý AI')
pipe = [
    ('Mic', 'Nghe', 'Deepgram nova-3, tiếng Việt'),
    ('Brain', 'Nghĩ', 'Groq gpt-oss-120b → kịch bản JSON: lời, cảm xúc, động tác, tranh, bài hát'),
    ('Volume2', 'Nói', 'VieNeu-TTS, giọng “Quỳnh Anh” tươi, chậm vừa'),
    ('Smile', 'Thể hiện', 'Bin đổi nét mặt, cử động, giơ tranh minh họa'),
]
for i, (ic, head, body) in enumerate(pipe):
    x = 0.6 + i * 3.1
    box(s, x, 1.3, 2.8, 1.75, fill=WHITE, line=LINE, radius=0.06, shade=True)
    icon(s, x + 0.2, 1.45, 0.55, ic, bg=GREEN, pad=0.2)
    text(s, x + 0.9, 1.45, 1.8, 0.55, head, size=16, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x + 0.2, 2.1, 2.45, 0.9, body, size=12, color=INK)
    if i < 3:
        arrow(s, x + 2.82, 2.17, x + 3.08, 2.17, color=NAVY, width=2)
text(s, 0.6, 3.17, 12.1, 0.35, [[('Camera trên trình duyệt: ', {'bold': True, 'color': GREEN}),
                                 ('MediaPipe Face + SFace nhận ra bố mẹ đã đăng ký để chào; nhận biết bé cười hay nhíu mày. Tên trẻ không gửi cho mô hình ngôn ngữ.', {})]], size=13)
mini = [('3,0%', 'lỗi nhận dạng từ (WER), giọng chuẩn'), ('3,7%', 'WER với giọng giả lập trẻ em'), ('≈ 0,3 s', 'giọng Bin bắt đầu phát sau khi có lời thoại')]
for i, (big, lab) in enumerate(mini):
    y = 3.75 + i * 0.9
    text(s, 0.6, y, 1.75, 0.75, big, size=28, bold=True, color=GREEN, font=HEAD, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 2.4, y, 3.5, 0.75, lab, size=13, color=INK, anchor=MSO_ANCHOR.MIDDLE)
text(s, 0.6, 6.45 - 0.1, 5.5, 0.25, 'Đo trên 75 đoạn tiếng nói tổng hợp; chưa đo với giọng trẻ thật.', size=10, color=MUTE)
box(s, 6.45, 3.75, 6.3, 2.7, fill=BLUE_SOFT, radius=0.05)
icon(s, 6.7, 3.95, 0.6, 'MessageCircleQuestion', bg=BLUE)
text(s, 7.45, 3.95, 5.1, 0.6, 'Trợ lý AI cho phụ huynh (RAG)', size=16, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
bullets(s, 6.7, 4.7, 5.85, 1.75, [
    '73 tài liệu tiếng Anh: 45 nghiên cứu, 22 trang thông tin chính thống (CDC, NIMH, WHO) — 4.142 đoạn.',
    'Tác tử LangGraph tự tìm kiếm (tối đa 2 lần/lượt), trả lời kèm trích dẫn; vector lưu bằng pgvector.',
    'Đạt 12/12 kịch bản kiểm thử nội bộ; luôn ghi “không thay thế chẩn đoán”.',
], size=13, space_after=4, bullet_color=BLUE)
notes(s, 'Bin dùng chuỗi nghe – nghĩ – nói. Mô hình ngôn ngữ không trả lời tự do mà trả về kịch bản có cấu trúc để Bin diễn đạt an toàn. '
         'Độ trễ thấp nhờ Groq (trung vị 678 ms) và phát tiếng từng câu. '
         'Trợ lý AI chỉ trả lời dựa trên kho tài liệu đã chọn lọc giấy phép.')

# ================================================================ 15. Privacy & cost
s = content_slide('An toàn dữ liệu & chi phí', 'Bảo vệ dữ liệu trẻ ngay từ thiết kế')
priv = [
    ('FileCheck', 'Đồng ý riêng cho từng mục đích', 'Có phiên bản, lưu nguyên văn, rút lại được; hệ thống kiểm tra lại trước mỗi lượt phân tích'),
    ('EyeOff', 'Không cần hình ảnh của trẻ', 'Kinect chỉ gửi tọa độ khung xương; video bài tập xóa ngay sau khi chấm'),
    ('Lock', 'Định danh ẩn danh', 'Máy chủ AI chỉ nhận mã ngẫu nhiên; tên trẻ không gửi cho mô hình ngôn ngữ'),
    ('Stethoscope', 'Chia sẻ có kiểm soát', 'Phụ huynh chọn phần, hết hạn mặc định 90 ngày, xem lịch sử truy cập, ngừng tức thì'),
    ('KeyRound', 'Khóa riêng cho từng dịch vụ', 'Nhật ký không ghi nội dung trò chuyện; bản mô hình được khóa bằng SHA-256'),
]
for i, (ic, head, body) in enumerate(priv):
    y = 1.3 + i * 1.03
    icon(s, 0.6, y + 0.08, 0.6, ic, bg=GREEN)
    text(s, 1.4, y, 6.3, 0.34, head, size=15, bold=True, color=NAVY)
    text(s, 1.4, y + 0.36, 6.3, 0.6, body, size=13, color=INK)
box(s, 8.15, 1.3, 4.6, 5.15, fill=BLUE_SOFT, radius=0.04)
icon(s, 8.4, 1.5, 0.55, 'Wallet', bg=BLUE, pad=0.2)
text(s, 9.1, 1.5, 3.5, 0.55, 'Chi phí vận hành thấp', size=16, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
costs = [('1 máy chủ', 'GPU RTX 5060 Ti tự vận hành, đóng gói Docker'), ('< 1 GB', 'RAM cho mô hình Kinect, chạy CPU'),
         ('0,0043 USD', 'mỗi phút nghe giọng (Deepgram)'), ('Gói miễn phí', 'Groq cho lời thoại của Bin')]
for i, (big, lab) in enumerate(costs):
    y = 2.3 + i * 1.03
    box(s, 8.4, y, 4.1, 0.88, fill=WHITE, radius=0.08)
    text(s, 8.6, y, 1.85, 0.88, big, size=17, bold=True, color=GREEN, font=HEAD, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 10.45, y, 1.95, 0.88, lab, size=12, color=INK, anchor=MSO_ANCHOR.MIDDLE)
notes(s, 'Dữ liệu trẻ em là dữ liệu nhạy cảm nên nhóm thiết kế riêng tư từ đầu: đồng ý theo mục đích, không lưu hình ảnh, ẩn danh khi gửi cho AI, '
         'và phụ huynh luôn kiểm soát việc chia sẻ. Chi phí chủ yếu là một máy chủ GPU sẵn có và vài dịch vụ API trả theo phút.')

# ================================================================ 16. Comparison
s = content_slide('Tính độc đáo', 'So sánh với cách làm hiện có')
rows = [
    ['Tiêu chí', 'Sàng lọc truyền thống', 'Ứng dụng qua video (vd. Cognoa Canvas Dx, Mỹ)', 'AIMBRACE'],
    ['Dữ liệu vận động', 'Chuyên gia quan sát trực tiếp', 'Video quay tại nhà, chuyên viên xem', 'Khung xương 3D, AI phân tích tự động'],
    ['Riêng tư', 'Khám tại cơ sở y tế', 'Gửi video có hình ảnh trẻ', 'Chỉ gửi tọa độ khung xương'],
    ['Sau sàng lọc', 'Hẹn tái khám, phụ huynh tự tìm cách', 'Tập trung hỗ trợ chẩn đoán', 'Bài tập chấm điểm + Bạn Bin + bác sĩ'],
    ['Ngôn ngữ, phạm vi', 'Tiếng Việt, tập trung ở bệnh viện lớn', 'Tiếng Anh, thị trường Mỹ', 'Tiếng Việt, dùng trên web'],
    ['Pháp lý', 'Công cụ chuẩn của chuyên gia', 'Thiết bị y tế được FDA cấp phép (2021)', 'Công cụ tham khảo, chưa là thiết bị y tế'],
]
tbl = s.shapes.add_table(len(rows), 4, Inches(0.6), Inches(1.3), Inches(12.15), Inches(4.4)).table
widths = [2.2, 3.05, 3.4, 3.5]
for j, w in enumerate(widths):
    tbl.columns[j].width = Inches(w)
for i, row in enumerate(rows):
    tbl.rows[i].height = Inches(0.62 if i == 0 else 0.75)
    for j, val in enumerate(row):
        cell = tbl.cell(i, j)
        cell.margin_left = cell.margin_right = Inches(0.12)
        cell.margin_top = cell.margin_bottom = Inches(0.05)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf = cell.text_frame
        tf.word_wrap = True
        tf.text = ''
        p = tf.paragraphs[0]
        r = p.add_run()
        r.text = val
        head = i == 0
        ours = j == 3
        set_run(r, size=13 if not head else 14, bold=head or j == 0 or ours, color=WHITE if head else (GREEN if ours else (NAVY if j == 0 else INK)))
        cell.fill.solid()
        cell.fill.fore_color.rgb = (GREEN if ours else NAVY) if head else (GREEN_SOFT if ours else (WHITE if i % 2 else RGBColor(0xF6, 0xF8, 0xFB)))
chips = ['Sàng lọc bằng dáng đi 3D — hiếm thấy trong sản phẩm cho phụ huynh', 'Khép kín: sàng lọc → can thiệp tại nhà → bác sĩ', 'Nhân vật AI nói tiếng Việt cho trẻ']
for i, c in enumerate(chips):
    x = 0.6 + i * 4.1
    box(s, x, 5.9, 3.95, 0.55, fill=YELLOW_SOFT, radius=0.3)
    text(s, x + 0.15, 5.9, 3.65, 0.55, c, size=12, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)
notes(s, 'Điểm mới của AIMBRACE: thứ nhất, dùng dáng đi 3D làm tín hiệu sàng lọc khách quan mà không cần video; '
         'thứ hai, không dừng ở sàng lọc mà nối tiếp bằng can thiệp tại nhà có AI chấm điểm; thứ ba, nhân vật AI nói tiếng Việt để trẻ chịu tập. '
         'Cognoa Canvas Dx là ví dụ sản phẩm quốc tế đã được FDA cấp phép; AIMBRACE hiện là công cụ tham khảo.')

# ================================================================ 17. Status & testing
s = content_slide('Chất lượng giải pháp', 'Mức độ hoàn thiện hiện tại')
tiles = [('Globe', 'Đang chạy thật', 'aimbrace.agriwatch.io.vn'), ('Server', '8 dịch vụ', 'Docker trên máy chủ GPU'),
         ('CircleCheck', '660+ kiểm thử', 'tự động: đơn vị, đầu-cuối, giao diện, API'), ('Timer', '< 0,4 s', 'suy luận Kinect, CPU')]
for i, (ic, big, lab) in enumerate(tiles):
    x = 0.6 + i * 3.07
    box(s, x, 1.3, 2.87, 1.75, fill=WHITE, line=LINE, radius=0.06, shade=True)
    icon(s, x + 0.25, 1.5, 0.55, ic, bg=GREEN, pad=0.2)
    text(s, x + 0.25, 2.12, 2.5, 0.45, big, size=20, bold=True, color=NAVY, font=HEAD)
    text(s, x + 0.25, 2.57, 2.5, 0.4, lab, size=12, color=MUTE)
box(s, 0.6, 3.3, 5.95, 3.15, fill=GREEN_SOFT, radius=0.04)
icon(s, 0.85, 3.5, 0.5, 'CircleCheck', bg=GREEN, pad=0.2)
text(s, 1.5, 3.5, 4.9, 0.5, 'Đã kiểm chứng', size=16, bold=True, color=GREEN, anchor=MSO_ANCHOR.MIDDLE)
bullets(s, 0.85, 4.15, 5.5, 2.25, [
    'Backend 450 kiểm thử đơn vị; 53/53 kịch bản đầu-cuối trên CSDL tạm',
    'Giao diện 118 kiểm thử; máy chủ AI 46 kiểm thử API',
    'Mô hình Kinect: 555/555 điểm khớp với kết quả thực nghiệm đã lưu',
    'Bản ghi Kinect thử nội bộ: 12/13 cho kết quả “điển hình”',
], size=14, space_after=10)
box(s, 6.8, 3.3, 5.95, 3.15, fill=YELLOW_SOFT, radius=0.04)
icon(s, 7.05, 3.5, 0.5, 'FlaskConical', bg=AMBER, pad=0.2)
text(s, 7.7, 3.5, 4.9, 0.5, 'Chưa kiểm chứng — việc tiếp theo', size=16, bold=True, color=AMBER, anchor=MSO_ANCHOR.MIDDLE)
bullets(s, 7.05, 4.15, 5.5, 2.25, [
    'Chưa thử nghiệm với gia đình và trẻ thật; chưa có khảo sát người dùng',
    'Chấm điểm bài tập chưa hiệu chỉnh trên bản ghi của trẻ',
    'Nhận diện khuôn mặt bố mẹ chưa thử với nhiều người thật',
    'M-CHAT-R/F trong ứng dụng đang chờ phép của tác giả',
], size=14, space_after=10, bullet_color=AMBER)
notes(s, 'Sản phẩm đã triển khai thật và có bộ kiểm thử tự động lớn. Nhóm trình bày rõ phần chưa kiểm chứng: '
         'chưa có thử nghiệm với gia đình thật — đây là ưu tiên số một của giai đoạn tới.')

# ================================================================ 18. Limits & roadmap
s = content_slide('Hướng phát triển', 'Lộ trình tiếp theo')
road = [
    ('12/2026', 'Khảo sát & chuyên gia', 'Khảo sát phụ huynh, xin ý kiến bác sĩ nhi và chuyên viên can thiệp; xin phép tác giả M-CHAT-R/F.'),
    ('Quý 1/2027', 'Thử nghiệm thực tế', 'Thử với gia đình tại một trung tâm can thiệp (có đồng ý); thu thập dữ liệu Kinect của trẻ Việt.'),
    ('Quý 2/2027', 'Cải tiến mô hình', 'Huấn luyện lại trên dữ liệu mới; hiệu chỉnh chấm điểm bài tập trên trẻ; thử sàng lọc bằng camera thường.'),
    ('Sau đó', 'Mở rộng', 'Hợp tác bệnh viện, trung tâm can thiệp; tham gia các cuộc thi đổi mới sáng tạo, khởi nghiệp.'),
]
for i, (when, head, body) in enumerate(road):
    y = 1.3 + i * 1.3
    pill(s, 0.6, y + 0.12, 1.75, 0.45, when, fill=NAVY, color=WHITE, size=13)
    if i < 3:
        ln = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1.475), Inches(y + 0.6), Inches(1.475), Inches(y + 1.4))
        ln.line.color.rgb = LINE; ln.line.width = Pt(2.5)
    box(s, 2.65, y, 10.1, 1.1, fill=WHITE, line=LINE, radius=0.08, shade=True)
    text(s, 2.9, y + 0.1, 9.7, 0.35, head, size=16, bold=True, color=NAVY)
    text(s, 2.9, y + 0.47, 9.7, 0.6, body, size=14, color=INK)
notes(s, 'Bước gần nhất là khảo sát và thử nghiệm với gia đình thật, vì đây là phần còn thiếu để chứng minh hiệu quả. '
         'Dữ liệu Kinect của trẻ Việt Nam sẽ giúp huấn luyện lại mô hình phù hợp hơn với người dùng thực.')

# ================================================================ 19. Team & journey
s = content_slide('Nguồn lực', 'Đội ngũ và hành trình sản phẩm')
team = [('L', 'Phạm Viết Chí Luân', 'Sinh viên AI, lớp 23AI'), ('L', 'Nguyễn Văn Lâm', 'Sinh viên AI, lớp 23AI'),
        ('P', 'Nguyễn Văn Phụng', 'Sinh viên AI, lớp 23AI'), ('N', 'TS. Lê Thị Thu Nga', 'Giảng viên hướng dẫn')]
for i, (ini, name, role) in enumerate(team):
    x = 0.6 + (i % 2) * 2.95
    y = 1.3 + (i // 2) * 1.55
    box(s, x, y, 2.8, 1.4, fill=WHITE, line=LINE, radius=0.08, shade=True)
    c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.2), Inches(y + 0.2), Inches(0.6), Inches(0.6))
    c.fill.solid(); c.fill.fore_color.rgb = NAVY if i == 3 else GREEN; c.line.fill.background()
    tf = c.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; r = p.add_run(); r.text = ini; set_run(r, size=18, bold=True, color=WHITE)
    text(s, x + 0.2, y + 0.85, 2.5, 0.3, name, size=13, bold=True, color=NAVY)
    text(s, x + 0.95, y + 0.2, 1.75, 0.6, role, size=11, color=MUTE, anchor=MSO_ANCHOR.MIDDLE)
box(s, 0.6, 4.5, 5.75, 1.95, fill=BLUE_SOFT, radius=0.05)
text(s, 0.85, 4.62, 5.3, 0.35, 'Nguồn lực sẵn có', size=15, bold=True, color=NAVY)
bullets(s, 0.85, 5.02, 5.3, 1.4, [
    'Máy chủ GPU RTX 5060 Ti và trạm Kinect v2 của nhóm',
    'Nền tảng nghiên cứu: 2 bài báo của nhóm về dáng đi tự kỷ (IEA/AIE 2026, IUKM 2026)',
], size=13, space_after=4, bullet_color=BLUE)
journey = [
    ('09/2026', 'Nộp đề xuất dự thi'),
    ('10/2026', 'Sàng lọc video (OpenPose + ST-GCN), bài tập bắt chước, M-CHAT-R/F, cộng đồng'),
    ('29/10/2026', 'Tự kiểm toán dữ liệu: phát hiện lối tắt của mô hình video'),
    ('11/2026', 'Bạn Bin, trợ lý AI, cổng bác sĩ, nhắc tập trực tiếp'),
    ('21/11/2026', 'Chuyển sàng lọc sang Kinect 3D cho phụ huynh; mở bài tập cho phụ huynh'),
]
text(s, 6.75, 1.3, 6.0, 0.35, 'Hành trình', size=15, bold=True, color=NAVY)
for i, (when, what) in enumerate(journey):
    y = 1.8 + i * 0.93
    dot = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(6.8), Inches(y + 0.08), Inches(0.24), Inches(0.24))
    dot.fill.solid(); dot.fill.fore_color.rgb = GREEN if i == len(journey) - 1 else BLUE; dot.line.fill.background()
    if i < len(journey) - 1:
        ln = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(6.92), Inches(y + 0.32), Inches(6.92), Inches(y + 1.01))
        ln.line.color.rgb = LINE; ln.line.width = Pt(2)
    text(s, 7.2, y + 0.02, 1.6, 0.35, when, size=13, bold=True, color=BLUE if i < len(journey) - 1 else GREEN)
    text(s, 8.85, y + 0.02, 3.9, 0.85, what, size=13, color=INK)
notes(s, 'Nhóm gồm ba sinh viên ngành Trí tuệ nhân tạo và giảng viên hướng dẫn. '
         'Trong hai tháng, nhóm đi từ đề xuất đến sản phẩm chạy thật, và tự phát hiện, sửa hướng khi dữ liệu video cho thấy lối tắt. '
         '(Gợi ý: bổ sung vai trò từng thành viên.)')

# ================================================================ 20. Thanks
s = title_slide()
s.shapes.add_picture(str(LOGO), Inches(3.92), Inches(1.5), Inches(5.5))
text(s, 1.4, 2.95, 10.53, 0.8, 'Cảm ơn Ban giám khảo đã lắng nghe!', size=32, bold=True, color=NAVY, font=HEAD, align=PP_ALIGN.CENTER)
text(s, 1.4, 3.8, 10.53, 0.5, 'AI hỗ trợ phụ huynh phát hiện sớm — và đồng hành cùng trẻ mỗi ngày', size=18, color=INK, align=PP_ALIGN.CENTER)
pill(s, 4.17, 4.65, 5.0, 0.6, 'Demo trực tiếp: aimbrace.agriwatch.io.vn', fill=GREEN, color=WHITE, size=16)
text(s, 1.4, 5.5, 10.53, 0.4, 'Kết quả của AIMBRACE chỉ mang tính tham khảo, không thay thế chẩn đoán của bác sĩ.', size=13, color=MUTE, align=PP_ALIGN.CENTER)
notes(s, 'Nhóm xin cảm ơn và sẵn sàng demo trực tiếp, trả lời câu hỏi.')

assert state['n'] == TOTAL, state['n']
prs.save(str(OUT))
print('saved', OUT, len(prs.slides), 'slides')
