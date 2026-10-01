const appRoot = document.querySelector('#app');
const toast = document.querySelector('#toast');
const sellerAccessUrl = window.location.pathname.replace(/\/+$/, '') === '/seller';
const moneyFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const fullDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const state = { user: null, view: sellerAccessUrl ? 'seller' : 'daily', authMode: 'login', date: today(), month: currentMonth(), products: [], entries: [], busy: false, message: '' };
let toastTimer;

function today() { return new Date().toISOString().slice(0, 10); }
function currentMonth() { return today().slice(0, 7); }
function money(value) { return moneyFormat.format(Number(value) || 0); }
function monthLabel(month) { return monthFormat.format(new Date(`${month}-01T00:00:00Z`)); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child instanceof Node) node.append(child);
    else if (child !== null && child !== undefined) node.append(document.createTextNode(String(child)));
  }
  return node;
}
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}
function button(text, action, style = 'secondary', attrs = {}) {
  return el('button', { type: 'button', class: `button ${style}`, text, onclick: action, ...attrs });
}
function field(label, name, type = 'text', value = '', options = {}) {
  const control = type === 'textarea'
    ? el('textarea', { id: name, name, maxlength: options.maxlength ?? 500, required: options.required ? '' : null }, value)
    : el('input', { id: name, name, type, value, min: options.min, max: options.max, step: options.step, maxlength: options.maxlength, required: options.required ? '' : null, autocomplete: options.autocomplete });
  let input = control;
  if (type === 'password') {
    const icon = svg('svg', { class: 'password-toggle-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, [
      svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z' }),
      svg('circle', { cx: '12', cy: '12', r: '3' }),
    ]);
    const toggle = el('button', { type: 'button', class: 'password-toggle', 'aria-label': 'Show password', title: 'Show password' }, icon);
    toggle.addEventListener('click', () => {
      const isVisible = control.type === 'password';
      control.type = isVisible ? 'text' : 'password';
      toggle.setAttribute('aria-label', `${isVisible ? 'Hide' : 'Show'} password`);
      toggle.title = `${isVisible ? 'Hide' : 'Show'} password`;
    });
    input = el('div', { class: 'password-input-wrap' }, [control, toggle]);
  }
  const wrap = el('div', { class: 'field' }, [el('label', { for: name, text: label }), input]);
  return { wrap, control };
}
function selectField(label, name, options, value) {
  const select = el('select', { id: name, name });
  for (const [optionValue, optionLabel] of options) {
    const option = el('option', { value: optionValue, text: optionLabel });
    if (optionValue === value) option.selected = true;
    select.append(option);
  }
  return { wrap: el('div', { class: 'field' }, [el('label', { for: name, text: label }), select]), control: select };
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401 && state.user) { state.user = null; render(); }
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}
function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function statusPill(status) {
  const label = { paid: 'Paid', partial: 'Partial', pending: 'Pending', 'no-bill': 'No bill' }[status] || status;
  return el('span', { class: `status-pill ${status}`, text: label });
}
function formError(error) { notify(error.message || 'Something went wrong.'); }

function renderAuth(config) {
  const aside = el('section', { class: 'auth-aside' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'mark', text: 'D' }), el('span', { text: 'DailyDrop' })]),
    el('div', {}, [el('h1', { text: 'Your doorstep, in order.' }), el('p', { text: 'A clear daily record of what arrived, what it cost, and what is still due.' })]),
    el('div', { class: 'aside-foot', text: 'Household delivery ledger / v1.0' }),
  ]);
  const panel = el('section', { class: 'auth-panel' });
  panel.append(el('h2', { text: state.authMode === 'login' ? 'Welcome back' : 'Create your ledger' }));
  panel.append(el('p', { text: state.authMode === 'login' ? 'Sign in to continue to your deliveries.' : 'Start keeping your household deliveries in one place.' }));
  const tabs = el('div', { class: 'auth-tabs', role: 'tablist', 'aria-label': 'Account access' });
  const loginTab = el('button', { type: 'button', class: `auth-tab ${state.authMode === 'login' ? 'active' : ''}`, role: 'tab', 'aria-selected': state.authMode === 'login', text: 'Sign in', onclick: () => { state.authMode = 'login'; render(); } });
  tabs.append(loginTab);
  if (config.registrationEnabled && !sellerAccessUrl) tabs.append(el('button', { type: 'button', class: `auth-tab ${state.authMode === 'register' ? 'active' : ''}`, role: 'tab', 'aria-selected': state.authMode === 'register', text: 'Register', onclick: () => { state.authMode = 'register'; render(); } }));
  panel.append(tabs);
  const form = el('form', { class: 'form-stack' });
  const username = field('Username', 'username', 'text', '', { required: true, maxlength: 32, autocomplete: 'username' });
  username.control.autocapitalize = 'none';
  username.control.minLength = 3;
  form.append(username.wrap);
  if (state.authMode === 'register') {
    const fullName = field('Full name', 'fullName', 'text', '', { maxlength: 100, autocomplete: 'name' });
    const email = field('Email', 'email', 'email', '', { maxlength: 254, autocomplete: 'email' });
    form.append(fullName.wrap, email.wrap);
  }
  const password = field('Password', 'password', 'password', '', { required: true, maxlength: 128, autocomplete: state.authMode === 'login' ? 'current-password' : 'new-password' });
  password.control.minLength = state.authMode === 'register' ? 10 : 1;
  form.append(password.wrap);
  const submit = el('button', { class: 'button', type: 'submit', text: state.authMode === 'login' ? 'Sign in' : 'Create account' });
  form.append(submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Please wait...';
    const values = new FormData(form);
    const body = Object.fromEntries(values.entries());
    try {
      const endpoint = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const result = await api(endpoint, { method: 'POST', body });
      if (sellerAccessUrl && !result.user.isSeller) { window.location.replace('/'); return; }
      state.user = result.user;
      if (sellerAccessUrl) state.view = 'seller';
      await refreshData();
      render();
    } catch (error) {
      notify(error.message);
      submit.disabled = false;
      submit.textContent = state.authMode === 'login' ? 'Sign in' : 'Create account';
    }
  });
  panel.append(form);
  appRoot.replaceChildren(el('main', { class: `auth-wrap ${sellerAccessUrl ? 'seller-route' : ''}` }, [aside, el('div', { class: 'auth-main' }, panel)]));
}

