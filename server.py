#!/usr/bin/env python3
import io
import json
import os
import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)

WEB_DIR = os.path.dirname(os.path.abspath(__file__))

FONT_SANS = "Helvetica"
FONT_SERIF = "Helvetica"

def init_fonts():
    global FONT_SANS, FONT_SERIF
    heiti_candidates = [
        ("/System/Library/Fonts/STHeiti Medium.ttc", 1),
        ("/System/Library/Fonts/STHeiti Light.ttc", 1),
        ("/System/Library/Fonts/PingFang.ttc", 2),
    ]
    songti_candidates = [
        ("/System/Library/Fonts/Supplemental/Songti.ttc", 6),
        ("/System/Library/Fonts/Supplemental/Songti.ttc", 3),
        ("/System/Library/Fonts/STHeiti Light.ttc", 1),
    ]
    for path, idx in heiti_candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("ZH-Sans", path, subfontIndex=idx))
                FONT_SANS = "ZH-Sans"
                break
            except Exception:
                pass
    for path, idx in songti_candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("ZH-Serif", path, subfontIndex=idx))
                FONT_SERIF = "ZH-Serif"
                break
            except Exception:
                pass

init_fonts()

def esc(text):
    if text is None:
        return ""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )

def build_notebook_pdf(payload: dict) -> bytes:
    items = payload.get("items", [])
    title = payload.get("title", "考研英语（二）阅读精翻 · 单词与句型复盘本")
    subtitle = payload.get("subtitle", f"导出日期：{datetime.date.today().strftime('%Y-%m-%d')} · 共 {len(items)} 条重点记录")

    buf = io.BytesIO()

    def draw_page(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setStrokeColor(colors.HexColor("#D7DFE8"))
        canvas.setLineWidth(0.6)
        canvas.line(15 * mm, h - 14 * mm, w - 15 * mm, h - 14 * mm)
        canvas.setFont(FONT_SANS, 8.5)
        canvas.setFillColor(colors.HexColor("#5B6876"))
        canvas.drawString(15 * mm, h - 11.5 * mm, "考研英语（二）阅读精翻实训系统 · 专属错题单词与句型本")
        canvas.drawRightString(w - 15 * mm, h - 11.5 * mm, f"第 {doc.page} 页")
        canvas.line(15 * mm, 13 * mm, w - 15 * mm, 13 * mm)
        canvas.drawString(15 * mm, 8.8 * mm, "建议复盘方法：遮住右侧释义与标准译文，结合原句语境口头复述词义及句法切分。")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=18 * mm,
        bottomMargin=17 * mm,
        title=title,
    )

    st_title = ParagraphStyle(
        "DocTitle",
        fontName=FONT_SANS,
        fontSize=17,
        leading=23,
        textColor=colors.HexColor("#173B66"),
        spaceAfter=2 * mm,
    )
    st_sub = ParagraphStyle(
        "DocSub",
        fontName=FONT_SERIF,
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#5B6876"),
        spaceAfter=4 * mm,
    )
    st_sec = ParagraphStyle(
        "SecHeader",
        fontName=FONT_SANS,
        fontSize=12,
        leading=17,
        textColor=colors.HexColor("#174D83"),
        spaceBefore=3 * mm,
        spaceAfter=2.5 * mm,
    )
    st_th = ParagraphStyle(
        "TH",
        fontName=FONT_SANS,
        fontSize=9,
        leading=13,
        textColor=colors.white,
    )
    st_word = ParagraphStyle(
        "WordCell",
        fontName=FONT_SANS,
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#192530"),
    )
    st_meaning = ParagraphStyle(
        "MeaningCell",
        fontName=FONT_SERIF,
        fontSize=9.3,
        leading=13.5,
        textColor=colors.HexColor("#22313F"),
    )
    st_ctx = ParagraphStyle(
        "CtxCell",
        fontName=FONT_SERIF,
        fontSize=8.6,
        leading=12.8,
        textColor=colors.HexColor("#334556"),
    )
    st_tag = ParagraphStyle(
        "TagCell",
        fontName=FONT_SANS,
        fontSize=8.2,
        leading=11.5,
        textColor=colors.HexColor("#8A3B12"),
    )

    story = []
    story.append(Paragraph(esc(title), st_title))
    story.append(Paragraph(esc(subtitle), st_sub))

    vocab_items = [x for x in items if x.get("kind") != "pattern"]
    pattern_items = [x for x in items if x.get("kind") == "pattern"]

    # Summary strip
    sum_data = [[
        Paragraph(f"<b>总收录条目：</b>{len(items)} 条", st_meaning),
        Paragraph(f"<b>核心单词与词块：</b>{len(vocab_items)} 条", st_meaning),
        Paragraph(f"<b>长难句型结构：</b>{len(pattern_items)} 条", st_meaning),
        Paragraph(f"<b>待强化攻克：</b>{sum(1 for x in items if not x.get('mastered'))} 条", st_meaning),
    ]]
    sum_tbl = Table(sum_data, colWidths=[45 * mm, 45 * mm, 45 * mm, 45 * mm])
    sum_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF4FA")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#C5D6E8")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D7E3F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(sum_tbl)
    story.append(Spacer(1, 4 * mm))

    if vocab_items:
        story.append(Paragraph("一、未译出与易错核心单词 / 短语词块", st_sec))
        rows = [[
            Paragraph("序号 / 来源", st_th),
            Paragraph("英文单词 / 核心词块", st_th),
            Paragraph("精准释义与诊断状态", st_th),
            Paragraph("真题原句、参考译文与我的误译对比", st_th),
        ]]
        for idx, item in enumerate(vocab_items, 1):
            loc = item.get("source", "真题精选")
            reason = item.get("reason", "未译出")
            status = "已掌握" if item.get("mastered") else "待攻克"
            col1 = Paragraph(f"<b>#{idx:02d}</b><br/><font color='#5B6876' size='8'>{esc(loc)}</font><br/><font color='#B45309' size='8'>[{esc(reason)}·{status}]</font>", st_tag)
            col2 = Paragraph(f"<b>{esc(item.get('term', ''))}</b>", st_word)
            ctx_zh = item.get("context_zh", "")
            ctx_line = f"<br/><font color='#174D83' size='8.3'>语境义：{esc(ctx_zh)}</font>" if ctx_zh else ""
            col3 = Paragraph(f"{esc(item.get('meaning', ''))}{ctx_line}", st_meaning)
            user_tr = item.get("user_zh", "").strip()
            user_line = f"<br/><font color='#9A3412'><b>我的译文：</b>{esc(user_tr)}</font>" if user_tr else "<br/><font color='#9A3412'><b>我的译文：</b>（练习时漏译该词块）</font>"
            col4 = Paragraph(
                f"<b>原句：</b>{esc(item.get('en', ''))}<br/>"
                f"<font color='#174D83'><b>标准译文：</b>{esc(item.get('zh', ''))}</font>"
                f"{user_line}",
                st_ctx,
            )
            rows.append([col1, col2, col3, col4])

        vtbl = Table(rows, colWidths=[26 * mm, 36 * mm, 42 * mm, 76 * mm], repeatRows=1)
        vtbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#174D83")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(vtbl)
        story.append(Spacer(1, 5 * mm))

    if pattern_items:
        story.append(Paragraph("二、未译出与易错长难句型结构剖析", st_sec))
        for idx, item in enumerate(pattern_items, 1):
            loc = item.get("source", "真题精选")
            reason = item.get("reason", "句法偏差")
            user_tr = item.get("user_zh", "").strip() or "（未完整译出该句型逻辑）"
            card_rows = [
                [
                    Paragraph(f"<b>句型 #{idx:02d} · {esc(item.get('term', ''))}</b>", st_word),
                    Paragraph(f"<font color='#B45309'><b>[{esc(reason)}]</b></font> 来源：{esc(loc)}", st_meaning),
                ],
                [
                    Paragraph(
                        f"<b>句型锚点：</b>{esc(item.get('meaning', ''))}<br/>"
                        f"<b>真题原句：</b>{esc(item.get('en', ''))}<br/>"
                        f"<font color='#174D83'><b>参考精译：</b>{esc(item.get('zh', ''))}</font><br/>"
                        f"<font color='#9A3412'><b>我的译文：</b>{esc(user_tr)}</font><br/>"
                        f"<font color='#2E5B44'><b>句法点拨：</b>{esc(item.get('note', ''))}</font>",
                        st_ctx,
                    ),
                    None,
                ],
            ]
            ptbl = Table(card_rows, colWidths=[115 * mm, 65 * mm])
            ptbl.setStyle(TableStyle([
                ("SPAN", (0, 1), (1, 1)),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FEF6EC")),
                ("BACKGROUND", (0, 1), (-1, 1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#E7CFA8")),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#E7CFA8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(KeepTogether([ptbl, Spacer(1, 3 * mm)]))

    if not items:
        story.append(Paragraph("当前单词本暂无记录。请在逐句精翻实训中提交译文或点击“加入单词本”后再导出。", st_meaning))

    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return buf.getvalue()

class JingfanRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/export-pdf":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length > 0 else b"{}"
                payload = json.loads(raw.decode("utf-8"))
                pdf_bytes = build_notebook_pdf(payload)
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Disposition", 'attachment; filename="Kaoyan-Eng2-Vocab-Notebook.pdf"')
                self.send_header("Content-Length", str(len(pdf_bytes)))
                self.end_headers()
                self.wfile.write(pdf_bytes)
            except Exception as e:
                err = json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
        else:
            self.send_Error(404, "Not Found")

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("0.0.0.0", port), JingfanRequestHandler)
    print(f"Serving Kaoyan Jingfan Web at http://127.0.0.1:{port}")
    server.serve_forever()
