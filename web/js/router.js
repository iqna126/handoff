// hash 路由 + 底部 tab 导航。没有构建步骤，用最简单的方式做页面切换。
import * as today from "./pages/today.js";
import * as todos from "./pages/todos.js";
import * as ideas from "./pages/ideas.js";
import * as stub from "./pages/stub.js";

const TABS = [
  { hash: "today", label: "今日", render: (el) => today.render(el) },
  { hash: "todos", label: "待办", render: (el) => todos.render(el) },
  { hash: "ideas", label: "想法", render: (el) => ideas.render(el) },
  { hash: "train", label: "训练", render: (el) => stub.render(el, "训练") },
  { hash: "pr", label: "PR 墙", render: (el) => stub.render(el, "PR 墙") },
  { hash: "skills", label: "技能树", render: (el) => stub.render(el, "技能树") },
  { hash: "profile", label: "我的", render: (el) => stub.render(el, "我的") },
];

export function initRouter(navEl, mainEl) {
  navEl.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("a");
    btn.href = `#${tab.hash}`;
    btn.className = "nav-tab";
    btn.textContent = tab.label;
    navEl.appendChild(btn);
  }

  // 每次渲染发一个自增的 token，异步渲染完成时核对 token 还是不是当前这次——
  // 快速切换 tab 时，前一个 tab 的异步数据不会在切完之后才姗姗来迟地把内容画上去
  let renderToken = 0;

  async function paint() {
    const hash = (location.hash || `#${TABS[0].hash}`).slice(1);
    const tab = TABS.find((t) => t.hash === hash) || TABS[0];
    navEl.querySelectorAll(".nav-tab").forEach((el) => {
      el.classList.toggle("nav-tab--active", el.getAttribute("href") === `#${tab.hash}`);
    });

    const myToken = ++renderToken;
    mainEl.innerHTML = "";
    try {
      await tab.render(mainEl);
    } catch (err) {
      if (myToken === renderToken) {
        mainEl.innerHTML = `<p class="error-hint">加载失败：${err.message}</p>`;
      }
      return;
    }
    if (myToken !== renderToken) return; // 用户已经切到别的 tab 了，这次渲染作废
  }

  window.addEventListener("hashchange", paint);
  paint();
}
