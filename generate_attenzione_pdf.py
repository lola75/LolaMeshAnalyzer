from pathlib import Path

MD_FILE = Path("ATTENZIONE.md")
PDF_FILE = Path("ATTENZIONE.pdf")
FONT_SIZE = 10
LINE_HEIGHT = 12
PAGE_WIDTH = 595
PAGE_HEIGHT = 842
LEFT_MARGIN = 40
TOP_MARGIN = 820
MAX_LINES_PER_PAGE = 64


def escape_text(line: str) -> str:
    return line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def build_page_content(lines: list[str]) -> str:
    content = ["BT", f"/F1 {FONT_SIZE} Tf", f"{LEFT_MARGIN} {TOP_MARGIN} Td"]
    for line in lines:
        safe = escape_text(line)
        content.append(f"({safe}) Tj")
        content.append(f"0 -{LINE_HEIGHT} Td")
    content.append("ET")
    return "\n".join(content)


def create_pdf_from_lines(lines: list[str]) -> bytearray:
    pages = [lines[i:i + MAX_LINES_PER_PAGE] for i in range(0, len(lines), MAX_LINES_PER_PAGE)]
    objects: list[str] = []
    content_objects: list[str] = []
    page_refs: list[str] = []

    for index, page_lines in enumerate(pages, start=1):
        page_content = build_page_content(page_lines)
        content_obj_id = 3 + 2 * (index - 1)
        page_obj_id = content_obj_id + 1

        content_objects.append(
            f"{content_obj_id} 0 obj\n<< /Length {len(page_content.encode('latin1'))} >>\nstream\n{page_content}\nendstream\nendobj\n"
        )
        page_refs.append(
            f"{page_obj_id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] /Contents {content_obj_id} 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
        )

    objects.append("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(
        "2 0 obj\n<< /Type /Pages /Kids [" + " ".join(f"{3 + 2 * (i - 1) + 1} 0 R" for i in range(len(pages))) + f" ] /Count {len(pages)} >>\nendobj\n"
    )
    objects.extend(content_objects)
    objects.extend(page_refs)
    objects.append(
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    )

    buf = bytearray()
    buf.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    positions = []
    for obj in objects:
        positions.append(len(buf))
        buf.extend(obj.encode("latin1"))

    xref_start = len(buf)
    buf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("latin1"))
    for pos in positions:
        buf.extend(f"{pos:010d} 00000 n \n".encode("latin1"))
    buf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode("latin1")
    )
    return buf


def main() -> None:
    lines = MD_FILE.read_text(encoding="utf-8").splitlines()
    pdf_data = create_pdf_from_lines(lines)
    PDF_FILE.write_bytes(pdf_data)
    print(f"Generated {PDF_FILE}")


if __name__ == "__main__":
    main()
