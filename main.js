const currentMonth = new Date().toISOString().slice(0, 7);

const state = {
  lineUserId: null,
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
  if (state.user && state.lineUserId && state.authSource === "manual") {
    return state.user;
  }

  if (state.user && state.lineUserId && state.authSource === "line") {
    return state.user;
  }

  if (typeof liff === "undefined" || !liff.getIDToken || !liff.getIDToken()) {
    throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");
  }

  const response = await apiFetch("/api/line/connect", {
    method: "POST",
    body: JSON.stringify({
      id_token: liff.getIDToken(),
    }),
  });

  applyAuthenticatedUser(response.user, "line");
  return state.user;
}

function setAuthMode(mode) {
  const isRegister = mode === "register";
  $("authTitle").textContent = isRegister ? "สมัครสมาชิก Moniba" : "เข้าสู่ระบบ Moniba";
  $("manualLoginForm").hidden = isRegister;
  $("manualRegisterForm").hidden = !isRegister;
  $("showRegisterBtn").hidden = isRegister;
}
function setAuthPanelVisible(visible) {
  const authPanel = $("authPanel");
  if (authPanel) authPanel.hidden = !visible;
  document.body.classList.toggle("signed-out", visible);
  document.body.classList.toggle("signed-in", !visible);
}

function applyAuthenticatedUser(user, source) {
  state.user = user;
  state.authSource = source;
  state.lineUserId = user.line_user_id;
  localStorage.setItem("monibaAuthUser", JSON.stringify({ user, source }));

  $("bnplLimitInput").value = Math.round(Number(user.bnpl_limit || 40000));
  $("lineUserId").value = user.line_user_id;
  $("profileName").textContent = user.display_name || user.username || "Moniba User";
  $("settingsProfileName").textContent = user.display_name || user.username || "Moniba User";
  $("settingsLineUserId").textContent = source === "line" ? user.line_user_id : `บัญชีสมัครเอง: ${user.username || "-"}`;

  const profilePicture = $("profilePicture");
  const settingsProfilePicture = $("settingsProfilePicture");
  if (user.picture_url) {
    profilePicture.src = user.picture_url;
    profilePicture.style.display = "block";
    settingsProfilePicture.src = user.picture_url;
  } else {
    profilePicture.removeAttribute("src");
    profilePicture.style.display = "none";
    settingsProfilePicture.removeAttribute("src");
  }

  $("loadUserBtn").textContent = "รีเฟรช";
  $("loadUserBtn").disabled = false;
  setAuthPanelVisible(false);
}

async function loginManualAccount(event) {
  event.preventDefault();
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value,
    }),
  });
  applyAuthenticatedUser(response.user, "manual");
  await refreshAll();
  showToast("ล็อกอินสำเร็จ");
}

async function registerManualAccount(event) {
  event.preventDefault();
  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;
  const confirmPassword = $("registerConfirmPassword").value;

  if (password !== confirmPassword) {
    showToast("รหัสผ่านยืนยันไม่ตรงกัน");
    return;
  }

  await apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      display_name: name,
      email,
      password,
      confirm_password: confirmPassword,
      bnpl_limit: $("bnplLimitInput").value || 40000,
    }),
  });

  $("loginEmail").value = email;
  $("loginPassword").value = "";
  $("manualRegisterForm").reset();
  setAuthMode("login");
  showToast("สมัครสมาชิกสำเร็จ กรุณาล็อกอินด้วยอีเมล");
}


async function loginGoogleAccount(credential) {
  const response = await apiFetch("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: credential }),
  });
  applyAuthenticatedUser(response.user, "google");
  await refreshAll();
  showToast("เข้าสู่ระบบด้วย Google สำเร็จ");
}

