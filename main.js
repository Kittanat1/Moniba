const currentMonth = new Date().toISOString().slice(0, 7);

const state = {
  lineUserId: localStorage.getItem("monibaLineUserId") || "test-001",
  selectedMonth: localStorage.getItem("monibaSelectedMonth") || currentMonth,
  user: null,
  transactions: [],
  bnplItems: [],
  summary: {
    total_income: 0,
    total_expense: 0,
    balance: 0,
  },
  chart: null,
};

const baht = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatMonth(value) {
  const monthValue = value || currentMonth;
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${monthValue}-01T00:00:00`));
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "เชื่อมต่อ API ไม่สำเร็จ");
  }
  return data;
}

async function ensureUser() {
  const response = await apiFetch("/api/users", {
    method: "POST",
    body: JSON.stringify({
      line_user_id: state.lineUserId,
      display_name: state.lineUserId === "test-001" ? "ผู้ใช้ทดสอบ" : "LINE User",
    }),
  });
  state.user = response.user;
  $("bnplLimitInput").value = Math.round(Number(state.user.bnpl_limit || 40000));
}

function activeQuery() {
  const params = new URLSearchParams({ line_user_id: state.lineUserId });
  params.set("month", state.selectedMonth || currentMonth);
  if ($("filterCategory").value.trim()) params.set("category", $("filterCategory").value.trim());
  return params;
}

function syncMonthLabel() {
  $("currentMonthLabel").textContent = formatMonth(state.selectedMonth);
  $("filterMonth").value = state.selectedMonth;
  localStorage.setItem("monibaSelectedMonth", state.selectedMonth);
}

async function refreshAll() {
  localStorage.setItem("monibaLineUserId", state.lineUserId);
  syncMonthLabel();
  await ensureUser();
  await Promise.all([loadTransactions(), loadBnplList(), loadCategoryChart()]);
  renderAlerts();
}

async function loadTransactions() {
  const data = await apiFetch(`/api/transactions?${activeQuery().toString()}`);
  state.transactions = data.items || [];
  state.summary = data.summary || state.summary;
  renderSummary();
  renderTransactions(state.transactions, $("txList"));
  renderTransactions(state.transactions, $("reportList"));
}

async function loadBnplList() {
  const data = await apiFetch(`/api/bnpl?line_user_id=${encodeURIComponent(state.lineUserId)}`);
  state.bnplItems = data.items || [];
  renderBnplList();
  renderSummary();
  renderAlerts();
}

async function loadCategoryChart() {
  if (typeof Chart === "undefined") return;
  const params = new URLSearchParams({
    line_user_id: state.lineUserId,
    month: state.selectedMonth || currentMonth,
  });
  const data = await apiFetch(`/api/transactions/summary-by-category?${params.toString()}`);
  renderCategoryChart(data.categories || [], data.totals || []);
}

function getBnplOutstanding() {
  return state.bnplItems.reduce((sum, item) => {
    const totalAmount = Number(item.total_amount || 0);
    const paidAmount = Number(item.installments_paid || 0) * Number(item.installment_amount || 0);
    return sum + Math.max(totalAmount - paidAmount, 0);
  }, 0);
}

function renderSummary() {
  const limit = Number(state.user?.bnpl_limit || $("bnplLimitInput").value || 0);
  const outstanding = getBnplOutstanding();
  const limitLeft = Math.max(limit - outstanding, 0);

  $("totalIncome").textContent = baht.format(state.summary.total_income || 0);
  $("totalExpense").textContent = baht.format(state.summary.total_expense || 0);
  $("balance").textContent = baht.format(state.summary.balance || 0);
  $("bnplRemaining").textContent = baht.format(limitLeft);
  $("bnplOutstanding").textContent = baht.format(outstanding);
}

function renderTransactions(items, container) {
  if (!items.length) {
    container.innerHTML = '<div class="empty">ยังไม่มีรายการในเดือนนี้</div>';
    return;
  }

  container.innerHTML = items.map((tx) => {
    const isIncome = tx.type === "income";
    const amountClass = isIncome ? "income" : "expense";
    const sign = isIncome ? "+" : "-";
    return `
      <article class="list-item">
        <div class="item-head">
          <div>
            <p class="item-title">${escapeHtml(tx.category || "ไม่ระบุหมวดหมู่")}</p>
            <p class="item-meta">${formatDate(tx.date)} · ${escapeHtml(tx.note || "ไม่มีโน้ต")}</p>
          </div>
          <div class="amount ${amountClass}">${sign}${baht.format(Number(tx.amount || 0))}</div>
        </div>
        <div class="actions">
          <button class="danger" type="button" data-delete-tx="${tx.id}">ลบ</button>
        </div>
      </article>
    `;
  }).join("");
}

function bnplStatus(item) {
  const total = Number(item.installments_total || 0);
  const paid = Number(item.installments_paid || 0);
  if (paid >= total) return { className: "done", label: "จ่ายครบแล้ว" };

  const due = new Date(`${item.due_date}T00:00:00`);
  const today = new Date(`${todayIso()}T00:00:00`);
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0) return { className: "late", label: `เลยกำหนด ${Math.abs(days)} วัน` };
  if (days <= 3) return { className: "due", label: `ครบกำหนดใน ${days} วัน` };
  return { className: "", label: `ครบกำหนด ${formatDate(item.due_date)}` };
}

function renderBnplList() {
  const container = $("bnplList");
  if (!state.bnplItems.length) {
    container.innerHTML = '<div class="empty">ยังไม่มีรายการ BNPL</div>';
    return;
  }

  container.innerHTML = state.bnplItems.map((item) => {
    const paid = Number(item.installments_paid || 0);
    const total = Number(item.installments_total || 0);
    const percent = total ? Math.min((paid / total) * 100, 100) : 0;
    const status = bnplStatus(item);
    const remaining = Math.max(Number(item.total_amount || 0) - paid * Number(item.installment_amount || 0), 0);

    return `
      <article class="list-item">
        <div class="item-head">
          <div>
            <p class="item-title">${escapeHtml(item.item_name)}</p>
            <p class="item-meta">${paid}/${total} งวด · งวดละ ${baht.format(Number(item.installment_amount || 0))} · เหลือ ${baht.format(remaining)}</p>
          </div>
          <span class="badge ${status.className}">${status.label}</span>
        </div>
        <div class="progress" aria-label="ความคืบหน้าการผ่อน">
          <span style="width: ${percent}%"></span>
        </div>
        <div class="actions">
          <button type="button" data-pay-bnpl="${item.id}" ${paid >= total ? "disabled" : ""}>จ่ายงวดนี้แล้ว</button>
          <button class="danger" type="button" data-delete-bnpl="${item.id}">ลบ</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderAlerts() {
  const alertItems = state.bnplItems
    .map((item) => ({ item, status: bnplStatus(item) }))
    .filter(({ status }) => ["due", "late"].includes(status.className));

  const container = $("alertList");
  if (!alertItems.length) {
    container.innerHTML = '<div class="empty">ยังไม่มีรายการที่ต้องแจ้งเตือนใน 3 วันข้างหน้า</div>';
    return;
  }

  container.innerHTML = alertItems.map(({ item, status }) => `
    <article class="list-item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(item.item_name)}</p>
          <p class="item-meta">ครบกำหนด ${formatDate(item.due_date)} · งวดละ ${baht.format(Number(item.installment_amount || 0))}</p>
        </div>
        <span class="badge ${status.className}">${status.label}</span>
      </div>
    </article>
  `).join("");
}

function renderCategoryChart(categories, totals) {
  const ctx = $("categoryChart");
  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: categories.length ? categories : ["ยังไม่มีรายจ่าย"],
      datasets: [{
        data: totals.length ? totals : [1],
        backgroundColor: ["#f3b3cc", "#fdf988", "#d8f4c8", "#ffdcd0", "#706b6b", "#e772a7"],
        borderWidth: 0,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
      },
      cutout: "62%",
    },
  });
}