const views = [
  ['daily', 'Daily', '◷'], ['bill', 'Bill', '₹'], ['report', 'Report', '▤'],
  ['products', 'Products', '＋'], ['profile', 'Profile', '○'], ['seller', 'Seller', '▦'],
];
function allowedViews() {
  return views.filter(([key]) => sellerAccessUrl
    ? ['seller', 'profile'].includes(key) && (key !== 'seller' || state.user?.isSeller)
    : key !== 'seller');
}
function navigate(view) { state.view = view; render(); }
function renderShell() {
  const initials = (state.user.fullName || state.user.username).slice(0, 1).toUpperCase();
  const brand = el('div', { class: 'side-brand' }, [el('span', { class: 'mark', text: 'D' }), el('span', { class: 'brand-name', text: 'DailyDrop' })]);
  const sidebar = el('aside', { class: 'sidebar' }, [brand, el('div', { class: 'nav-label', text: 'Workspace' })]);
  const nav = el('nav', { class: 'nav-list', 'aria-label': 'Main navigation' });
  for (const [key, label, symbol] of allowedViews()) nav.append(navButton(key, label, symbol));
  sidebar.append(nav);
  sidebar.append(el('div', { class: 'sidebar-bottom' }, el('div', { class: 'user-chip' }, [
    el('span', { class: 'avatar', text: initials }),
    el('span', { class: 'user-chip-copy' }, [el('strong', { text: state.user.fullName || state.user.username }), el('small', { text: state.user.isSeller ? 'Seller' : `@${state.user.username}` })]),
  ])));
  const title = views.find(([key]) => key === state.view)?.[1] || 'Daily';
  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'topbar-title' }, [el('h1', { text: title }), el('span', { text: state.view === 'daily' ? fullDateFormat.format(new Date(`${state.date}T00:00:00Z`)) : monthLabel(state.month) })]),
    el('div', { class: 'topbar-tools' }, state.view === 'daily' ? [
      el('label', { class: 'sr-only', for: 'daily-date', text: 'Select delivery date' }),
      el('input', { id: 'daily-date', class: 'control', type: 'date', value: state.date, 'aria-label': 'Select delivery date', onchange: async (event) => { state.date = event.target.value; state.month = state.date.slice(0, 7); try { await refreshMonthEntries(state.month); render(); } catch (error) { formError(error); } } }),
    ] : []),
  ]);
  const main = el('div', { class: 'main-area' }, [topbar, el('main', { class: 'page-content' })]);
  const shell = el('div', { class: `app-shell ${sellerAccessUrl ? 'seller-route' : ''}` }, [sidebar, main]);
  const mobileNav = el('nav', { class: 'mobile-nav', 'aria-label': 'Main navigation' });
  for (const [key, label, symbol] of allowedViews()) mobileNav.append(navButton(key, label, symbol, true));
  shell.append(mobileNav);
  appRoot.replaceChildren(shell);
  return main.querySelector('main');
}
function navButton(key, label, symbol, mobile = false) {
  return el('button', { type: 'button', class: `nav-button ${mobile ? 'mobile-item' : ''} ${state.view === key ? 'active' : ''}`, 'aria-current': state.view === key ? 'page' : null, onclick: () => navigate(key) }, [
    el('span', { class: 'nav-symbol', 'aria-hidden': 'true', text: symbol }), el('span', { class: 'nav-copy', text: label }),
  ]);
}
function heading(kicker, title, description) {
  return [el('p', { class: 'eyebrow', text: kicker }), el('h2', { class: 'page-heading', text: title }), el('p', { class: 'subheading', text: description })];
}
function sectionHead(title, note = '') {
  return el('div', { class: 'section-head' }, [el('div', {}, [el('h2', { text: title }), ...(note ? [el('p', { text: note })] : [])])]);
}
function entryFor(productId, date = state.date) { return state.entries.find((entry) => entry.product_id === productId && entry.delivery_date === date); }
function dayScheduled(product, date) {
  const day = new Date(`${date}T00:00:00Z`);
  const schedule = product.schedule || {};
  if (['alternate', 'every_n'].includes(product.scheduleType) && date < schedule.startDate) return false;
  if (product.scheduleType === 'daily') return true;
  if (product.scheduleType === 'alternate') {
    const diff = Math.round((day - new Date(`${schedule.startDate}T00:00:00Z`)) / 86400000);
    return diff % 2 === 0;
  }
  if (product.scheduleType === 'every_n') {
    const diff = Math.round((day - new Date(`${schedule.startDate}T00:00:00Z`)) / 86400000);
    return diff % schedule.interval === 0;
  }
  if (product.scheduleType === 'weekdays') return schedule.weekdays.includes(day.getUTCDay());
  if (product.scheduleType === 'monthly') {
    const lastDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    return day.getUTCDate() === Math.min(schedule.day, lastDay);
  }
  return false;
}
function scheduleLabel(product) {
  const schedule = product.schedule || {};
  if (product.scheduleType === 'every_n') return `Every ${schedule.interval} days`;
  if (product.scheduleType === 'weekdays') return schedule.weekdays.map((day) => weekdays[day]).join(', ');
  if (product.scheduleType === 'monthly') return `Monthly · day ${schedule.day}`;
  return { daily: 'Daily', alternate: 'Every other day', on_demand: 'On demand' }[product.scheduleType] || 'Daily';
}
async function setEntry(product, quantity) {
  if (quantity === null) await api(`/api/entries/${state.date}/${product.id}`, { method: 'DELETE' });
  else await api(`/api/entries/${state.date}/${product.id}`, { method: 'PUT', body: { quantity } });
  await refreshMonthEntries(state.date.slice(0, 7));
  render();
}
function renderDaily(content) {
  content.append(...heading('Delivery log', 'Today, accounted for.', 'Record the drop as it happens. Adjust quantities whenever the doorstep tells a different story.'));
  const scheduled = state.products.filter((product) => dayScheduled(product, state.date));
  const unscheduled = state.products.filter((product) => !dayScheduled(product, state.date) && entryFor(product.id));
  const done = scheduled.filter((product) => entryFor(product.id)?.quantity > 0).length;
  const missed = scheduled.filter((product) => entryFor(product.id)?.quantity === 0).length;
  const due = scheduled.length;
  const total = state.entries.filter((entry) => entry.delivery_date === state.date && entry.quantity > 0).reduce((sum, entry) => sum + entry.quantity * entry.unit_price, 0);
  content.append(el('div', { class: 'stats-grid' }, [
    stat('Scheduled', `${due}`, 'products expected'), stat('Received', `${done}`, 'confirmed deliveries'), stat('Missed', `${missed}`, 'marked not received'), stat('Recorded value', money(total), 'received deliveries only'),
  ]));
  const monthEntries = entriesForMonth();
  content.append(el('section', { class: 'panel panel-pad' }, [
    sectionHead('Monthly delivery calendar', `${state.month} · received vs missed across the month`),
    buildCalendar(state.month, state.products, monthEntries),
  ]));
  content.append(sectionHead('Scheduled deliveries', `${state.date} · ${due} expected`));
  const list = el('div', { class: 'daily-list' });
  for (const product of scheduled) list.append(deliveryRow(product, true));
  if (!scheduled.length) list.append(el('div', { class: 'empty-state' }, [el('strong', { text: 'A quiet doorstep.' }), el('br'), 'No products are scheduled for this date. You can still record an unscheduled delivery below.']));
  content.append(list);
  if (unscheduled.length) {
    content.append(sectionHead('Unscheduled deliveries', 'Recorded outside the product schedule'));
    const extra = el('div', { class: 'daily-list' });
    for (const product of unscheduled) extra.append(deliveryRow(product, false));
    content.append(extra);
  }
  const available = state.products.filter((product) => !scheduled.includes(product) && !unscheduled.includes(product));
  if (available.length) {
    const add = el('div', { class: 'toolbar daily-add-toolbar' });
    const pick = selectField('Record an unscheduled delivery', 'unscheduled-product', available.map((product) => [String(product.id), product.name]), String(available[0].id));
    add.append(pick.wrap, button('Record received', async () => {
      const product = available.find((item) => String(item.id) === pick.control.value);
      try { await setEntry(product, product.defaultQuantity); } catch (error) { formError(error); }
    }, 'secondary'));
    content.append(add);
  }
}
function stat(label, value, note) {
  return el('div', { class: 'stat' }, [el('span', { class: 'stat-label', text: label }), el('strong', { class: 'stat-value', text: value }), el('small', { class: 'stat-note', text: note })]);
}
function deliveryRow(product, isScheduled) {
  const entry = entryFor(product.id);
  const received = Boolean(entry && entry.quantity > 0);
  const partiallyReceived = Boolean(received && entry.quantity < product.defaultQuantity);
  const missed = Boolean(entry && entry.quantity === 0);
  const row = el('article', { class: `delivery-row ${partiallyReceived ? 'partial-receipt' : received ? 'received' : missed ? 'missed' : ''}` });
  row.append(el('div', { class: 'product-main' }, [
    el('strong', { text: product.name }),
    el('small', { text: `${money(entry?.unit_price ?? product.price)} / unit · ${received ? `${entry.quantity} received` : `${product.defaultQuantity} expected`}` }),
    el('span', { class: 'schedule-tag', text: isScheduled ? scheduleLabel(product) : 'Unscheduled' }),
    ...(partiallyReceived ? [el('span', { class: 'partial-receipt-label', text: `Partial · ${entry.quantity} of ${product.defaultQuantity} expected` })] : []),
  ]));
  const qty = el('input', { type: 'number', min: '1', max: '100000', step: '1', value: received ? entry.quantity : product.defaultQuantity, 'aria-label': `Quantity received for ${product.name}; ${product.defaultQuantity} expected`, onchange: async (event) => {
    const value = Number(event.target.value);
    if (!Number.isInteger(value) || value <= 0 || value > 100000) { event.target.value = received ? entry.quantity : product.defaultQuantity; return; }
    try { await setEntry(product, value); } catch (error) { formError(error); }
  } });
  const quantity = el('div', { class: 'quantity-control' }, [
    el('button', { class: 'stepper', type: 'button', text: '−', 'aria-label': `Reduce quantity of ${product.name}`, onclick: async () => { try { await setEntry(product, Math.max(1, Number(qty.value) - 1)); } catch (error) { formError(error); } } }),
    qty,
    el('button', { class: 'stepper', type: 'button', text: '+', 'aria-label': `Increase quantity of ${product.name}`, onclick: async () => { try { await setEntry(product, Math.min(100000, Number(qty.value) + 1)); } catch (error) { formError(error); } } }),
  ]);
  const actions = el('div', { class: 'delivery-actions' });
  actions.append(button(partiallyReceived ? 'Partial ✓' : received ? 'Received ✓' : 'Received', async () => { try { await setEntry(product, received ? null : product.defaultQuantity); } catch (error) { formError(error); } }, partiallyReceived ? 'partial-button small' : received ? 'received-button small' : 'secondary small'));
  actions.append(button(missed ? 'Missed ✓' : 'Missed', async () => { try { await setEntry(product, missed ? null : 0); } catch (error) { formError(error); } }, missed ? 'missed-button small' : 'secondary small'));
  row.append(quantity, actions);
  return row;
}
function refreshMonthEntries(month) {
  return api(`/api/entries?month=${encodeURIComponent(month)}`).then((result) => { state.entries = result.entries; });
}
async function loadMonth(month) {
  state.month = month;
  await refreshMonthEntries(month);
}

