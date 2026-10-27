"""把上傳的 PDF、Word、Markdown、純文字檔轉成文字，並遮掉 Email、電話、身分證字號。"""
import io
import re


def extract(filename, data):
    """回傳 (文字, 警告訊息或空字串)。"""
    ext = filename.lower().rsplit(".", 1)[-1]
    warn = ""
    if ext == "pdf":
        import pymupdf
        doc = pymupdf.open(stream=data, filetype="pdf")
        pages = [p.get_text() for p in doc]
        text = "\n".join(f"【第 {i} 頁】\n{t}" for i, t in enumerate(pages, 1))
        if sum(len(t.strip()) for t in pages) < 30 * max(1, len(pages)):
            warn = "這份 PDF 幾乎讀不到文字，可能是掃描檔。請改傳可以選取文字的 PDF 或 Word 檔。"
    elif ext == "docx":
        text = _docx(data)
    elif ext in ("txt", "md"):
        text = _decode(data)
    else:
        raise ValueError("只支援 PDF、Word（.docx）、Markdown（.md）、純文字（.txt）。")
    text = re.sub(r"[ \t　]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise ValueError("這個檔案讀不到任何文字。")
    return scrub(text), warn


def _docx(data):
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = docx.Document(io.BytesIO(data))
    out = []
    for el in d.element.body.iterchildren():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            out.append(Paragraph(el, d).text)
        elif tag == "tbl":
            for row in Table(el, d).rows:
                out.append(" | ".join(c.text.strip() for c in row.cells))
    return "\n".join(out)


def _decode(data):
    for enc in ("utf-8-sig", "cp950", "big5"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", errors="replace")


def scrub(text):
    text = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "〔已遮蔽 Email〕", text)
    text = re.sub(r"(?<!\d)(\+886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)", "〔已遮蔽電話〕", text)
    text = re.sub(r"(?<![\d.])\(?0\d{1,2}\)?[- ]\d{3,4}[- ]?\d{4}(?!\d)", "〔已遮蔽電話〕", text)
    text = re.sub(r"(?<![A-Za-z0-9])[A-Z][12]\d{8}(?!\d)", "〔已遮蔽身分證字號〕", text)
    return text
