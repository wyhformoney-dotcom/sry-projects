(function (root) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = value => {
    try { const u = new URL(value, 'https://srygamehub.com'); return ['http:', 'https:'].includes(u.protocol) ? escape(value) : ''; }
    catch { return ''; }
  };
  function inline(text) {
    // Escape source before adding our own markup. Links cannot contain markup.
    const tokens = [];
    const protectedText = text.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (_, label, url) => {
      const href = safeUrl(url);
      tokens.push(href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : escape(label));
      return `\u0000${tokens.length - 1}\u0000`;
    });
    return escape(protectedText).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[i] || '');
  }
  function render(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = []; let paragraph = [], list = [], listType = '';
    const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; };
    const flushList = () => { if (list.length) blocks.push(`<${listType}>${list.map(x => `<li>${inline(x)}</li>`).join('')}</${listType}>`); list = []; listType = ''; };
    for (const line of lines) {
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      const item = line.match(/^\s*(?:[-*·]\s+|\d+[.)]\s+)(.+)$/);
      const image = line.match(/^!\[([^\]]*)\]\(([^\s)]+)\)\s*$/);
      if (!line.trim()) { flushParagraph(); flushList(); continue; }
      if (item) {
        flushParagraph(); const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (listType && listType !== type) flushList(); listType = type; list.push(item[1]); continue;
      }
      flushList();
      if (heading) { flushParagraph(); const tag = line.startsWith('###') ? 'h3' : 'h2'; blocks.push(`<${tag}>${inline(heading[1])}</${tag}>`); }
      else if (image) { flushParagraph(); const src = safeUrl(image[2]); if (src) blocks.push(`<figure><img src="${src}" alt="${escape(image[1])}" loading="lazy">${image[1] ? `<figcaption>${escape(image[1])}</figcaption>` : ''}</figure>`); }
      else if (/^>\s?/.test(line)) { flushParagraph(); blocks.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
      else if (/^\s*---+\s*$/.test(line)) { flushParagraph(); blocks.push('<hr>'); }
      else paragraph.push(line);
    }
    flushParagraph(); flushList(); return blocks.join('');
  }
  root.SryDescription = { render };
})(globalThis);
