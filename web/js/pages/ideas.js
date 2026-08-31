// 想法 tab（SPEC.md §3）：纯时间流，最新在前，删除二次确认。
import { listIdeas, addIdea, deleteIdea } from "../data.js";
import { formatReadableDateTime, todayStr } from "../dateutils.js";

export async function render(container) {
  container.innerHTML = `
    <form class="idea-form">
      <input type="text" class="idea-input" placeholder="有什么想法？" required />
      <button type="submit">保存</button>
    </form>
    <ul class="idea-list"></ul>
  `;

  const form = container.querySelector(".idea-form");
  const input = container.querySelector(".idea-input");
  const list = container.querySelector(".idea-list");

  async function refresh() {
    const ideas = await listIdeas();
    list.innerHTML = "";
    for (const idea of ideas) {
      list.appendChild(renderIdeaRow(idea, refresh));
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    await addIdea({ text, day: todayStr() });
    input.value = "";
    await refresh();
  });

  await refresh();
}

function renderIdeaRow(idea, onChange) {
  const li = document.createElement("li");
  li.className = "idea-row";

  const time = document.createElement("span");
  time.className = "idea-row__time";
  time.textContent = formatReadableDateTime(idea.created_at);

  const text = document.createElement("p");
  text.className = "idea-row__text";
  text.textContent = idea.text;

  const del = document.createElement("button");
  del.type = "button";
  del.className = "idea-row__delete";
  del.textContent = "删除";
  del.addEventListener("click", async () => {
    if (!confirm("删除这条想法？")) return;
    await deleteIdea(idea.id);
    await onChange();
  });

  li.append(time, text, del);
  return li;
}
