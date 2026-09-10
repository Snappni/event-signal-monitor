const STORAGE_KEY = "event-signal-monitor.navigation-order.v1";

function routeKey(link) {
  const path = new URL(link.href, window.location.origin).pathname;
  return path === "/index.html" ? "/" : path;
}

function ensureFactorLibraryLink(toolbar) {
  if (toolbar.querySelector('a[href="/factors.html"]')) return;
  const link = document.createElement("a");
  link.className = "toolbar-link";
  link.href = "/factors.html";
  link.innerHTML = '<span aria-hidden="true">ƒ</span>因子库';
  if (window.location.pathname === "/factors.html") {
    link.classList.add("active");
    link.setAttribute("aria-current", "page");
  }
  toolbar.insertBefore(link, toolbar.querySelector(":scope > .nav-footer"));
}

function readSavedOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveOrder(toolbar) {
  const order = [...toolbar.querySelectorAll(":scope > .nav-reorder-item > .toolbar-link")].map(routeKey);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Navigation remains reorderable for this page when storage is unavailable.
  }
}

function applySavedOrder(toolbar) {
  const savedOrder = readSavedOrder();
  if (!savedOrder.length) return;
  const links = [...toolbar.querySelectorAll(":scope > .toolbar-link")];
  const positions = new Map(savedOrder.map((key, index) => [key, index]));
  links
    .map((link, index) => ({ link, index, position: positions.get(routeKey(link)) }))
    .sort((left, right) => {
      const leftPosition = left.position ?? savedOrder.length + left.index;
      const rightPosition = right.position ?? savedOrder.length + right.index;
      return leftPosition - rightPosition;
    })
    .forEach(({ link }) => toolbar.insertBefore(link, toolbar.querySelector(":scope > .nav-footer")));
}

function moveWithKeyboard(toolbar, link, direction) {
  const items = [...toolbar.querySelectorAll(":scope > .nav-reorder-item")];
  const item = link.closest(".nav-reorder-item");
  const index = items.indexOf(item);
  const target = items[index + direction];
  if (!target) return;
  if (direction < 0) toolbar.insertBefore(item, target);
  else toolbar.insertBefore(target, item);
  saveOrder(toolbar);
  item.querySelector(".nav-drag-handle")?.focus();
}

function createDragHandle(toolbar, link) {
  const item = document.createElement("div");
  item.className = "nav-reorder-item";
  link.before(item);
  item.append(link);

  const label = [...link.childNodes]
    .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    ?.textContent.trim() || link.textContent.trim();
  const handle = document.createElement("button");
  handle.className = "nav-drag-handle";
  handle.type = "button";
  handle.setAttribute("aria-label", `调整“${label}”的导航顺序`);
  handle.title = "拖动调整顺序；键盘可使用上下方向键";

  const icon = document.createElement("img");
  icon.src = "/vendor/heroicons/bars-3.svg";
  icon.alt = "";
  icon.draggable = false;
  handle.append(icon);

  handle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    moveWithKeyboard(toolbar, link, event.key === "ArrowUp" ? -1 : 1);
  });
  let mouseDragging = false;
  const finishMouseDrag = () => {
    if (!mouseDragging) return;
    item.classList.remove("nav-dragging");
    mouseDragging = false;
    saveOrder(toolbar);
  };
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    mouseDragging = true;
    item.classList.add("nav-dragging");
  });
  document.addEventListener("mousemove", (event) => {
    if (!mouseDragging) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".nav-reorder-item");
    if (!target || target === item || target.parentElement !== toolbar) return;
    const targetRect = target.getBoundingClientRect();
    if (event.clientY < targetRect.top + targetRect.height / 2) toolbar.insertBefore(item, target);
    else toolbar.insertBefore(item, target.nextSibling);
  });
  document.addEventListener("mouseup", finishMouseDrag);
  window.addEventListener("blur", finishMouseDrag);
  item.append(handle);
}

function initializeNavigationOrder() {
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar) return;
  ensureFactorLibraryLink(toolbar);
  applySavedOrder(toolbar);
  const links = [...toolbar.querySelectorAll(":scope > .toolbar-link")];
  links.forEach((link) => createDragHandle(toolbar, link));
}

initializeNavigationOrder();
