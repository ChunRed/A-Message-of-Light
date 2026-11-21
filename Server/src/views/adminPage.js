/**
 * Renders the self-contained HTML Admin Management Page for Light-msg Server.
 * Accessible via https://light-msg-server.nosidehere.space (GET / and GET /admin).
 */
export function renderAdminPageHtml({ requiresAdminToken }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>一則光的訊息｜郵筒圖片管理後台</title>
  <style>
    :root {
      --bg: #fcfbfa;
      --paper: #faf9f6;
      --ink: #222222;
      --muted: #7d7d7a;
      --line: #dcdcd7;
      --danger: #c84b31;
      --accent: #f3d98b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans TC", "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px 16px 64px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 16px;
      border-bottom: 1px dashed rgba(34, 34, 34, 0.22);
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      letter-spacing: 0.2em;
    }
    .brand p {
      margin: 4px 0 0;
      font-size: 11px;
      letter-spacing: 0.14em;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .token-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .token-bar input {
      height: 34px;
      padding: 0 12px;
      border: 1px solid var(--ink);
      border-radius: 999px;
      background: #ffffff;
      font-size: 12px;
      min-width: 210px;
      outline: none;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 28px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 11px;
      color: var(--muted);
      background: var(--paper);
    }
    .badge.ok { border-color: #4f8a5b; color: #2f663a; background: #f2faf3; }
    .badge.warn { border-color: #c84b31; color: #a53720; background: #fff4f2; }

    .mailbox-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 18px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px;
      border: 1px solid var(--ink);
      border-radius: 999px;
      background: #ffffff;
      color: var(--ink);
      font-size: 13px;
      letter-spacing: 0.1em;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .btn:hover:not(:disabled) { background: var(--paper); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.active {
      background: var(--ink);
      color: var(--paper);
    }
    .btn.danger {
      border-color: var(--danger);
      background: var(--danger);
      color: #ffffff;
    }
    .btn.danger:hover:not(:disabled) { background: #ad3d25; }
    .btn.subtle {
      border-color: rgba(34, 34, 34, 0.28);
      font-size: 12px;
      height: 34px;
      padding: 0 14px;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 16px;
      padding: 12px 16px;
      border: 1px solid var(--ink);
      border-radius: 14px;
      background: var(--paper);
    }
    .toolbar-left {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .current-mailbox-tag {
      font-weight: 600;
      letter-spacing: 0.12em;
    }
    .toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .status-banner {
      margin-top: 14px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #ffffff;
      font-size: 13px;
      display: none;
    }
    .status-banner.show { display: block; }
    .status-banner.success { border-color: #4f8a5b; background: #f2faf3; color: #24572e; }
    .status-banner.error { border-color: var(--danger); background: #fff4f2; color: #9c301a; }

    .grid {
      margin-top: 20px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    @media (min-width: 640px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (min-width: 900px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (min-width: 1120px) { .grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(34, 34, 34, 0.25);
      border-radius: 10px;
      background: #ffffff;
      padding: 8px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .card.selected {
      border-color: var(--ink);
      box-shadow: 0 0 0 2px rgba(34, 34, 34, 0.16);
      background: #fffdf5;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .check-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    }
    .check-label input[type="checkbox"] {
      width: 17px;
      height: 17px;
      cursor: pointer;
      accent-color: var(--ink);
    }
    .single-del {
      border: 1px solid rgba(200, 75, 49, 0.45);
      background: transparent;
      color: var(--danger);
      border-radius: 999px;
      padding: 2px 9px;
      font-size: 11px;
      cursor: pointer;
    }
    .single-del:hover { background: var(--danger); color: #ffffff; }
    .thumb-wrap {
      aspect-ratio: 3 / 4;
      width: 100%;
      background: var(--paper);
      border: 1px solid rgba(34, 34, 34, 0.1);
      overflow: hidden;
      cursor: zoom-in;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .thumb-wrap img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .meta {
      margin-top: 7px;
      font-size: 10.5px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .meta-key {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty {
      margin: 48px auto;
      max-width: 380px;
      text-align: center;
      padding: 28px 20px;
      border: 1px dashed rgba(34, 34, 34, 0.3);
      border-radius: 12px;
      background: var(--paper);
      color: var(--muted);
      font-size: 13px;
    }

    .load-more-wrap {
      margin-top: 26px;
      display: flex;
      justify-content: center;
    }

    .lightbox {
      position: fixed;
      inset: 0;
      background: rgba(11, 11, 13, 0.88);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 100;
    }
    .lightbox.open { display: flex; }
    .lightbox-inner {
      max-width: 680px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .lightbox img {
      max-width: 100%;
      max-height: 78vh;
      background: var(--paper);
      padding: 8px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <h1>一則光的訊息 · 郵筒管理後台</h1>
        <p>LIGHT-MSG ADMIN // CLOUDFLARE R2 + SUPABASE SYNC</p>
      </div>
      <div class="token-bar" id="tokenBar"></div>
    </header>

    <div class="mailbox-bar" id="mailboxBar" role="tablist" aria-label="郵筒選擇"></div>

    <div class="toolbar">
      <div class="toolbar-left">
        <span class="current-mailbox-tag" id="currentMailboxLabel">目前檢視：郵筒 #1</span>
        <span class="badge" id="countBadge">0 張圖片</span>
        <span class="badge" id="selectedBadge">已選取 0 張</span>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn subtle" id="toggleAllBtn">全選</button>
        <button type="button" class="btn subtle" id="refreshBtn">重新整理</button>
        <button type="button" class="btn danger" id="deleteSelectedBtn" disabled>刪除已選取項目</button>
      </div>
    </div>

    <div class="status-banner" id="statusBanner" role="status" aria-live="polite"></div>

    <div class="grid" id="imageGrid"></div>
    <div class="empty" id="emptyState" style="display:none;"></div>
    <div class="load-more-wrap" id="loadMoreWrap" style="display:none;">
      <button type="button" class="btn" id="loadMoreBtn">載入更多</button>
    </div>
  </div>

  <div class="lightbox" id="lightbox" role="dialog" aria-modal="true">
    <div class="lightbox-inner">
      <img id="lightboxImg" src="" alt="放大預覽" />
      <button type="button" class="btn" id="closeLightboxBtn">關閉預覽</button>
    </div>
  </div>

  <script>
    const REQUIRES_TOKEN = ${JSON.stringify(Boolean(requiresAdminToken))};
    const PAGE_LIMIT = 48;

    let currentMailbox = 1;
    let currentPage = 1;
    let hasMore = false;
    let items = [];
    let selectedIds = new Set();
    let adminToken = sessionStorage.getItem("light_msg_admin_token") || "";

    const mailboxBar = document.getElementById("mailboxBar");
    const tokenBar = document.getElementById("tokenBar");
    const currentMailboxLabel = document.getElementById("currentMailboxLabel");
    const countBadge = document.getElementById("countBadge");
    const selectedBadge = document.getElementById("selectedBadge");
    const toggleAllBtn = document.getElementById("toggleAllBtn");
    const refreshBtn = document.getElementById("refreshBtn");
    const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
    const statusBanner = document.getElementById("statusBanner");
    const imageGrid = document.getElementById("imageGrid");
    const emptyState = document.getElementById("emptyState");
    const loadMoreWrap = document.getElementById("loadMoreWrap");
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightboxImg");
    const closeLightboxBtn = document.getElementById("closeLightboxBtn");

    function showStatus(message, type) {
      statusBanner.textContent = message;
      statusBanner.className = "status-banner show " + (type || "");
    }

    function clearStatus() {
      statusBanner.className = "status-banner";
      statusBanner.textContent = "";
    }

    function formatDate(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return y + "." + m + "." + day + " " + hh + ":" + mm;
    }

    function renderTokenBar() {
      tokenBar.innerHTML = "";
      if (!REQUIRES_TOKEN) {
        const span = document.createElement("span");
        span.className = "badge ok";
        span.textContent = "直接操作模式（未設定 ADMIN_TOKEN）";
        tokenBar.appendChild(span);
        return;
      }

      const input = document.createElement("input");
      input.type = "password";
      input.placeholder = "輸入 ADMIN_TOKEN 以啟用刪除";
      input.value = adminToken;
      input.addEventListener("input", () => {
        adminToken = input.value.trim();
        sessionStorage.setItem("light_msg_admin_token", adminToken);
      });

      const verifyBtn = document.createElement("button");
      verifyBtn.type = "button";
      verifyBtn.className = "btn subtle";
      verifyBtn.textContent = "驗證權杖";

      const badge = document.createElement("span");
      badge.className = "badge " + (adminToken ? "" : "warn");
      badge.textContent = adminToken ? "已輸入權杖" : "需要 ADMIN_TOKEN";

      verifyBtn.addEventListener("click", async () => {
        if (!adminToken) {
          badge.className = "badge warn";
          badge.textContent = "請先輸入權杖";
          return;
        }
        try {
          const res = await fetch("/api/admin/check", {
            headers: { "X-Admin-Token": adminToken },
          });
          if (res.ok) {
            badge.className = "badge ok";
            badge.textContent = "權杖驗證通過";
            showStatus("ADMIN_TOKEN 驗證成功，可執行刪除操作。", "success");
          } else {
            badge.className = "badge warn";
            badge.textContent = "權杖無效";
            showStatus("ADMIN_TOKEN 驗證失敗，請確認內容是否正確。", "error");
          }
        } catch (err) {
          showStatus("驗證連線失敗：" + err.message, "error");
        }
      });

      tokenBar.append(input, verifyBtn, badge);
    }

    function renderMailboxButtons() {
      mailboxBar.innerHTML = "";
      for (let m = 1; m <= 6; m++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn" + (currentMailbox === m ? " active" : "");
        btn.textContent = "郵筒 " + m;
        btn.setAttribute("aria-pressed", String(currentMailbox === m));
        btn.addEventListener("click", () => {
          if (currentMailbox === m) return;
          currentMailbox = m;
          selectedIds.clear();
          renderMailboxButtons();
          loadMailboxImages(1, false);
        });
        mailboxBar.appendChild(btn);
      }
    }

    function updateSelectionUi() {
      currentMailboxLabel.textContent = "目前檢視：郵筒 #" + currentMailbox;
      countBadge.textContent = items.length + " 張圖片";
      selectedBadge.textContent = "已選取 " + selectedIds.size + " 張";
      deleteSelectedBtn.disabled = selectedIds.size === 0;
      const allSelected = items.length > 0 && selectedIds.size === items.length;
      toggleAllBtn.textContent = allSelected ? "取消全選" : "全選";
      toggleAllBtn.disabled = items.length === 0;
    }

    function renderGrid() {
      imageGrid.innerHTML = "";
      if (items.length === 0) {
        emptyState.style.display = "block";
        emptyState.textContent = "郵筒 #" + currentMailbox + " 目前沒有已存入的圖片。";
      } else {
        emptyState.style.display = "none";
      }

      for (const item of items) {
        const idStr = String(item.id);
        const isChecked = selectedIds.has(idStr);

        const card = document.createElement("div");
        card.className = "card" + (isChecked ? " selected" : "");
        card.dataset.id = idStr;

        const top = document.createElement("div");
        top.className = "card-top";

        const label = document.createElement("label");
        label.className = "check-label";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = isChecked;
        cb.addEventListener("change", () => {
          if (cb.checked) selectedIds.add(idStr);
          else selectedIds.delete(idStr);
          card.classList.toggle("selected", cb.checked);
          updateSelectionUi();
        });
        const idSpan = document.createElement("span");
        idSpan.textContent = "選取";
        label.append(cb, idSpan);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "single-del";
        delBtn.textContent = "刪除";
        delBtn.addEventListener("click", () => handleDeleteIds([item.id]));

        top.append(label, delBtn);

        const thumbWrap = document.createElement("div");
        thumbWrap.className = "thumb-wrap";
        thumbWrap.addEventListener("click", () => {
          lightboxImg.src = item.url;
          lightbox.classList.add("open");
        });

        const img = document.createElement("img");
        img.src = item.url;
        img.alt = "郵筒 #" + currentMailbox + " 圖片";
        img.loading = "lazy";
        thumbWrap.appendChild(img);

        const meta = document.createElement("div");
        meta.className = "meta";
        const timeDiv = document.createElement("div");
        timeDiv.textContent = formatDate(item.created_at) || "—";
        const keyDiv = document.createElement("div");
        keyDiv.className = "meta-key";
        keyDiv.title = item.key || item.url || "";
        keyDiv.textContent = item.key || item.url || "";
        meta.append(timeDiv, keyDiv);

        card.append(top, thumbWrap, meta);
        imageGrid.appendChild(card);
      }

      loadMoreWrap.style.display = hasMore ? "flex" : "none";
      updateSelectionUi();
    }

    async function loadMailboxImages(page, append) {
      clearStatus();
      if (!append) {
        imageGrid.innerHTML = "";
        emptyState.style.display = "block";
        emptyState.textContent = "正在載入郵筒 #" + currentMailbox + " 的圖片…";
      }
      loadMoreBtn.disabled = true;

      try {
        const res = await fetch(
          "/api/images?post=" + encodeURIComponent(currentMailbox) + "&page=" + page + "&limit=" + PAGE_LIMIT
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "載入失敗 (" + res.status + ")");
        }

        const fetched = Array.isArray(data.items) ? data.items : [];
        if (append) {
          const seen = new Set(items.map((x) => String(x.id)));
          for (const row of fetched) {
            if (!seen.has(String(row.id))) items.push(row);
          }
        } else {
          items = fetched;
        }
        currentPage = page;
        hasMore = fetched.length >= PAGE_LIMIT;
        renderGrid();
      } catch (err) {
        emptyState.style.display = "none";
        showStatus("載入郵筒 #" + currentMailbox + " 失敗：" + err.message, "error");
      } finally {
        loadMoreBtn.disabled = false;
      }
    }

    async function handleDeleteIds(rawIds) {
      if (!rawIds || rawIds.length === 0) return;

      if (REQUIRES_TOKEN && !adminToken) {
        showStatus("此伺服器已啟用 ADMIN_TOKEN，請先於上方輸入權杖再刪除。", "error");
        return;
      }

      const confirmed = window.confirm(
        "確定要刪除這 " +
          rawIds.length +
          " 張圖片嗎？\\n此操作將同時從 Cloudflare R2 與 Supabase 資料表永久移除，無法復原。"
      );
      if (!confirmed) return;

      deleteSelectedBtn.disabled = true;
      showStatus("正在刪除 " + rawIds.length + " 張圖片（R2 + Supabase）…", "");

      try {
        const headers = { "Content-Type": "application/json" };
        if (adminToken) headers["X-Admin-Token"] = adminToken;

        const res = await fetch("/api/images/delete", {
          method: "POST",
          headers,
          body: JSON.stringify({ ids: rawIds }),
        });
        const result = await res.json();
        if (!res.ok) {
          throw new Error(result.error || "刪除失敗 (" + res.status + ")");
        }

        const deletedSet = new Set((result.deletedIds || []).map(String));
        items = items.filter((item) => !deletedSet.has(String(item.id)));
        for (const id of deletedSet) {
          selectedIds.delete(id);
        }
        renderGrid();

        const failedCount = (result.failed || []).length;
        if (failedCount > 0) {
          showStatus(
            "已刪除 " + result.deletedCount + " 張圖片，另有 " + failedCount + " 張失敗。",
            "error"
          );
        } else {
          showStatus(
            "已成功刪除 " + result.deletedCount + " 張圖片（Cloudflare R2 與 Supabase 皆已移除）。",
            "success"
          );
        }
      } catch (err) {
        showStatus("刪除失敗：" + err.message, "error");
        updateSelectionUi();
      }
    }

    toggleAllBtn.addEventListener("click", () => {
      if (items.length === 0) return;
      if (selectedIds.size === items.length) {
        selectedIds.clear();
      } else {
        for (const item of items) selectedIds.add(String(item.id));
      }
      renderGrid();
    });

    refreshBtn.addEventListener("click", () => {
      selectedIds.clear();
      loadMailboxImages(1, false);
    });

    deleteSelectedBtn.addEventListener("click", () => {
      const idsToDelete = items
        .filter((item) => selectedIds.has(String(item.id)))
        .map((item) => item.id);
      handleDeleteIds(idsToDelete);
    });

    loadMoreBtn.addEventListener("click", () => {
      loadMailboxImages(currentPage + 1, true);
    });

    closeLightboxBtn.addEventListener("click", () => lightbox.classList.remove("open"));
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) lightbox.classList.remove("open");
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") lightbox.classList.remove("open");
    });

    renderTokenBar();
    renderMailboxButtons();
    loadMailboxImages(1, false);
  </script>
</body>
</html>`;
}