function monthPicker(onchange) {
  return el('input', { class: 'control', type: 'month', value: state.month, 'aria-label': 'Select month', onchange: async (event) => {
    state.month = event.target.value;
    try { await loadMonth(state.month); await onchange(); } catch (error) { formError(error); }
  } });
}
function entriesForMonth() { return state.entries.filter((entry) => entry.delivery_date.startsWith(state.month)); }
function productRows() {
  const grouped = new Map();
  for (const entry of entriesForMonth()) {
    const key = `${entry.product_id}:${entry.product_name}`;
    const item = grouped.get(key) || { name: entry.product_name, quantity: 0, amount: 0 };
    item.quantity += entry.quantity;
    if (entry.quantity > 0) item.amount += entry.quantity * entry.unit_price;
    grouped.set(key, item);
  }
  return [...grouped.values()].map((item) => ({ ...item, amount: Math.round(item.amount * 100) / 100 })).sort((a, b) => a.name.localeCompare(b.name));
}
function buildCalendar(month, products, entries) {
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const wrap = el('div', { class: 'calendar-wrap' });
  wrap.append(el('div', { class: 'calendar-heading' }, weekdays.map((day) => el('span', { text: day }))));
  const grid = el('div', { class: 'calendar' });
  for (let index = 0; index < offset; index += 1) grid.append(el('div', { class: 'calendar-day blank', 'aria-hidden': 'true' }));
  for (let number = 1; number <= days; number += 1) {
    const date = `${month}-${String(number).padStart(2, '0')}`;
    const scheduled = products.filter((product) => dayScheduled(product, date));
    const dayEntries = entries.filter((entry) => entry.delivery_date === date);
    const scheduledEntries = scheduled.map((product) => dayEntries.find((entry) => entry.product_id === product.id)).filter(Boolean);
    const scheduledProductsById = new Map(scheduled.map((product) => [product.id, product]));
    const fullyReceived = scheduledEntries.filter((entry) => entry.quantity >= scheduledProductsById.get(entry.product_id).defaultQuantity).length;
    const partiallyReceived = scheduledEntries.filter((entry) => entry.quantity > 0 && entry.quantity < scheduledProductsById.get(entry.product_id).defaultQuantity).length;
    const missed = scheduledEntries.filter((entry) => entry.quantity === 0).length;
    const open = scheduled.length - scheduledEntries.length;
    let status = '';
    let mark = '';
    if (scheduled.length) {
      if (fullyReceived === scheduled.length) { status = 'received'; mark = `${fullyReceived} received`; }
      else if (partiallyReceived) {
        status = 'partial';
        mark = `${partiallyReceived} partial · ${fullyReceived} received · ${missed} missed · ${open} open`;
      } else if (missed === scheduled.length) { status = 'missed'; mark = `${missed} missed`; }
      else if (fullyReceived || missed) { status = 'partial'; mark = `${fullyReceived} received · ${missed} missed · ${open} open`; }
    } else if (dayEntries.length) {
      const productsById = new Map(products.map((product) => [product.id, product]));
      const extras = dayEntries.map((entry) => ({ entry, product: productsById.get(entry.product_id) })).filter(({ product }) => product);
      const extraPartials = extras.filter(({ entry, product }) => entry.quantity > 0 && entry.quantity < product.defaultQuantity).length;
      const extraReceived = extras.filter(({ entry, product }) => entry.quantity >= product.defaultQuantity).length;
      const extraMissed = extras.filter(({ entry }) => entry.quantity === 0).length;
      status = extraPartials ? 'partial' : extraReceived ? 'received' : 'missed';
      mark = extraPartials ? `${extraPartials} partial · ${extraReceived} extra` : extraReceived ? `${extraReceived} extra` : `${extraMissed} missed`;
    }
    const day = el('div', { class: `calendar-day ${status}`, title: mark ? `${date}: ${mark}` : date, role: 'button', tabindex: 0, onclick: async () => {
      state.date = date;
      state.month = month;
      try {
        await refreshMonthEntries(state.month);
        render();
      } catch (error) {
        formError(error);
      }
    }, onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        day.click();
      }
    } }, [el('span', { class: 'day-num', text: String(number) })]);
    if (mark) day.append(el('span', { class: 'day-mark', text: mark }));
    grid.append(day);
  }
  wrap.append(grid);
  wrap.append(el('div', { class: 'legend' }, [
    legend('received-key', 'Received'), legend('partial-key', 'Partial'), legend('missed-key', 'Missed'), legend('open-key', 'No scheduled delivery'),
  ]));
  return wrap;
}
function legend(className, label) { return el('span', {}, [el('i', { class: className }), label]); }
function monthShortName(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}
async function renderBill(content) {
  content.append(...heading('Monthly statement', 'The month in numbers.', 'A bill assembled from received deliveries. Product edits never rewrite what was recorded.'));
  const picker = monthPicker(() => render());
  content.append(el('div', { class: 'filter-row' }, [el('span', { class: 'eyebrow', text: monthLabel(state.month) }), picker]));
  const entries = entriesForMonth();
  const groups = productRows();
  const total = groups.reduce((sum, item) => sum + item.amount, 0);
  const payment = await api(`/api/payments/${state.month}`);
  const left = el('section', { class: 'panel panel-pad' });
  left.append(sectionHead('Product totals', `${entries.filter((entry) => entry.quantity > 0).length} recorded receipts`));
  if (groups.length) {
    const table = el('table', { class: 'line-items' });
    table.append(el('thead', {}, el('tr', {}, [el('th', { text: 'Product' }), el('th', { text: 'Qty received' }), el('th', { text: 'Amount' })])));
    const body = el('tbody');
    for (const row of groups) body.append(el('tr', {}, [el('td', { text: row.name }), el('td', { text: row.quantity.toLocaleString() }), el('td', { text: money(row.amount) })]));
    table.append(body);
    left.append(table, el('div', { class: 'bill-total' }, [el('span', { text: 'Monthly total' }), el('strong', { text: money(total) })]));
  } else left.append(el('div', { class: 'empty-state', text: 'There are no recorded deliveries in this month yet.' }));
  const right = el('div', { class: 'form-stack' });
  const statusPanel = el('section', { class: 'panel panel-pad' }, [sectionHead('Payment status'), statusPill(payment.status), el('div', { class: 'bill-total' }, [el('span', { text: 'Paid' }), el('strong', { text: money(payment.payment?.amount || 0) })])]);
  if (payment.payment) statusPanel.append(el('p', { class: 'subheading', text: `${payment.payment.method} · recorded ${new Date(`${payment.payment.updatedAt.replace(' ', 'T')}Z`).toLocaleDateString()}` }));
  right.append(statusPanel);
  const calendarPanel = el('section', { class: 'panel panel-pad' }, [sectionHead('Delivery calendar', 'Each square summarizes the scheduled drops for that day.'), buildCalendar(state.month, state.products, entries)]);
  right.append(calendarPanel);
  content.append(el('div', { class: 'bill-layout' }, [left, right]));
}
function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map(safeCsvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
async function renderReport(content) {
  const [report] = await Promise.all([api(`/api/reports/monthly-totals?to=${state.month}&months=6`), refreshMonthEntries(state.month)]);
  content.append(...heading('Purchase report', 'Spending, made visible.', 'A monthly view of receipts and missed drops, with a six-month view for context.'));
  const picker = monthPicker(() => render());
  const printButton = button('Print report', () => window.print(), 'secondary');
  const exportButton = button('Download CSV', () => exportReport(), 'secondary');
  content.append(el('div', { class: 'filter-row' }, [el('span', { class: 'eyebrow', text: monthLabel(state.month) }), el('div', { class: 'toolbar' }, [picker, exportButton, printButton])]));
  const entries = entriesForMonth();
  const groups = productRows();
  const spend = groups.reduce((sum, item) => sum + item.amount, 0);
  const prior = report.totals.at(-2)?.total || 0;
  const change = prior ? `${spend >= prior ? '+' : ''}${(((spend - prior) / prior) * 100).toFixed(1)}%` : '—';
  const receipts = entries.filter((entry) => entry.quantity > 0);
  const missed = entries.filter((entry) => entry.quantity === 0).length;
  const dayCount = new Date(Date.UTC(Number(state.month.slice(0, 4)), Number(state.month.slice(5, 7)), 0)).getUTCDate();
  content.append(el('div', { class: 'stats-grid' }, [
    stat('Monthly spend', money(spend), `${change} from prior month`), stat('Deliveries', `${receipts.length}`, 'received entries'), stat('Missed days', `${missed}`, 'marked missed'), stat('Average / day', money(spend / dayCount), `across ${dayCount} calendar days`),
  ]));
  const chart = el('section', { class: 'panel panel-pad' }, [sectionHead('Six-month spend', 'Monthly total from received entries')]);
  const chartWrap = el('div', { class: 'chart-wrap', role: 'img', 'aria-label': 'Bar chart of monthly spend for the last six months' });
  const max = Math.max(1, ...report.totals.map((item) => item.total));
  for (const item of report.totals) {
    const column = el('div', { class: 'chart-column' });
    column.append(el('span', { class: 'chart-value', text: money(item.total) }));
    const level = Math.max(2, Math.ceil(item.total / max * 10) * 10);
    const bar = el('span', { class: `chart-bar level-${level}` });
    column.append(bar, el('span', { class: 'chart-month', text: monthShortName(item.month) }));
    chartWrap.append(column);
  }
  chart.append(chartWrap);
  content.append(chart);
  const lower = el('div', { class: 'report-layout report-lower' });
  const productPanel = el('section', { class: 'panel panel-pad' }, [sectionHead('Product summary')]);
  if (entries.length) {
    const summaryRows = entries.slice().sort((a, b) => b.delivery_date.localeCompare(a.delivery_date)).map((entry) => ({
      date: entry.delivery_date,
      product: entry.product_name,
      quantity: entry.quantity,
      amount: entry.quantity * entry.unit_price,
    }));
    const table = el('table', { class: 'data-table' }, el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Date' }), el('th', { text: 'Product' }), el('th', { text: 'Qty' }), el('th', { class: 'numeric', text: 'Spend' })]),
      el('tr', { class: 'filter-row-table' }, [
        el('th', {}, el('input', { type: 'text', placeholder: 'Filter date', 'aria-label': 'Filter by date' })),
        el('th', {}, el('input', { type: 'text', placeholder: 'Filter product', 'aria-label': 'Filter by product' })),
        el('th', {}, el('input', { type: 'text', placeholder: 'Filter qty', 'aria-label': 'Filter by quantity' })),
        el('th', { class: 'numeric' }, el('input', { type: 'text', placeholder: 'Filter spend', 'aria-label': 'Filter by spend' })),
      ]),
    ]));
    const body = el('tbody');
    const renderRows = () => {
      const filterInputs = table.querySelectorAll('input');
      const [dateFilter, productFilter, qtyFilter, spendFilter] = Array.from(filterInputs).map((input) => input.value.trim().toLowerCase());
      body.replaceChildren();
      let visibleCount = 0;
      for (const item of summaryRows) {
        const rowDate = item.date.toLowerCase();
        const rowProduct = item.product.toLowerCase();
        const rowQty = String(item.quantity).toLowerCase();
        const rowSpend = money(item.amount).toLowerCase();
        const matchesDate = !dateFilter || rowDate.includes(dateFilter);
        const matchesProduct = !productFilter || rowProduct.includes(productFilter);
        const matchesQty = !qtyFilter || rowQty.includes(qtyFilter);
        const matchesSpend = !spendFilter || rowSpend.includes(spendFilter);
        if (!(matchesDate && matchesProduct && matchesQty && matchesSpend)) continue;
        visibleCount += 1;
        body.append(el('tr', {}, [
          el('td', { text: item.date }),
          el('td', { text: item.product }),
          el('td', { text: item.quantity ? item.quantity.toLocaleString() : 'Missed' }),
          el('td', { class: 'numeric', text: money(item.amount) }),
        ]));
      }
      if (!visibleCount) body.append(el('tr', {}, el('td', { colspan: 4, class: 'empty-state-cell', text: 'No matching entries.' })));
    };
    table.append(body);
    table.querySelectorAll('input').forEach((input) => input.addEventListener('input', renderRows));
    renderRows();
    productPanel.append(table);
  } else productPanel.append(el('div', { class: 'empty-state', text: 'No product totals for this month.' }));
  const logPanel = el('section', { class: 'panel panel-pad' }, [sectionHead('Purchase log', `${entries.length} entries`)]);
  if (entries.length) {
    const table = el('table', { class: 'data-table' }, el('thead', {}, el('tr', {}, [el('th', { text: 'Date' }), el('th', { text: 'Product' }), el('th', { text: 'Qty' }), el('th', { class: 'numeric', text: 'Amount' })])));
    const body = el('tbody');
    for (const entry of entries.slice().sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))) {
      body.append(el('tr', {}, [el('td', { text: entry.delivery_date }), el('td', { text: entry.product_name }), el('td', { text: entry.quantity ? entry.quantity.toLocaleString() : 'Missed' }), el('td', { class: 'numeric', text: money(entry.quantity * entry.unit_price) })]));
    }
    table.append(body);
    logPanel.append(el('div', { class: 'table-scroll' }, table));
  } else logPanel.append(el('div', { class: 'empty-state', text: 'Your day-by-day purchases will appear here.' }));
  lower.append(productPanel, logPanel);
  content.append(lower);
}
function exportReport() {
  const entries = entriesForMonth().slice().sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
  const rows = [['Date', 'Product', 'Quantity', 'Unit price', 'Amount', 'Status']];
  for (const item of entries) rows.push([item.delivery_date, item.product_name, item.quantity, item.unit_price, item.quantity * item.unit_price, item.quantity ? 'Received' : 'Missed']);
  downloadCsv(rows, `dailydrop-${state.month}.csv`);
}

