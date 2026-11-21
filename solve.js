// Fast drop-in for csv-reader 1.0.0 (make.fun): same answers, faster.
// Strategy: jump with indexOf to the next special character (comma, LF, CR,
// quote) and take whole field runs with slice(), instead of stepping through
// the text one character at a time and concatenating per character.
// Only erasable, dependency-free ES module code; no network, no WASM.

/** How a field ended: 0 = comma (record goes on), 1 = line break, 2 = end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1; // drop a U+FEFF at the very start

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Registers for the field just read (avoids allocating a result object per field).
  let fVal = '';
  let fEnd = END;
  let fAdded = 0;

  // Reads unquoted characters onto `init` (null: start empty) up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fVal, fEnd, fAdded (characters kept).
  // The CR check is bounded to the field's own span (a slice of it), so a text
  // with no CRs never pays a scan to the end of the file for one.
  function readUnquoted(init) {
    let val = init;
    let added = 0;
    let p = pos;
    for (;;) {
      const ci = text.indexOf(',', p);
      const ni = text.indexOf('\n', p);
      let m = -1;
      let kind = -1;
      if (ci !== -1) { m = ci; kind = 0; }
      if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = 1; }
      if (m === -1) {
        // The field runs to the end of the text.
        const span = text.slice(p, n);
        if (span.indexOf('\r') === -1) {
          if (span.length > 0) {
            val = val === null ? span : val + span;
            added += span.length;
          }
          pos = n;
          fEnd = END;
          break;
        }
        // Rare: stray CRs in the final field; drop them one by one.
        let p2 = p;
        for (;;) {
          const ri = text.indexOf('\r', p2);
          if (ri === -1) {
            if (p2 < n) {
              const seg = text.slice(p2, n);
              val = val === null ? seg : val + seg;
              added += n - p2;
            }
            pos = n;
            fEnd = END;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (ri > p2) {
            const seg = text.slice(p2, ri);
            val = val === null ? seg : val + seg;
            added += ri - p2;
          }
          p2 = ri + 1;
        }
        break;
      }
      // The field's content is [p, end): a CR just before a LF ending is the CRLF pair, not content.
      let end = m;
      if (kind === 1 && m > p && text.charCodeAt(m - 1) === 13) end = m - 1;
      const span = text.slice(p, end);
      if (span.indexOf('\r') === -1) {
        if (span.length > 0) {
          val = val === null ? span : val + span;
          added += span.length;
        }
      } else {
        // Rare: stray CRs inside the field; scan only this short span, dropping them.
        let start = p;
        for (let k = p; k < end; k++) {
          if (text.charCodeAt(k) === 13) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            if (k > start) {
              const seg = text.slice(start, k);
              val = val === null ? seg : val + seg;
              added += k - start;
            }
            start = k + 1;
          }
        }
        if (start < end) {
          const seg = text.slice(start, end);
          val = val === null ? seg : val + seg;
          added += end - start;
        }
      }
      if (kind === 0) {
        pos = m + 1;
        fEnd = COMMA;
      } else {
        pos = m + 1;
        line += 1;
        fEnd = LINE_BREAK;
      }
      break;
    }
    fVal = val === null ? '' : val;
    fAdded = added;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal and fEnd.
  // The CR check is bounded to the current span (a slice of it), so a text
  // with no CRs never pays a scan to the end of the file for one.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let p = pos + 1;
    let parts = null; // pieces only when the field holds a doubled quote or a line break
    // Appends text[s, e) to parts with every CR read as one LF (a CR is never
    // followed by LF inside this span: a following LF would be the next break).
    function pushSpan(s, e) {
      let start = s;
      for (let k = s; k < e; k++) {
        if (text.charCodeAt(k) === 13) {
          if (k > start) parts.push(text.slice(start, k));
          parts.push('\n');
          line += 1;
          start = k + 1;
        }
      }
      if (start < e) parts.push(text.slice(start, e));
    }
    for (;;) {
      const qi = text.indexOf('"', p);
      const ni = text.indexOf('\n', p);
      let m = -1;
      let kind = -1;
      if (qi !== -1) { m = qi; kind = 0; }
      if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = 1; }
      if (m === -1) break; // no closing quote anywhere ahead: unterminated
      if (kind === 0) {
        if (text.charCodeAt(m + 1) === 34) {
          // Doubled quote: one quote character.
          if (parts === null) parts = [];
          const span = text.slice(p, m);
          if (span.indexOf('\r') === -1) {
            if (span.length > 0) parts.push(span);
          } else {
            pushSpan(p, m);
          }
          parts.push('"');
          p = m + 2;
          continue;
        }
        // Closing quote at m.
        const span = text.slice(p, m);
        if (span.indexOf('\r') === -1) {
          if (parts === null) {
            fVal = span;
          } else {
            if (span.length > 0) parts.push(span);
            fVal = parts.join('');
          }
        } else {
          if (parts === null) parts = [];
          pushSpan(p, m);
          fVal = parts.join('');
        }
        pos = m + 1;
        if (pos >= n) {
          fEnd = END;
          return;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fEnd = COMMA;
          return;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fEnd = LINE_BREAK;
          return;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fEnd = LINE_BREAK;
          return;
        }
        // What follows the closing quote is appended as it stands, up to the
        // next comma or line break.
        readUnquoted(fVal);
        if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      // A line break at m is the next special; the span [p, m) may hold CRs.
      const span = text.slice(p, m);
      if (parts === null) parts = [];
      if (span.indexOf('\r') === -1) {
        if (span.length > 0) parts.push(span);
        parts.push('\n');
        line += 1;
      } else {
        // CRLF and a lone CR inside quotes are each one LF.
        pushSpan(p, m);
        if (!(m > p && text.charCodeAt(m - 1) === 13)) {
          parts.push('\n');
          line += 1;
        }
      }
      p = m + 1;
    }
    // The quote never closes: it is a literal character, and the text after it
    // is read again as unquoted (line counter reset to where the quote opened).
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    readUnquoted('"');
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields;
    let quoted = false;
    // Fast path: a record whose first line holds no quote cannot span lines, so
    // the whole line is plain fields. (The quote check is bounded to this line
    // by slicing it first, so a quote far ahead in the text costs nothing.)
    const lineEnd = text.indexOf('\n', pos);
    const segEnd = lineEnd === -1 ? n : lineEnd;
    if (text.slice(pos, segEnd).indexOf('"') === -1) {
      let s = text.slice(pos, segEnd);
      const hasBreak = lineEnd !== -1;
      if (hasBreak && s.length > 0 && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1); // CRLF ending
      if (s.indexOf('\r') === -1) {
        fields = s.split(',');
      } else {
        fields = [];
        const raw = s.split(',');
        for (let i = 0; i < raw.length; i++) {
          const f = raw[i];
          if (f.indexOf('\r') === -1) {
            fields.push(f);
            continue;
          }
          let out = '';
          let start = 0;
          for (let j = 0; j < f.length; j++) {
            if (f.charCodeAt(j) === 13) {
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              out += f.slice(start, j);
              start = j + 1;
            }
          }
          fields.push(out + f.slice(start));
        }
      }
      if (hasBreak) {
        pos = lineEnd + 1;
        line += 1;
      } else {
        pos = n;
      }
    } else {
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted();
        else readUnquoted(null);
        fields.push(fVal);
      } while (fEnd === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
