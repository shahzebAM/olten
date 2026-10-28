"""Build the customer handbook from reviewed instructions and actual app captures."""
import argparse
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle, Flowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
W, H = landscape(A4)
MARGIN = 38
CW = W - MARGIN * 2
TEAL = colors.HexColor('#218409')
INK = colors.HexColor('#282828')
MUTED = colors.HexColor('#53677E')
PALE = colors.HexColor('#F1F8EC')
LINE = colors.HexColor('#D8E4EB')
GOLD = colors.HexColor('#D58721')


def clean(value):
    return str(value or '').replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-').replace('\u00a0', ' ')


def markup(value):
    text = escape(clean(value))
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`(.+?)`', r'<b>\1</b>', text)
    return text.replace('\n', '<br/>')


def register_fonts():
    for name, filename in [('Guide', 'arial.ttf'), ('GuideBold', 'arialbd.ttf'), ('GuideItalic', 'ariali.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / filename)))
    pdfmetrics.registerFontFamily('Guide', normal='Guide', bold='GuideBold', italic='GuideItalic', boldItalic='GuideBold')


register_fonts()
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='GuideBody', fontName='Guide', fontSize=10.5, leading=15, textColor=INK, spaceAfter=4))
styles.add(ParagraphStyle(name='GuideSmall', parent=styles['GuideBody'], fontSize=9, leading=11.5, textColor=MUTED, spaceAfter=2.5))
styles.add(ParagraphStyle(name='GuideHeading', fontName='GuideBold', fontSize=23, leading=28, textColor=INK, spaceAfter=10, keepWithNext=True))
styles.add(ParagraphStyle(name='GuideSub', fontName='GuideBold', fontSize=12, leading=16, textColor=TEAL, spaceBefore=5, spaceAfter=4, keepWithNext=True))
styles.add(ParagraphStyle(name='GuideStep', parent=styles['GuideBody'], fontSize=11, leading=14, spaceAfter=2))
styles.add(ParagraphStyle(name='GuideCardTitle', parent=styles['GuideSub'], spaceBefore=0, spaceAfter=4))
styles.add(ParagraphStyle(name='GuideNumber', fontName='GuideBold', fontSize=13, leading=18, textColor=TEAL))
styles.add(ParagraphStyle(name='GuideCaption', parent=styles['GuideSmall'], fontSize=9.5, leading=13, alignment=TA_CENTER))
styles.add(ParagraphStyle(name='GuideKicker', parent=styles['GuideSmall'], fontName='GuideBold', fontSize=9, textColor=TEAL, spaceAfter=7))


def p(text, style='GuideBody'):
    return Paragraph(markup(text), styles[style])