function weekdayControl(selected = []) {
  const picker = el('div', { class: 'weekday-picker', role: 'group', 'aria-label': 'Delivery weekdays' });
  weekdays.forEach((day, index) => {
    const input = el('input', { type: 'checkbox', name: 'weekdays', value: String(index), checked: selected.includes(index) ? '' : null });
    picker.append(el('label', {}, [input, el('span', { text: day })]));
  });
  return picker;
}
function renderProducts(content) {
  content.append(...heading('Product roster', 'What comes to the door?', 'Set a price and schedule once. Your delivery history keeps its original name and price.'));
  const editor = el('section', { class: 'panel panel-pad' });
  const editingId = { value: null };
  const form = el('form', { class: 'form-stack' });
  const formTitle = el('h2', { class: 'product-form-title', text: 'Add a product' });
  editor.append(formTitle);
  const basics = el('div', { class: 'field-row' });
  const name = field('Product name', 'product-name', 'text', '', { required: true, maxlength: 80 });
  const price = field('Unit price', 'product-price', 'number', '0', { required: true, min: 0, max: 1000000, step: '0.01' });
  basics.append(name.wrap, price.wrap);
  const scheduleRow = el('div', { class: 'field-row' });
  const quantity = field('Default quantity', 'product-quantity', 'number', '1', { required: true, min: 1, max: 100000, step: 1 });
  const type = selectField('Delivery schedule', 'schedule-type', [
    ['daily', 'Every day'], ['alternate', 'Every other day'], ['every_n', 'Every N days'], ['weekdays', 'Selected weekdays'], ['monthly', 'Monthly day'], ['on_demand', 'On demand'],
  ], 'daily');
  scheduleRow.append(quantity.wrap, type.wrap);
  const scheduleDetails = el('div', { class: 'schedule-fields' });
  scheduleDetails.hidden = true;
  const scheduleControls = el('div', { class: 'form-stack' });
  scheduleDetails.append(scheduleControls);
  const renderScheduleControls = (product = null) => {
    scheduleControls.replaceChildren();
    if (type.control.value === 'alternate' || type.control.value === 'every_n') {
      const start = field('Start date', 'schedule-start', 'date', product?.schedule.startDate || today(), { required: true });
      scheduleControls.append(start.wrap);
    }
    if (type.control.value === 'every_n') {
      const interval = field('Repeat every', 'schedule-interval', 'number', product?.schedule.interval || 3, { required: true, min: 2, max: 365, step: 1 });
      interval.wrap.append(el('small', { class: 'stat-note', text: 'Days, from the start date (2–365).' }));
      scheduleControls.append(interval.wrap);
    }
    if (type.control.value === 'weekdays') scheduleControls.append(el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Delivery days' }), weekdayControl(product?.schedule.weekdays || [])]));
    if (type.control.value === 'monthly') {
      const day = field('Day of month', 'schedule-day', 'number', product?.schedule.day || 1, { required: true, min: 1, max: 31, step: 1 });
      day.wrap.append(el('small', { class: 'stat-note', text: 'Shorter months use their final day.' }));
      scheduleControls.append(day.wrap);
    }
    if (type.control.value === 'on_demand') scheduleControls.append(el('small', { class: 'stat-note', text: 'Never scheduled automatically. Record a delivery from Daily when it arrives.' }));
    scheduleDetails.hidden = scheduleControls.childElementCount === 0;
  };
  type.control.addEventListener('change', () => renderScheduleControls());
  renderScheduleControls();
  form.append(basics, scheduleRow, scheduleDetails);
  const actions = el('div', { class: 'toolbar' });
  const save = el('button', { class: 'button', type: 'submit', text: 'Add product' });
  const cancel = button('Cancel edit', () => {
    editingId.value = null;
    form.reset();
    type.control.value = 'daily';
    renderScheduleControls();
    save.textContent = 'Add product';
    cancel.hidden = true;
    formTitle.textContent = 'Add a product';
  }, 'secondary', { hidden: '' });
  actions.append(save, cancel);
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const schedule = {};
    if (['alternate', 'every_n'].includes(type.control.value)) schedule.startDate = form.elements['schedule-start'].value;
    if (type.control.value === 'every_n') schedule.interval = Number(form.elements['schedule-interval'].value);
    if (type.control.value === 'weekdays') schedule.weekdays = [...form.querySelectorAll('[name="weekdays"]:checked')].map((input) => Number(input.value));
    if (type.control.value === 'monthly') schedule.day = Number(form.elements['schedule-day'].value);
    const data = { name: name.control.value.trim(), price: Number(price.control.value), defaultQuantity: Math.round(Number(quantity.control.value)), scheduleType: type.control.value, schedule };
    try {
      await api(editingId.value ? `/api/products/${editingId.value}` : '/api/products', { method: editingId.value ? 'PUT' : 'POST', body: data });
      notify(editingId.value ? 'Product updated.' : 'Product added.');
      await refreshData();
      render();
    } catch (error) { formError(error); }
  });
  editor.append(form);
  content.append(editor);
  content.append(sectionHead('Your products', `${state.products.length} ${state.products.length === 1 ? 'product' : 'products'}`));
  if (!state.products.length) content.append(el('div', { class: 'empty-state', text: 'Your product roster is empty. Add the first delivery above.' }));
  else {
    const catalog = el('div', { class: 'product-catalog panel' });
    for (const product of state.products) {
      const edit = button('Edit', () => {
        editingId.value = product.id;
        name.control.value = product.name;
        price.control.value = product.price;
        quantity.control.value = product.defaultQuantity;
        type.control.value = product.scheduleType;
        renderScheduleControls(product);
        save.textContent = 'Save changes';
        cancel.hidden = false;
        formTitle.textContent = `Edit ${product.name}`;
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        name.control.focus();
      }, 'secondary small');
      const remove = button('Delete', async () => {
        if (!window.confirm(`Delete ${product.name} from your product list? Existing delivery history will remain.`)) return;
        try { await api(`/api/products/${product.id}`, { method: 'DELETE' }); await refreshData(); render(); notify('Product deleted.'); }
        catch (error) { formError(error); }
      }, 'danger small');
      catalog.append(el('article', { class: 'catalog-row' }, [
        el('div', { class: 'product-main' }, [el('strong', { text: product.name }), el('small', { text: `${scheduleLabel(product)} · qty ${product.defaultQuantity}` })]),
        el('strong', { text: money(product.price) }), el('div', { class: 'catalog-actions' }, [edit, remove]),
      ]));
    }
    content.append(catalog);
  }
}
function renderProfile(content) {
  content.append(...heading('Account settings', 'Your household details.', 'Keep your contact information up to date and manage account access.'));
  const profilePanel = el('section', { class: 'panel panel-pad' }, [sectionHead('Personal details')]);
  const form = el('form', { class: 'form-stack' });
  const name = field('Full name', 'profile-name', 'text', state.user.fullName, { maxlength: 100 });
  const email = field('Email address', 'profile-email', 'email', state.user.email, { maxlength: 254 });
  const phone = field('Phone', 'profile-phone', 'tel', state.user.phone, { maxlength: 40 });
  const address = field('Address', 'profile-address', 'textarea', state.user.address, { maxlength: 500 });
  form.append(name.wrap, email.wrap, phone.wrap, address.wrap, el('div', { class: 'toolbar' }, [el('button', { type: 'submit', class: 'button', text: 'Save details' })]));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/me', { method: 'PUT', body: { fullName: name.control.value, email: email.control.value, phone: phone.control.value, address: address.control.value } });
      state.user = result.user;
      notify('Profile saved.');
      render();
    } catch (error) { formError(error); }
  });
  profilePanel.append(form);
  const passwordPanel = el('section', { class: 'panel panel-pad' }, [sectionHead('Change password', 'Other sessions will be signed out.')]);
  const passwordForm = el('form', { class: 'form-stack' });
  const current = field('Current password', 'current-password', 'password', '', { required: true, autocomplete: 'current-password', maxlength: 128 });
  const next = field('New password', 'new-password', 'password', '', { required: true, autocomplete: 'new-password', maxlength: 128 });
  next.control.minLength = 10;
  passwordForm.append(current.wrap, next.wrap, el('button', { type: 'submit', class: 'button secondary', text: 'Update password' }));
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('/api/me/password', { method: 'PUT', body: { currentPassword: current.control.value, newPassword: next.control.value } }); passwordForm.reset(); notify('Password updated.'); }
    catch (error) { formError(error); }
  });
  passwordPanel.append(passwordForm);
  const signOut = button('Sign out', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    state.user = null;
    render();
  }, 'danger');
  content.append(el('div', { class: 'form-stack' }, [profilePanel, passwordPanel, el('div', { class: 'toolbar' }, signOut)]));
}
async function renderSeller(content) {
  content.append(...heading('Account operations', 'Accounts, subscriptions, payments.', 'Review registered users, their subscribed products, and monthly payment status.'));
  const [overview, bills] = await Promise.all([
    api('/api/seller/overview'), api(`/api/seller/bills?month=${state.month}`),
  ]);
  content.append(el('div', { class: 'filter-row' }, [el('span', { class: 'eyebrow', text: monthLabel(state.month) }), monthPicker(() => render())]));
  content.append(el('div', { class: 'seller-grid' }, [
    stat('Accounts', overview.users, 'registered users'), stat('Products', overview.products, 'across all accounts'), stat('Month entries', overview.monthEntries, 'recorded this month'),
  ]));
  content.append(el('div', { class: 'stats-grid' }, [
    stat('Billed', money(bills.totals.billed), 'received entries'), stat('Collected', money(bills.totals.collected), 'recorded payments'), stat('Outstanding', money(bills.totals.outstanding), 'remaining balance'), stat('Directory', bills.rows.length, 'accounts in ledger'),
  ]));
  const section = el('section', { class: 'panel panel-pad' });
  section.append(sectionHead('User directory', 'Search subscriptions and review or update payment status for the selected month.'));
  const search = field('Search accounts', 'seller-search', 'search', '', { maxlength: 100 });
  const filter = el('div', { class: 'filter-row' }, search.wrap);
  section.append(filter);
  const tableScroll = el('div', { class: 'table-scroll' });
  const table = el('table', { class: 'data-table' });
  const head = el('thead', {}, el('tr', {}, [
    el('th', { text: 'Account' }), el('th', { text: 'Subscriptions' }), el('th', { class: 'numeric', text: 'Billed' }), el('th', { class: 'numeric', text: 'Paid' }), el('th', { class: 'numeric', text: 'Due' }), el('th', { text: 'Payment' }), el('th', { text: 'Record payment' }),
  ]));
  const body = el('tbody');
  for (const row of bills.rows) {
    const subscriptionSearch = row.subscriptions.map((product) => `${product.name} ${product.defaultQuantity} ${scheduleLabel(product)}`).join(', ');
    const amount = field(`Payment amount for ${row.username}`, `pay-amount-${row.userId}`, 'number', row.payment?.amount ?? '', { min: '.01', max: 100000000, step: '.01' });
    amount.wrap.querySelector('label').className = 'sr-only';
    const method = selectField(`Method for ${row.username}`, `pay-method-${row.userId}`, [['Cash', 'Cash'], ['UPI', 'UPI'], ['Card', 'Card'], ['Bank transfer', 'Bank transfer'], ['Other', 'Other']], row.payment?.method || 'Cash');
    method.wrap.querySelector('label').className = 'sr-only';
    const save = button(row.payment ? 'Update' : 'Record', async () => {
      const paymentAmount = Number(amount.control.value);
      if (!paymentAmount) { notify('Enter a payment amount greater than zero.'); return; }
      try {
        await api(`/api/seller/payments/${row.userId}/${state.month}`, { method: 'PUT', body: { amount: paymentAmount, method: method.control.value } });
        notify('Payment saved.');
        render();
      } catch (error) { formError(error); }
    }, 'small');
    const controls = el('div', { class: 'seller-payment-controls' }, [amount.control, method.control, save]);
    if (row.payment) controls.append(button('Undo', async () => {
      if (!window.confirm(`Undo ${row.username}'s payment for ${state.month}?`)) return;
      try { await api(`/api/seller/payments/${row.userId}/${state.month}`, { method: 'DELETE' }); notify('Payment removed.'); render(); }
      catch (error) { formError(error); }
    }, 'danger small'));
    const account = el('div', { class: 'seller-user' }, [el('strong', { text: row.fullName || row.username }), el('small', { class: 'stat-note', text: `@${row.username}` })]);
    const products = row.subscriptions.length
      ? el('div', { class: 'seller-subscriptions' }, row.subscriptions.map((product) => el('span', { text: `${product.name} · qty ${product.defaultQuantity} · ${scheduleLabel(product)}` })))
      : el('span', { class: 'stat-note', text: 'No subscriptions' });
    const paymentStatusLabel = { paid: 'Completed', partial: 'Partial', pending: 'Pending', 'no-bill': 'No bill' }[row.status] || row.status;
    const paymentStatusCell = el('span', { class: `status-pill ${row.status}`, text: paymentStatusLabel });
    const tr = el('tr', { 'data-search': `${row.username} ${row.fullName} ${subscriptionSearch}`.toLowerCase() }, [
      el('td', {}, account), el('td', {}, products), el('td', { class: 'numeric', text: money(row.bill) }), el('td', { class: 'numeric', text: money(row.paid) }), el('td', { class: 'numeric', text: money(row.outstanding) }), el('td', {}, paymentStatusCell), el('td', {}, controls),
    ]);
    body.append(tr);
  }
  table.append(head, body);
  tableScroll.append(table);
  section.append(tableScroll);
  search.control.addEventListener('input', () => {
    const term = search.control.value.toLowerCase().trim();
    for (const row of body.rows) row.hidden = !row.dataset.search.includes(term);
  });
  if (!bills.rows.length) section.append(el('div', { class: 'empty-state', text: 'No accounts to show.' }));
  content.append(section);
}

