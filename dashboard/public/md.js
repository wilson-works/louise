// md.js: turns a research file's markdown into safe HTML for Louise's open book.
//
// Contract: escape everything first, then add back a small set of formatting: headings, paragraphs, lists (nested by
// indent), block quotes, fenced code, inline code, bold, italic, strike, rules, simple pipe tables and links. Raw HTML in
// a file is shown as text, never run. A link becomes a link only when it is http, https or mailto; it opens in a new tab
// with rel="noopener noreferrer". Images are shown as their alt text (nothing is loaded from elsewhere). Headings start at
// level 3, because the book's own title is the dialog heading. Works in the browser (window.LouiseMd) and in Node
// (module.exports), so tests can check it without a browser.
(function (root) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const unescape = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);

  // A URL taken from already-escaped text. Returns the escaped href when it is safe, else null.
  function safeHref(escapedUrl) {
    const raw = unescape(escapedUrl).replace(/[\u0000-\u001F\u007F\s]+/g, '');
    if (!/^(https?:\/\/|mailto:)/i.test(raw)) return null;
    return escape(raw);
  }
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

  // Inline formatting on one escaped line. Code spans and links are set aside first so nothing inside them is touched.
  function inline(text) {
    const kept = [];
    const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
    let s = text;
    s = s.replace(/`([^`]+)`/g, (m, c) => keep(`<code>${c}</code>`));
    s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, (m, alt) => alt);
    s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, url) => {
      const href = safeHref(url);
      return href ? keep(link(href, label)) : label;
    });
    s = s.replace(/&lt;((?:https?:\/\/|mailto:)[^\s&]+(?:&amp;[^\s&]+)*)&gt;/gi, (m, url) => {
      const href = safeHref(url);
      return href ? keep(link(href, url)) : m;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s\u0000])+)/gi, (m, pre, found) => {
      const url = found.replace(/[.,;:!?)]+$/, '');
      const href = safeHref(url);
      return href ? pre + keep(link(href, url)) + found.slice(url.length) : m;
    });
    s = s.replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\W)__(?=\S)([^_]*?\S)__(?=\W|$)/g, '$1<strong>$2</strong>');
    s = s.replace(/\*(?=\S)([^*]*?\S)\*/g, '<em>$1</em>');
    s = s.replace(/(^|\W)_(?=\S)([^_]*?\S)_(?=\W|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)([^~]*?\S)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[Number(i)]);
  }

  const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
  const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const FENCE = /^ {0,3}(```|~~~)/;
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const QUOTE = /^ {0,3}&gt;\s?(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  // Lists: items nest by indent; a line indented under an item continues it.
  function list(lines, i) {
    const out = [];
    const stack = [];
    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(ITEM);
      if (!m) {
        if (line.trim() && stack.length && /^\s+\S/.test(line)) { out.push(' ' + inline(line.trim())); i++; continue; }
        break;
      }
      const indent = m[1].replace(/\t/g, '    ').length;
      const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      while (stack.length && indent < stack[stack.length - 1].indent) { out.push(`</li></${stack.pop().tag}>`); }
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) { stack.push({ indent, tag }); out.push(`<${tag}><li>`); }
      else { out.push('</li><li>'); }
      out.push(inline(m[3]));
      i++;
    }
    while (stack.length) out.push(`</li></${stack.pop().tag}>`);
    return { html: out.join(''), i };
  }

  function blocks(lines) {
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join(' ')}</p>`); para = []; } };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { flush(); i++; continue; }
      const fence = line.match(FENCE);
      if (fence) {
        flush();
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++;
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        continue;
      }
      const h = line.match(HEADING);
      if (h) { flush(); const level = Math.min(6, h[1].length + 2); out.push(`<h${level}>${inline(h[2])}</h${level}>`); i++; continue; }
      if (RULE.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (QUOTE.test(line)) {
        flush();
        const inner = [];
        while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].match(QUOTE)[1]);
        out.push(`<blockquote>${blocks(inner)}</blockquote>`);
        continue;
      }
      if (ITEM.test(line) && (!para.length || /^\s*([-*+]|1[.)])\s/.test(line))) {
        flush();
        const r = list(lines, i);
        out.push(r.html);
        i = r.i;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        flush();
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        const th = head.map((c) => `<th scope="col">${inline(c)}</th>`).join('');
        const tb = rows.map((r) => `<tr>${head.map((x, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('');
        out.push(`<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return out.join('\n');
  }

  function render(markdown) {
    const text = escape(String(markdown == null ? '' : markdown).replace(/\u0000/g, '').replace(/\r\n?/g, '\n'));
    return blocks(text.split('\n'));
  }

  const api = { render, escape };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LouiseMd = api;
})(typeof window !== 'undefined' ? window : this);
