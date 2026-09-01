// Wodify 的 Description/Comment 字段是富文本 HTML（<p><span style="...">...），
// 一个字段里经常塞了好几段（多个 <p>）。之前直接把这些原文塞进编辑器，
// 用户看到的是一堆标签，没法读也没法改；改用 textContent 抽纯文本又会把
// 相邻的 <p> 粘成一整行没有空格（"General Warm-Up1:30 Row"）——先把块级
// 标签的收尾换成换行，再抽文本，得到的才是像样的多行内容。
export function stripHtml(html) {
  if (!html) return "";
  const withBreaks = html.replace(/<\/(p|div|li)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  const div = document.createElement("div");
  div.innerHTML = withBreaks;
  return div.textContent || "";
}

// 把一个 section 的 lines 数组（每项可能是一整块带多段 <p> 的 HTML）展开
// 成干净的、一行一句的纯文本数组，方便直接显示/编辑。
export function cleanLines(rawLines) {
  return (rawLines || [])
    .flatMap((raw) => stripHtml(raw).split("\n"))
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}
