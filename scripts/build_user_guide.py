#!/usr/bin/env python3
"""
Build public/YachtPics_Portal_User_Guide.pdf from the in-app Help page.

The guide is generated straight out of the `sections` and `quickRef` arrays in
src/app/dashboard/help/page.tsx, so the downloadable PDF can never drift away
from what brokers see in the portal. Update the Help page, re-run this, commit.

Usage:  python3 scripts/build_user_guide.py
"""

import os
import re
import sys
from datetime import date

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELP_PAGE = os.path.join(ROOT, "src", "app", "dashboard", "help", "page.tsx")
OUT = os.path.join(ROOT, "public", "YachtPics_Portal_User_Guide.pdf")

# Brand palette — mirrors DESIGN_SYSTEM.md
INK_950 = HexColor("#050b14")
INK_900 = HexColor("#0c1420")
INK_700 = HexColor("#343d4a")
INK_600 = HexColor("#4c5560")
INK_400 = HexColor("#8b939d")
INK_50 = HexColor("#f7f8f9")
ACCENT_500 = HexColor("#c39e4e")
ACCENT_300 = HexColor("#dfc98a")
ACCENT_700 = HexColor("#84662a")
HAIRLINE = HexColor("#e3e6ea")

FONT_DIRS = [
    "/usr/share/fonts/truetype/lato",
    "/usr/share/fonts/truetype/dejavu",
]