class GuideDoc(BaseDocTemplate):
    def __init__(self, target, draft=False):
        super().__init__(str(target), pagesize=(W, H), leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=52, bottomMargin=35, title='Olten ERP - Complete Customer User Guide',
                         author='Olten ERP', subject='Step-by-step customer operations handbook',
                         pageCompression=1, allowSplitting=1)
        self.draft = draft
        self.addPageTemplates(PageTemplate(id='guide', frames=[Frame(MARGIN, 35, CW, H - 87, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=self.page_decoration))

    def page_decoration(self, canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setFont('GuideBold', 9)
            canvas.setFillColor(TEAL)
            canvas.drawString(MARGIN, H - 25, 'OLTEN  /  CUSTOMER USER GUIDE')
            canvas.setStrokeColor(LINE)
            canvas.line(MARGIN, H - 34, W - MARGIN, H - 34)
        canvas.setStrokeColor(LINE)
        canvas.line(MARGIN, 27, W - MARGIN, 27)
        canvas.setFont('Guide', 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, 14, 'Training edition - Demo records only' + (' - INTERNAL DRAFT' if self.draft else ''))
        canvas.drawRightString(W - MARGIN, 14, f'{doc.page}')
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and hasattr(flowable, 'guide_key'):
            self.canv.bookmarkPage(flowable.guide_key)
            self.canv.addOutlineEntry(flowable.getPlainText(), flowable.guide_key, 0, False)
            self.notify('TOCEntry', (0, flowable.getPlainText(), self.page, flowable.guide_key))


class Cover(Flowable):
    def __init__(self, title, subtitle, draft, as_of):
        Flowable.__init__(self)
        self.width = CW
        self.height = H - 100
        self.title, self.subtitle, self.draft = title, subtitle, draft
        self.as_of = as_of

    def draw(self):
        c = self.canv
        c.setFillColor(INK)
        c.roundRect(0, 0, self.width, self.height, 16, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.roundRect(self.width - 200, 0, 200, self.height, 16, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont('GuideBold', 18)
        c.drawString(35, self.height - 50, 'OLTEN ERP')
        title = Paragraph('Complete customer<br/>user guide', ParagraphStyle('cover', fontName='GuideBold', fontSize=38, leading=44, textColor=colors.white))
        title.wrap(self.width - 240, 160)
        title.drawOn(c, 35, self.height - 205)
        desc = Paragraph('Set up the workspace. Enter the records.<br/>Follow each handoff through to payment and reporting.', ParagraphStyle('coverbody', fontName='Guide', fontSize=14, leading=21, textColor=colors.HexColor('#D5EFF2')))
        desc.wrap(self.width - 255, 90)
        desc.drawOn(c, 35, self.height - 300)
        c.setFont('GuideBold', 11)
        c.drawString(35, 72, 'Every module - Numbered steps - Real application screenshots')
        c.setFont('Guide', 10)
        c.drawString(35, 44, 'Customer training edition  |  ' + self.as_of)
        c.setFillColor(colors.HexColor('#E2F5F5'))
        for index, label in enumerate(['SET UP', 'PURCHASE', 'RECEIVE', 'FULFILL', 'COLLECT', 'REPORT']):
            c.setFont('GuideBold', 11)
            c.drawString(self.width - 163, self.height - 82 - index * 55, f'{index + 1:02d}  {label}')


class ConnectionMap(Flowable):
    def __init__(self, nodes, footer, columns=4):
        Flowable.__init__(self)
        self.width = CW
        self.height = 340
        self.nodes, self.footer, self.columns = nodes, footer, columns

    def draw(self):
        c = self.canv
        bw = (CW - 24 * (self.columns - 1)) / self.columns
        bh = 90
        y0 = self.height - 96
        for index, node in enumerate(self.nodes):
            row, col = divmod(index, self.columns)
            if row % 2:
                col = self.columns - 1 - col
            x, y = col * (bw + 24), y0 - row * 120
            color = TEAL if node.get('type') != 'finance' else colors.HexColor('#7655AD')
            c.setFillColor(PALE if node.get('type') != 'finance' else colors.HexColor('#F3EFF9'))
            c.setStrokeColor(LINE)
            c.roundRect(x, y, bw, bh, 8, stroke=1, fill=1)
            c.setFillColor(color)
            c.circle(x + 16, y + bh - 18, 9, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont('GuideBold', 9)
            c.drawCentredString(x + 16, y + bh - 21, str(index + 1))
            title = p(node['title'], 'GuideSub')
            title.wrap(bw - 48, 44)
            title.drawOn(c, x + 36, y + 50)
            label = p(node.get('detail', ''), 'GuideSmall')
            _, h = label.wrap(bw - 24, 40)
            label.drawOn(c, x + 12, y + 10 if h < 30 else y + 7)
            if index + 1 < len(self.nodes) and node.get('connect', True):
                if (index + 1) % self.columns:
                    direction = 1 if row % 2 == 0 else -1
                    ax = x + bw + 2 if direction == 1 else x - 2
                    bx = ax + direction * 20
                    yy = y + bh / 2
                    c.setStrokeColor(TEAL)
                    c.setLineWidth(1.2)
                    c.line(ax, yy, bx, yy)
                    c.line(bx, yy, bx - direction * 5, yy + 4)
                    c.line(bx, yy, bx - direction * 5, yy - 4)
                else:
                    xx = x + bw / 2
                    c.setStrokeColor(TEAL)
                    c.line(xx, y - 2, xx, y - 27)
                    c.line(xx, y - 27, xx - 4, y - 22)
                    c.line(xx, y - 27, xx + 4, y - 22)
        note = p(self.footer, 'GuideBody')
        _, nh = note.wrap(CW - 22, 65)
        note.drawOn(c, 10, 5)


def bullets(items, style='GuideSmall'):
    return [Paragraph('&#8226; ' + markup(item), styles[style]) for item in items if item]


def side_card(title, body):
    contents = [p(title, 'GuideCardTitle')] + [p(text, 'GuideSmall') for text in body if text]
    t = Table([[contents]], colWidths=[CW])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), PALE), ('BOX', (0, 0), (-1, -1), .5, LINE), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
    return t


def load_manifest(path):
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding='utf-8-sig'))
    data = raw.get('screenshots', raw) if isinstance(raw, dict) else raw
    if isinstance(data, list):
        return {row['id']: row for row in data}
    return {key: ({'path': value} if isinstance(value, str) else value) for key, value in data.items()}


def image_path(shot_id, manifest, base):
    item = manifest.get(shot_id, {})
    value = item.get('path') or item.get('file') or item.get('imagePath')
    if value:
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = base / candidate
        if candidate.exists():
            return candidate
    for suffix in ['.png', '.jpg', '.jpeg']:
        candidate = base / (shot_id + suffix)
        if candidate.exists():
            return candidate
    return None


def chapter_heading(title, key):
    heading = p(title, 'GuideHeading')
    heading.guide_key = key
    return heading


def build(args):
    data = json.loads(args.content.read_text(encoding='utf-8-sig'))
    manifest = load_manifest(args.manifest)
    chapters = data['chapters']
    missing = []
    for chapter in chapters:
        for shot in chapter.get('screenshots', []):
            if not image_path(shot['id'], manifest, args.manifest.parent):
                missing.append(shot['id'])
    if missing and not args.draft:
        raise RuntimeError('Missing actual app captures: ' + ', '.join(sorted(set(missing))))
    OUT.mkdir(parents=True, exist_ok=True)
    story = [Cover(data.get('title', ''), data.get('subtitle', ''), args.draft, data.get('asOf', '')), PageBreak()]
    story += [chapter_heading('How to use this guide', 'how_to_use'), p(data.get('overview', '')), p('Each task explains what you need first, the exact controls to use, the expected result and the next module. Screen references follow the task so you can compare the instructions with the actual application.')]
    story += [side_card('Start with a safe training example', [
        'Screenshots use a separate demonstration workspace with fictional customers, suppliers, products and employees. Use your own generated document numbers in daily work.',
        'The worked example follows a hospital order through purchasing, receiving, delivery, invoicing and payment. If goods are already available, skip the purchasing/receiving branch and reserve the existing stock.',
        'Payroll follows its own employee-to-attendance-to-payroll sequence. It runs independently of the operational finance ledger.',
    ]), Spacer(1, 14)]
    story += [p('Reading and navigation', 'GuideSub')]
    story += bullets(['Use the clickable contents or PDF bookmarks to jump to a task.', 'Open the screen reference after each task. Zoom the PDF when inspecting a field or table.', 'Buttons and fields may be hidden when your role does not permit the action. Ask the workspace administrator to review your access.', 'Verify the company at the top of the application before entering records. Financial posting, stock dispatch and deletion are deliberate actions.'], 'GuideBody')
    story += [Paragraph('Application: <link href="https://olten.vercel.app" color="#007C91">https://olten.vercel.app</link>', styles['GuideSmall']), PageBreak()]
    story += [chapter_heading('Contents', 'contents')]
    toc = TableOfContents()
    toc.levelStyles = [ParagraphStyle('toc', fontName='Guide', fontSize=10.2, leading=15, leftIndent=0, firstLineIndent=0, spaceBefore=3, textColor=INK)]
    story += [toc, PageBreak()]
    maps = [
        ('Connection map 1 - Set up, create demand and receive stock', [
            {'title': 'Workspace & users', 'detail': 'Company access, roles and approval limits'},
            {'title': 'Chart of accounts', 'detail': 'Initialize standard accounts; add custom accounts as needed', 'type': 'finance'},
            {'title': 'Master records', 'detail': 'Customers, suppliers, products and warehouse locations'},
            {'title': 'Order Slip', 'detail': 'Enter the customer requirement and review availability'},
            {'title': 'Supplier procurement', 'detail': 'Create the required supplier P.O. from the supported order workflow'},
            {'title': 'Importation', 'detail': 'Requisitions, shipment, customs, expenses and documents'},
            {'title': 'Receiving & QC', 'detail': 'Record received goods and accepted/rejected/held quantities'},
            {'title': 'Warehouse stock', 'detail': 'Put accepted goods into a bin; available stock can be reserved'},
        ], 'Master records are reused throughout the app. Incoming shipment allocations are planned supply; they become reservable stock only after receiving, QC and stock placement.'),
        ('Connection map 2 - Reserve, deliver, invoice and collect', [
            {'title': 'Approve & reserve', 'detail': 'Lock available stock against the customer order'},
            {'title': 'F.O. / Packing List', 'detail': 'Generate fulfillment documents and the delivery record'},
            {'title': 'FEFO picking', 'detail': 'Pick the eligible batch/serial and verify the scanned item'},
            {'title': 'Confirm dispatch', 'detail': 'Physical stock is issued at this point'},
            {'title': 'Proof of delivery', 'detail': 'Confirm received quantities and attach the signed receipt'},
            {'title': 'Invoice & approval', 'detail': 'Bill only the new POD-confirmed quantities', 'type': 'finance'},
            {'title': 'Payment & aging', 'detail': 'Allocate receipts and monitor the remaining balance', 'type': 'finance'},
            {'title': 'Books & bank match', 'detail': 'Review journals, trial balance and statement reconciliation', 'type': 'finance'},
        ], 'Generating documents does not issue stock twice. Partial deliveries can produce partial invoices and separate payments. Supplier bills follow the payable/payment-request branch into the same Books workspace.'),
        ('Connection map 3 - Supporting modules and control', [
            {'title': 'Landed cost', 'detail': 'Finance-approved shipment cost updates the product cost reference', 'type': 'finance', 'connect': False},
            {'title': 'Device service', 'detail': 'POD-delivered serials become warranty and maintenance assets', 'connect': False},
            {'title': 'Documents & OCR', 'detail': 'Compliance files, expiry reminders and invoice extraction for review', 'connect': False},
            {'title': 'Executive reports', 'detail': 'Role-filtered operational and financial reporting', 'connect': False},
            {'title': 'Employee directory', 'detail': 'Employee, salary and payroll profile setup'},
            {'title': 'Attendance', 'detail': 'Save time sessions for the selected cutoff'},
            {'title': 'Payroll computation', 'detail': 'Review hours, rates, deductions and net pay'},
            {'title': 'Payslips & reports', 'detail': 'Print payslips, tax previews and payroll summaries'},
        ], 'User Control and company access apply across the system. The bottom row is the separate payroll sequence; it does not automatically create operational Books entries. AI only uses data permitted for the requesting role.'),
    ]
    for title, nodes, footer in maps:
        story += [p(title, 'GuideHeading'), Spacer(1, 12), ConnectionMap(nodes, footer), PageBreak()]

    story += [chapter_heading('Connection map 4 - Accounting review and signoff', 'accounting_handoffs'),
              p('Use these checks after posting. Each branch answers a different question; completing one does not complete the others.')]
    accounting_checks = [
        {'title': 'Posted source records', 'detail': 'Invoices, bills, memos, payments and approved manual journals', 'type': 'finance'},
        {'title': 'Original accounts', 'detail': 'Posting roles guide new records; old source accounts stay traceable', 'type': 'finance'},
        {'title': 'Financial statements', 'detail': 'Period totals, P&L, Balance Sheet, Trial Balance and account ledger', 'type': 'finance'},
        {'title': 'Review and export', 'detail': 'Keep the complete filtered report and its Scope and totals', 'type': 'finance', 'connect': False},
        {'title': 'Cash classification', 'detail': 'Designate cash accounts; classify signed movements and transfers', 'type': 'finance', 'connect': False},
        {'title': 'Bank reconciliation', 'detail': 'Match external statement transactions to unused ledger entries', 'type': 'finance', 'connect': False},
        {'title': 'Inventory comparison', 'detail': 'Compare office/warehouse references with Inventory controls', 'type': 'finance', 'connect': False},
        {'title': 'Evidence and audit', 'detail': 'Resolve exceptions with Finance; retain approved corrections and history', 'type': 'finance', 'connect': False},
    ]
    story += [ConnectionMap(accounting_checks, 'Cash-flow classification, bank matching and inventory comparison are separate reviews of the same saved records. None automatically adjusts another module.'), PageBreak()]

    story += [chapter_heading('Your actions and the automatic handoffs', 'handoffs'),
              p('Use this page to see which button completes each handoff. Opening a screen or preparing a document does not complete the next team\'s task.')]
    handoffs = [
        ('Approve & reserve an Order Slip', 'Available stock is reserved for that order.', 'Warehouse prepares the delivery when the order is ready.'),
        ('Generate F.O. or Packing List', 'The fulfillment document links to a delivery record.', 'Verify the pick list, then confirm dispatch. Document generation alone does not issue stock.'),
        ('Confirm dispatch', 'The dispatched quantities reduce physical stock.', 'Record delivery quantities and attach the signed POD.'),
        ('Confirm POD', 'Delivered quantities become eligible for invoicing when an active F.O. exists.', 'Finance creates and reviews the invoice, then posts it.'),
        ('Post an invoice or supplier bill', 'Balanced journal entries and the receivable or payable are recorded.', 'Record an externally completed payment and allocate it to the correct documents.'),
        ('Finalize a landed cost', 'Approved unit costs enter history and update the landed cost reference.', 'Create/post the supplier or expense bills separately. Manual cost and tier prices remain independent.'),
        ('Approve a payment request', 'The request becomes authorized within the approver\'s limit.', 'Complete the payment outside the ERP, then record and post it in the app.'),
        ('Post an allocated payment', 'Document balances, aging and Books entries are updated.', 'Match the posted bank entry to the bank statement. The app does not transfer money.'),
        ('Save a cash classification version', 'The reporting category and reason are retained; the journal stays unchanged.', 'Review Cash Flow completeness and classify both sides of internal transfers.'),
        ('Refresh inventory reconciliation', 'Current office/warehouse references are compared with posted Inventory.', 'Investigate differences. Use a Finance-authorized correction only when source evidence supports it.'),
        ('Save attendance and payroll', 'Saved attendance supports the payroll calculation and saved payroll reports.', 'Review deductions and issue the payslip. Payroll does not automatically post to operational Books.'),
    ]
    rows = [[p('You confirm', 'GuideSub'), p('The system does', 'GuideSub'), p('What you do next', 'GuideSub')]]
    rows += [[p(cell, 'GuideSmall') for cell in row] for row in handoffs]
    table = Table(rows, colWidths=[CW * .22, CW * .34, CW * .44], repeatRows=1)
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), PALE), ('LINEBELOW', (0, 0), (-1, -1), .4, LINE), ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
    story += [table, PageBreak()]

    used_shots = set()
    for number, chapter in enumerate(chapters, 1):
        key = 'chapter_' + chapter['id']
        chapter_title = re.sub(r'^\d+\.\s*', '', chapter['title'])
        title = f'{number:02d}  {chapter_title}'
        story += [chapter_heading(title, key)]
        if chapter.get('module'):
            story += [p(chapter['module'], 'GuideKicker')]
        story += [p(chapter.get('purpose', ''))]
        roles = chapter.get('roles', [])
        if roles:
            story += [p('Who can do this: ' + (', '.join(roles) if isinstance(roles, list) else roles), 'GuideSmall')]
        before = chapter.get('before', [])
        if before:
            story += [p('Before you start', 'GuideSub')] + bullets(before)
        story += [p('Do this, in order', 'GuideSub')]
        for step_number, step in enumerate(chapter.get('steps', []), 1):
            step_text = step.get('text', step.get('action', '')) if isinstance(step, dict) else step
            table = Table([[p(str(step_number), 'GuideNumber'), p(step_text, 'GuideStep')]], colWidths=[28, CW - 28])
            table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
            story += [KeepTogether(table)]
        result = chapter.get('result')
        if result:
            story += [p('Check the result', 'GuideSub'), p(result)]
        connections = chapter.get('connections') or chapter.get('next')
        if connections:
            if isinstance(connections, dict):
                texts = [f'{label}: {value}' for label, value in connections.items()]
            else:
                texts = connections if isinstance(connections, list) else [connections]
            story += [side_card('How this connects', texts)]
        if chapter.get('example'):
            example = chapter['example']
            if isinstance(example, dict):
                example = '; '.join(f'{key}: {value}' for key, value in example.items())
            story += [p('Worked example: ' + clean(example), 'GuideSmall')]
        if chapter.get('notes'):
            story += [p('Remember', 'GuideSub')] + bullets(chapter['notes'])
        for shot in chapter.get('screenshots', []):
            if shot['id'] in used_shots:
                story += [Paragraph(f'Screen reference: <link href="#screen_{shot["id"]}" color="#007C91">{markup(shot.get("caption", shot["id"]))}</link>', styles['GuideSmall'])]
        for shot in chapter.get('screenshots', []):
            shot_id = shot['id']
            if shot_id in used_shots:
                continue
            used_shots.add(shot_id)
            image = image_path(shot_id, manifest, args.manifest.parent)
            screen_heading = Paragraph(f'<a name="screen_{shot_id}"/>Screen reference {number:02d} - {markup(chapter_title)}', styles['GuideSub'])
            caption = p(shot.get('caption', chapter_title), 'GuideCaption')
            return_link = Paragraph(f'<link href="#{key}" color="#007C91">Return to numbered steps</link>', styles['GuideCaption'])
            story += [PageBreak(), screen_heading]
            if image:
                with PILImage.open(image) as source:
                    iw, ih = source.size
                fixed_height = sum(item.wrap(CW, H)[1] for item in [screen_heading, caption, return_link]) + 50
                ratio = min(CW / iw, (H - 87 - fixed_height) / ih)
                picture = Image(str(image), width=iw * ratio, height=ih * ratio)
                picture.hAlign = 'CENTER'
                story += [picture, Spacer(1, 9), caption]
            else:
                story += [Spacer(1, 130), p('INTERNAL DRAFT - actual screenshot pending: ' + shot_id, 'GuideHeading'), Spacer(1, 100)]
            story += [return_link]
        story += [PageBreak()]
    if data.get('checklists'):
        story += [chapter_heading('Daily and cutoff checklists', 'checklists')]
        for checklist in data['checklists']:
            story += [p(checklist['title'], 'GuideSub')] + bullets(checklist['items'], 'GuideBody')
        story += [PageBreak()]
    if data.get('troubleshooting'):
        story += [chapter_heading('Troubleshooting', 'troubleshooting')]
        for row in data['troubleshooting']:
            story += [KeepTogether([p(row['problem'], 'GuideSub'), p(row['resolution'])])]
        story += [PageBreak()]
    if data.get('glossary'):
        story += [chapter_heading('Document and field glossary', 'glossary')]
        rows = [[p(row['term'], 'GuideSub'), p(row['meaning'])] for row in data['glossary']]
        table = Table(rows, colWidths=[135, CW - 135], hAlign='LEFT')
        table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -1), .4, LINE), ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 8)]))
        story += [table]
    target = args.output or OUT / ('Olten_ERP_Complete_User_Guide_DRAFT.pdf' if args.draft else 'Olten_ERP_Complete_User_Guide.pdf')
    doc = GuideDoc(target, args.draft)
    doc.multiBuild(story)
    report = {'output': str(target), 'chapters': len(chapters), 'screenshots': len(used_shots), 'missing': sorted(set(missing)), 'draft': args.draft, 'pages': doc.page}
    (OUT / 'guide-build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--content', type=Path, default=ROOT / 'docs/customer-guide/content.json')
    parser.add_argument('--manifest', type=Path, default=OUT / 'assets/manifest.json')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--draft', action='store_true')
    build(parser.parse_args())