async function refreshData() {
  if (!state.user) return;
  const [products] = await Promise.all([api('/api/products'), refreshMonthEntries(state.date.slice(0, 7))]);
  state.products = products.products;
  state.month = state.date.slice(0, 7);
}
async function render() {
  if (!state.user) {
    const config = await api('/api/config').catch(() => ({ registrationEnabled: false }));
    renderAuth(config);
    return;
  }
  if (!allowedViews().some(([key]) => key === state.view)) state.view = 'daily';
  const content = renderShell();
  content.append(el('div', { class: 'empty-state', text: 'Loading your ledger...' }));
  try {
    content.replaceChildren();
    if (state.view === 'daily') renderDaily(content);
    else if (state.view === 'bill') await renderBill(content);
    else if (state.view === 'report') await renderReport(content);
    else if (state.view === 'products') renderProducts(content);
    else if (state.view === 'profile') renderProfile(content);
    else if (state.view === 'seller') await renderSeller(content);
  } catch (error) {
    content.replaceChildren(el('div', { class: 'alert', text: error.message || 'Unable to load this view.' }));
  }
}
async function start() {
  try {
    const result = await api('/api/me');
    if (sellerAccessUrl && !result.user.isSeller) { window.location.replace('/'); return; }
    state.user = result.user;
    if (sellerAccessUrl) state.view = 'seller';
    await refreshData();
  } catch {
    state.user = null;
  }
  await render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }, { once: true });
}

start();