def register_fonts() -> None:
    """Lato for type, DejaVu Sans as a fallback for ★ and → glyphs."""
    lato = FONT_DIRS[0]
    dejavu = FONT_DIRS[1]
    pdfmetrics.registerFont(TTFont("Lato", os.path.join(lato, "Lato-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Lato-Bold", os.path.join(lato, "Lato-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("Lato-Semi", os.path.join(lato, "Lato-Semibold.ttf")))
    pdfmetrics.registerFont(TTFont("Sym", os.path.join(dejavu, "DejaVuSans.ttf")))


def unescape(s: str) -> str:
    return s.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")


def strings_in(block: str):
    return [unescape(m) for m in re.findall(r'"((?:[^"\\]|\\.)*)"', block)]


def parse_help_page():
    src = open(HELP_PAGE, encoding="utf-8").read()

    sec_block = re.search(r"const sections = \[(.*?)\n\];", src, re.S)
    qr_block = re.search(r"const quickRef = \[(.*?)\n\];", src, re.S)
    if not sec_block or not qr_block:
        sys.exit("Could not find the sections / quickRef arrays in the Help page.")

    sections = []
    for num, title, steps in re.findall(
        r'num:\s*"([^"]*)",\s*title:\s*"((?:[^"\\]|\\.)*)",\s*steps:\s*\[(.*?)\],',
        sec_block.group(1),
        re.S,
    ):
        sections.append((num, unescape(title), strings_in(steps)))

    quick_ref = []
    for row in re.findall(r"\[(.*?)\],", qr_block.group(1), re.S):
        pair = strings_in(row)
        if len(pair) == 2:
            quick_ref.append(pair)

    if not sections or not quick_ref:
        sys.exit("Parsed the Help page but found no content — check the file format.")
    return sections, quick_ref


def esc(text: str) -> str:
    """XML-escape, then swap in the fallback font for glyphs Lato lacks."""
    out = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    for ch in ("★", "→"):  # star, right arrow
        out = out.replace(ch, f'<font name="Sym">{ch}</font>')
    return out


# ---------------------------------------------------------------- styles
BODY = ParagraphStyle(
    "body", fontName="Lato", fontSize=9.5, leading=14, textColor=INK_600, alignment=TA_LEFT
)
STEP = ParagraphStyle("step", parent=BODY, fontSize=9.5, leading=14.5)
STEP_NUM = ParagraphStyle(
    "stepnum", parent=BODY, fontName="Lato-Bold", textColor=ACCENT_700, alignment=TA_LEFT
)
H2 = ParagraphStyle(
    "h2", fontName="Lato-Bold", fontSize=13, leading=17, textColor=INK_900, spaceAfter=2
)
EYEBROW = ParagraphStyle(
    "eyebrow", fontName="Lato-Bold", fontSize=8, leading=10, textColor=ACCENT_700
)
QR_TASK = ParagraphStyle(
    "qrtask", fontName="Lato-Semi", fontSize=9, leading=12.5, textColor=INK_700
)
QR_WHERE = ParagraphStyle("qrwhere", fontName="Lato", fontSize=9, leading=12.5, textColor=INK_600)
NOTE = ParagraphStyle("note", fontName="Lato", fontSize=9, leading=13.5, textColor=INK_600)
NOTE_H = ParagraphStyle(
    "noteh", fontName="Lato-Bold", fontSize=9.5, leading=13, textColor=INK_900, spaceAfter=3
)


def cover(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(INK_950)
    canvas.rect(0, 0, w, h, stroke=0, fill=1)

    canvas.setFillColor(ACCENT_500)
    canvas.rect(0.9 * inch, h - 2.5 * inch, 1.1 * inch, 3, stroke=0, fill=1)

    canvas.setFillColor(HexColor("#ffffff"))
    canvas.setFont("Lato-Bold", 40)
    canvas.drawString(0.9 * inch, h - 3.35 * inch, "YachtPics Portal")
    canvas.setFillColor(ACCENT_300)
    canvas.setFont("Lato", 27)
    canvas.drawString(0.9 * inch, h - 3.9 * inch, "User Guide")

    canvas.setFillColor(HexColor("#9aa3ad"))
    canvas.setFont("Lato", 11)
    canvas.drawString(
        0.9 * inch, h - 4.6 * inch, "A complete walkthrough of every feature in the broker portal."
    )

    canvas.setFillColor(HexColor("#5d6771"))
    canvas.setFont("Lato", 9)
    canvas.drawString(0.9 * inch, 1.25 * inch, f"Updated {date.today():%B %Y}")
    canvas.drawString(0.9 * inch, 1.05 * inch, "charlie@yachtpics.com")
    canvas.restoreState()


def interior(canvas, doc):
    canvas.saveState()
    w, _ = LETTER
    canvas.setStrokeColor(HAIRLINE)
    canvas.setLineWidth(0.5)
    canvas.line(0.9 * inch, 0.82 * inch, w - 0.9 * inch, 0.82 * inch)
    canvas.setFillColor(INK_400)
    canvas.setFont("Lato", 8)
    canvas.drawString(0.9 * inch, 0.62 * inch, "YachtPics Portal — User Guide")
    canvas.drawRightString(w - 0.9 * inch, 0.62 * inch, str(doc.page - 1))
    canvas.restoreState()


def build():
    register_fonts()
    sections, quick_ref = parse_help_page()

    doc = BaseDocTemplate(
        OUT,
        pagesize=LETTER,
        title="YachtPics Portal — User Guide",
        author="YachtPics",
        subject="Broker portal user guide",
        leftMargin=0.9 * inch,
        rightMargin=0.9 * inch,
        topMargin=0.85 * inch,
        bottomMargin=1.0 * inch,
    )
    frame = Frame(
        doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main",
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=cover),
        PageTemplate(id="interior", frames=[frame], onPage=interior),
    ])

    # Page 1 is the painted cover; everything after it uses the interior template.
    story = [NextPageTemplate("interior"), PageBreak()]

    story.append(Paragraph("GETTING THE MOST FROM YOUR PORTAL", EYEBROW))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "This guide mirrors the Help page inside the portal, so it is always the same "
            "information in the same order. Work through it once and you will know every "
            "feature; after that, the Quick Reference at the back is the fastest way to find "
            "a single answer.",
            BODY,
        )
    )
    story.append(Spacer(1, 18))

    step_table_style = TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ])
    widths = [0.28 * inch, doc.width - 0.28 * inch]

    def step_table(rows):
        t = Table(rows, colWidths=widths)
        t.setStyle(step_table_style)
        return t

    # A heading is never orphaned: it stays glued to the first few steps. Anything
    # past that is allowed to flow to the next page rather than leaving half a page blank.
    ANCHOR = 3
    for num, title, steps in sections:
        rows = [
            [Paragraph(f"{i + 1}.", STEP_NUM), Paragraph(esc(step), STEP)]
            for i, step in enumerate(steps)
        ]
        head = [Paragraph(f"{num} &nbsp;&nbsp; {esc(title)}", H2), Spacer(1, 5)]
        story.append(KeepTogether(head + [step_table(rows[:ANCHOR])]))
        if len(rows) > ANCHOR:
            story.append(step_table(rows[ANCHOR:]))
        story.append(Spacer(1, 16))

    # ------------------------------------------------------ quick reference
    story.append(PageBreak())
    story.append(Paragraph("QUICK REFERENCE", EYEBROW))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Where to click for the thing you need right now.", BODY))
    story.append(Spacer(1, 12))

    rows = [[Paragraph("<b>Task</b>", QR_TASK), Paragraph("<b>Where</b>", QR_TASK)]]
    for task, where in quick_ref:
        rows.append([Paragraph(esc(task), QR_TASK), Paragraph(esc(where), QR_WHERE)])

    qr = Table(rows, colWidths=[doc.width * 0.45, doc.width * 0.55], repeatRows=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, HAIRLINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK_400),
    ]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), INK_50))
    qr.setStyle(TableStyle(style))
    story.append(qr)

    # ------------------------------------------------------------- closing
    story.append(Spacer(1, 22))
    closing = Table(
        [[[
            Paragraph("Still have questions?", NOTE_H),
            Paragraph(
                "Reach out to your YachtPics rep directly at charlie@yachtpics.com. "
                "We typically respond same day.",
                NOTE,
            ),
        ]]],
        colWidths=[doc.width],
    )
    closing.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#faf6ec")),
            ("BOX", (0, 0), (-1, -1), 0.6, ACCENT_300),
            ("LEFTPADDING", (0, 0), (-1, -1), 14),
            ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ])
    )
    story.append(closing)
    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "<b>Copyright &amp; content.</b> All content uploaded to the YachtPics Portal must be "
            "owned by you or used with the copyright holder's permission. To submit a takedown "
            "request, email dmca@yachtpics.com with a description of the work, the location of the "
            "infringing material, and your contact information.",
            ParagraphStyle("fine", parent=NOTE, fontSize=8, leading=12, textColor=INK_400),
        )
    )

    doc.build(story)
    print(f"Wrote {OUT} ({os.path.getsize(OUT):,} bytes) — "
          f"{len(sections)} sections, {len(quick_ref)} quick-reference rows.")


if __name__ == "__main__":
    build()