async function addTransaction(event) {
  event.preventDefault();

  const transactionDate = $("txDate").value;

  await apiFetch("/api/transactions", {
    method: "POST",
    body: JSON.stringify({
      line_user_id: state.lineUserId,
      type: $("txType").value,
      amount: Number($("txAmount").value),
      category: $("txCategory").value.trim(),
      note: $("txNote").value.trim(),
      date: transactionDate,
    }),
  });

  state.selectedMonth = transactionDate.slice(0, 7) || state.selectedMonth;
  $("filterCategory").value = "";
  syncMonthLabel();

  event.currentTarget.reset();
  $("txDate").value = todayIso();

  await loadTransactions();
  await loadCategoryChart();

  showToast("บันทึกรายการแล้ว");
}

async function addBnplItem(event) {
  event.preventDefault();
  await apiFetch("/api/bnpl", {
    method: "POST",
    body: JSON.stringify({
      line_user_id: state.lineUserId,
      item_name: $("itemName").value.trim(),
      total_amount: Number($("totalAmount").value),
      installment_amount: Number($("installmentAmount").value),
      installments_total: Number($("installmentsTotal").value),
      due_date: $("dueDate").value,
    }),
  });
  event.currentTarget.reset();
  $("dueDate").value = todayIso();
  await loadBnplList();
  showToast("เพิ่มรายการ BNPL แล้ว");
}

