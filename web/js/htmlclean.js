// Wodify 的 Description/Comment 字段是富文本 HTML（<p><span style="...">...），
// 一个字段里经常塞了好几段（多个 <p>）。之前直接把这些原文塞进编辑器，
// 用户看到的是一堆标签，没法读也没法改；改用 textContent 抽纯文本又会把
// 相邻的 <p> 粘成一整行没有空格（"General Warm-Up1:30 Row"）——先把块级
// 标签的收尾换成换行，再抽文本，得到的才是像样的多行内容。
export function stripHtml(html) {
  if (!html) return "";
  const withBreaks = html.replace(/<\/(p|div|li)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  // DOMParser 产生的 document 不挂在当前页面上，不会加载图片/执行内联事件——
  // 用普通 document.createElement("div") 的话，即使这个 div 从没插入页面，
  // 里面的 <img onerror=...> 一样会触发，等于白做了"防 XSS"这件事。
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return doc.body.textContent || "";
}

// Wodify 返回的标题类字段（section.title、scaling 档位名）理论上应该是纯文本，
// 但来源和 Description/Comment 是同一个 API，不能假设它永远不含尖括号——
// 插进 innerHTML 模板前转义一下。
export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// 把一个 section 的 lines 数组（每项可能是一整块带多段 <p> 的 HTML）展开
// 成干净的、一行一句的纯文本数组，方便直接显示/编辑。
export function cleanLines(rawLines) {
  return (rawLines || [])
    .flatMap((raw) => stripHtml(raw).split("\n"))
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}
