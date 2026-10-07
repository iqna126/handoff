// 待办勾选框的写入+失败回滚逻辑，今日 tab（无删除按钮）和待办 tab（带
// 删除按钮）共用，两边的行结构不一样，所以只抽这一段，不抽整行渲染。
import { setTodoDone } from "./data.js";
import { showAlert } from "./dialog.js";

export function bindTodoCheckbox(checkbox, todo, onChange) {
  checkbox.addEventListener("change", async () => {
    const next = checkbox.checked;
    checkbox.disabled = true;
    try {
      await setTodoDone(todo.id, next);
      await onChange();
    } catch (err) {
      // 写失败不吭声的话，用户会看到"勾上了"但下次打开其实没存住——见
      // data.js 里 run() 的说明。这里把 checkbox 复位回写之前的状态，
      // 让界面跟数据库保持一致，而不是让一个假的勾选状态留在屏幕上
      checkbox.checked = !next;
      checkbox.disabled = false;
      await showAlert(`保存失败：${err.message}`);
    }
  });
}