async function saveBnplLimit() {
  const limit = Number($("bnplLimitInput").value || 0);
  const response = await apiFetch("/api/users", {
    method: "POST",
    body: JSON.stringify({
      line_user_id: state.lineUserId,
      display_name: state.user?.display_name || "LINE User",
      bnpl_limit: limit,
    }),
  });
  state.user = response.user;
  renderSummary();
  showToast("บันทึก LIMIT แล้ว");
}

async function payInstallment(itemId) {
  const item = state.bnplItems.find((candidate) => Number(candidate.id) === Number(itemId));
  if (!item) return;
  await apiFetch(`/api/bnpl/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({ installments_paid: Number(item.installments_paid || 0) + 1 }),
  });
  await loadBnplList();
  showToast("อัปเดตงวดที่จ่ายแล้ว");
}

async function deleteTransaction(transactionId) {
  if (!confirm("ต้องการลบรายการนี้ใช่ไหม?")) return;
  await apiFetch(`/api/transactions/${transactionId}`, { method: "DELETE" });
  await Promise.all([loadTransactions(), loadCategoryChart()]);
  showToast("ลบรายการแล้ว");
}

async function deleteBnpl(itemId) {
  if (!confirm("ต้องการลบรายการ BNPL นี้ใช่ไหม?")) return;
  await apiFetch(`/api/bnpl/${itemId}`, { method: "DELETE" });
  await loadBnplList();
  showToast("ลบรายการ BNPL แล้ว");
}

function bindEvents() {
  $("transactionForm").addEventListener("submit", (event) => addTransaction(event).catch(showToast));
  $("bnplForm").addEventListener("submit", (event) => addBnplItem(event).catch(showToast));
  $("bnplLimitInput").addEventListener("change", () => saveBnplLimit().catch(showToast));

  $("loadUserBtn").addEventListener("click", () => {
    state.lineUserId = $("lineUserId").value.trim() || "test-001";
    refreshAll().then(() => showToast("โหลดข้อมูลแล้ว")).catch(showToast);
  });

  $("filterBtn").addEventListener("click", () => {
    state.selectedMonth = $("filterMonth").value || currentMonth;
    syncMonthLabel();
    Promise.all([loadTransactions(), loadCategoryChart()]).catch(showToast);
  });

  $("filterMonth").addEventListener("change", () => {
    state.selectedMonth = $("filterMonth").value || currentMonth;
    syncMonthLabel();
    Promise.all([loadTransactions(), loadCategoryChart()]).catch(showToast);
  });

  $("clearFilterBtn").addEventListener("click", () => {
    state.selectedMonth = currentMonth;
    $("filterCategory").value = "";
    syncMonthLabel();
    Promise.all([loadTransactions(), loadCategoryChart()]).catch(showToast);
  });

  document.body.addEventListener("click", (event) => {
    const txId = event.target.dataset.deleteTx;
    const bnplId = event.target.dataset.deleteBnpl;
    const payId = event.target.dataset.payBnpl;
    if (txId) deleteTransaction(txId).catch(showToast);
    if (bnplId) deleteBnpl(bnplId).catch(showToast);
    if (payId) payInstallment(payId).catch(showToast);
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((candidate) => candidate.classList.remove("active"));
      tab.classList.add("active");
      ["transactions", "bnpl", "reports", "alerts"].forEach((name) => {
        $(`tab-${name}`).hidden = tab.dataset.tab !== name;
      });
    });
  });
}

function init() {
  $("lineUserId").value = state.lineUserId;
  $("txDate").value = todayIso();
  $("dueDate").value = todayIso();
  $("filterMonth").value = state.selectedMonth;
  syncMonthLabel();
  bindEvents();
  refreshAll().catch(showToast);
}

document.addEventListener("DOMContentLoaded", init);
