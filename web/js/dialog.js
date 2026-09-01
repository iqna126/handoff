// 自定义弹层，替代浏览器原生 alert/confirm/prompt——那三个样式没法定制、
// 跟系统/浏览器语言绑定、也不跟随整体视觉风格，用户明确要求换成页面内弹层。
//
// 布局踩坑参考 SPEC.md §9.1：屏幕居中而不是贴底对齐（不依赖安全区/键盘
// 状态，移动端不容易碎）；不用 inset:0 配合 JS 设 height；类名统一加
// hf-dialog 前缀避免跟别的组件撞车；打开时锁定背景滚动、关闭时按原位置
// 恢复；遮罩层本身可以整体滚动，内容不做 max-height 裁切。

let openCount = 0;
let savedScrollY = 0;

function lockScroll() {
  if (openCount === 0) {
    savedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
  }
  openCount++;
}

function unlockScroll() {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    window.scrollTo(0, savedScrollY);
  }
}

function openDialog({ message, buttons, input }) {
  return new Promise((resolve) => {
    lockScroll();
    const overlay = document.createElement("div");
    overlay.className = "hf-dialog-overlay";
    const box = document.createElement("div");
    box.className = "hf-dialog-box";

    const msg = document.createElement("p");
    msg.className = "hf-dialog-message";
    msg.textContent = message;
    box.appendChild(msg);

    let inputEl = null;
    if (input) {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "hf-dialog-input";
      inputEl.placeholder = input.placeholder || "";
      inputEl.value = input.value || "";
      box.appendChild(inputEl);
    }

    function close(value) {
      unlockScroll();
      overlay.remove();
      resolve(value);
    }

    const actions = document.createElement("div");
    actions.className = "hf-dialog-actions";
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hf-dialog-btn" + (b.primary ? " hf-dialog-btn--primary" : "");
      btn.textContent = b.label;
      btn.addEventListener("click", () => {
        close(b.fromInput ? (inputEl ? inputEl.value.trim() : true) : b.value);
      });
      actions.appendChild(btn);
    }
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    if (inputEl) {
      inputEl.focus();
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") close(inputEl.value.trim());
      });
    }
  });
}

export function showAlert(message) {
  return openDialog({ message, buttons: [{ label: "好", value: true, primary: true }] });
}

export function showConfirm(message) {
  return openDialog({
    message,
    buttons: [
      { label: "取消", value: false },
      { label: "确定", value: true, primary: true },
    ],
  });
}

// 返回值：确定且有内容 → 字符串；取消 / 确定但留空 → null
export function showPrompt(message, { placeholder = "", value = "" } = {}) {
  return openDialog({
    message,
    input: { placeholder, value },
    buttons: [
      { label: "取消", value: null },
      { label: "确定", fromInput: true, primary: true },
    ],
  }).then((v) => (v ? v : null));
}