function setupGoogleLogin() {
  const clientId = document.body.dataset.googleClientId;
  const button = $("googleLoginBtn");

  if (!button) return;

  button.addEventListener("click", () => {
    if (!clientId) {
      showToast("ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID");
      return;
    }

    if (!window.google?.accounts?.id) {
      showToast("Google Sign-In ยังโหลดไม่เสร็จ");
      return;
    }

    google.accounts.id.prompt();
  });

  if (!clientId) return;

  const initializeGoogle = () => {
    if (!window.google?.accounts?.id) {
      window.setTimeout(initializeGoogle, 250);
      return;
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => loginGoogleAccount(response.credential).catch(showToast),
    });

    const mount = $("googleSignInMount");
    if (mount) {
      google.accounts.id.renderButton(mount, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "signin_with",
      });
    }
  };

  initializeGoogle();
}
function logout() {
  localStorage.removeItem("monibaAuthUser");
  state.user = null;
  state.authSource = null;
  state.lineUserId = null;
  state.transactions = [];
  state.bnplItems = [];
  state.summary = { total_income: 0, total_expense: 0, balance: 0 };
  $("lineUserId").value = "ยังไม่ได้เข้าสู่ระบบ";
  $("profileName").textContent = "ยังไม่ได้เข้าสู่ระบบ";
  $("settingsProfileName").textContent = "Moniba User";
  $("settingsLineUserId").textContent = "-";
  $("loadUserBtn").textContent = "รีเฟรช";
  $("loadUserBtn").disabled = true;
  renderSummary();
  renderTransactions([], $("txList"));
  renderTransactions([], $("reportList"));
  renderBnplList();
  renderAlerts();
  setAuthPanelVisible(true);
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


function renderOverview() {
  const container = $("overviewList");
  if (!container) return;

  const outstanding = getBnplOutstanding();
  const limit = Number(state.user?.bnpl_limit || $("bnplLimitInput").value || 0);
  const limitLeft = Math.max(limit - outstanding, 0);

  container.innerHTML = `
    <article class="list-item">
      <div class="item-head">
        <div>
          <p class="item-title">${formatMonth(state.selectedMonth)}</p>
          <p class="item-meta">รายรับ ${baht.format(state.summary.total_income || 0)} · รายจ่าย ${baht.format(state.summary.total_expense || 0)}</p>
          <p class="item-meta">หนี้ BNPL ${baht.format(outstanding)} · Limit เหลือ ${baht.format(limitLeft)}</p>
        </div>
        <div class="amount ${(state.summary.balance || 0) >= 0 ? "income" : "expense"}">${baht.format(state.summary.balance || 0)}</div>
      </div>
    </article>
  `;
}

function renderHealth() {
  const container = $("healthList");
  if (!container) return;

  const cashFlow = Number(state.summary.balance || 0);
  const outstanding = getBnplOutstanding();
  const netWorth = cashFlow - outstanding;
  const limit = Number(state.user?.bnpl_limit || $("bnplLimitInput").value || 0);
  const debtRatio = limit ? Math.min((outstanding / limit) * 100, 100) : 0;

  container.innerHTML = `
    <article class="list-item">
      <p class="item-title">ความมั่งคั่งสุทธิ</p>
      <div class="amount ${netWorth >= 0 ? "income" : "expense"}">${baht.format(netWorth)}</div>
      <p class="item-meta">ยอดคงเหลือรายเดือน ลบด้วยหนี้ BNPL ที่ยังค้าง</p>
    </article>
    <article class="list-item">
      <p class="item-title">กระแสเงินสดสุทธิ</p>
      <div class="amount ${cashFlow >= 0 ? "income" : "expense"}">${baht.format(cashFlow)}</div>
      <p class="item-meta">รายรับรวม ลบรายจ่ายรวมของเดือนที่เลือก</p>
    </article>
    <article class="list-item">
      <p class="item-title">สัดส่วนหนี้ BNPL ต่อ Limit</p>
      <div class="amount expense">${debtRatio.toFixed(0)}%</div>
      <div class="progress"><span style="width: ${debtRatio}%"></span></div>
    </article>
  `;
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
    refreshAll().catch(showToast);
  });

  $("manualLoginForm").addEventListener("submit", (event) => loginManualAccount(event).catch(showToast));
  $("manualRegisterForm").addEventListener("submit", (event) => registerManualAccount(event).catch(showToast));
  $("showLoginBtn").addEventListener("click", () => setAuthMode("login"));
  $("showRegisterBtn").addEventListener("click", () => setAuthMode("register"));
  $("lineLoginBtn").addEventListener("click", () => {
    if (typeof liff !== "undefined" && document.body.dataset.liffId) {
      liff.login({ redirectUri: window.location.href });
    } else {
      showToast("ยังไม่ได้ตั้งค่า LIFF_ID");
    }
  });
  $("logoutBtn").addEventListener("click", logout);
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
      ["overview", "bnpl", "transactions", "health", "settings"].forEach((name) => {
        $(`tab-${name}`).hidden = tab.dataset.tab !== name;
      });
    });
  });
}

async function init() {
  $("txDate").value = todayIso();
  $("dueDate").value = todayIso();
  $("filterMonth").value = state.selectedMonth;
  syncMonthLabel();
  bindEvents();
  setupGoogleLogin();

  const savedAuth = localStorage.getItem("monibaAuthUser");
  if (savedAuth) {
    try {
      const parsed = JSON.parse(savedAuth);
      if (parsed?.user?.line_user_id) {
        applyAuthenticatedUser(parsed.user, parsed.source || "manual");
        await refreshAll();
        return;
      }
    } catch (error) {
      localStorage.removeItem("monibaAuthUser");
    }
  }

  const liffId = document.body.dataset.liffId;
  if (!liffId || typeof liff === "undefined") {
    setAuthPanelVisible(true);
    return;
  }

  try {
    await liff.init({ liffId });

    if (!liff.isLoggedIn()) {
      setAuthPanelVisible(true);
      return;
    }

    const profile = await liff.getProfile();
    state.lineUserId = profile.userId;
    const response = await apiFetch("/api/line/connect", {
      method: "POST",
      body: JSON.stringify({ id_token: liff.getIDToken() }),
    });
    applyAuthenticatedUser({
      ...response.user,
      display_name: profile.displayName || response.user.display_name,
      picture_url: profile.pictureUrl || response.user.picture_url,
    }, "line");

    await refreshAll();
  } catch (error) {
    console.error(error);
    setAuthPanelVisible(true);
    showToast(error.message || "เชื่อม LINE ไม่สำเร็จ ล็อกอินด้วยบัญชี Moniba ได้");
  }
}
document.addEventListener("DOMContentLoaded", () => init());

