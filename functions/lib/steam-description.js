// Keep useful structure from Steam without accepting its HTML as site markup.
export const steamDescription = html => String(html || '')
  .replace(/<h[1-3][^>]*>/gi, '\n\n## ').replace(/<\/h[1-3]>/gi, '\n\n')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
  .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '\n')
  .replace(/<\/(?:ul|ol)>/gi, '\n\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n').trim();
