/* MoltBot Cloud lead capture. To start saving form submissions, paste ONE endpoint below:
 *   Formspree:  var LEADS_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";
 *   Supabase:   var LEADS_ENDPOINT = "https://YOUR_PROJECT.supabase.co/rest/v1/leads";
 *               var LEADS_HEADERS = { "apikey": "sb_publishable_YOUR_KEY", "Prefer": "return=minimal" };
 *   Redeployed moltbot-saas backend:  var LEADS_ENDPOINT = "https://YOUR-APP.vercel.app/api/waitlist";
 * While LEADS_ENDPOINT is "", nothing is sent and every form shows an honest "inbox is being set up" message.
 */
var LEADS_ENDPOINT = "";
var LEADS_HEADERS = {};

/* ---------------------------------------------------------------------------------------------------------------
 * How pages use it
 *   <script src="leads.js" defer></script>, then EITHER no page script at all:
 *     <form data-leads-kind="newsletter">   (optional: data-leads-kind-from="tier", data-leads-success="...")
 *   OR, because inline scripts run before deferred ones, wire the form once the DOM is ready:
 *     document.addEventListener('DOMContentLoaded', function () {
 *       MoltbotLeads.wire(document.getElementById('memo-form'), { kind: 'space-memo-quick' });
 *     });
 *   A wired form needs: an email field (name="email", or any type="email" input); optional name, company, message
 *   and tier fields; the honeypot, kept visually hidden, with the attributes that tell password managers to skip it:
 *     <input name="website" type="text" tabindex="-1" autocomplete="off"
 *            data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other">
 *   and an element with data-leads-status and aria-live="polite" (inside the form, or data-leads-status="<form id>"
 *   anywhere on the page; one is added to the form if missing). Other named fields travel inside "extra".
 *
 * API: window.MoltbotLeads
 *   submit({kind, email, name, company, message, tier, extra, website}) returns a Promise that never rejects:
 *     {ok: true}          the endpoint answered HTTP 2xx and, if it sent JSON, the JSON did not report an error;
 *                         or the honeypot "website" was filled (then nothing is sent)
 *     {ok: false, reason} reason is 'not_configured' | 'invalid_email' | 'network' (this includes the 10 s timeout,
 *                         so the lead may still have arrived) | 'http_<status>' | 'rejected' (a 2xx JSON answer with
 *                         ok:false, success:false, an error, a non-empty errors list or status "error"/"fail")
 *                         | 'unexpected_response' (a 2xx HTML page, such as a login page behind a wrong URL) | 'error'
 *     POST body (JSON): {kind, email, name, company, message, tier, extra, page, ts, referrer}
 *     An optional second argument {timeoutMs} shortens the 10 s timeout (used by the tests).
 *   fallbackMessage(kind[, reason]): honest, kind-specific text for any result that is not ok. Never a fake success.
 *   isConfigured(): true once LEADS_ENDPOINT holds a real http(s) URL and no LEADS_HEADERS value is still a
 *     YOUR_... placeholder.
 *   wire(form, {kind, kindFrom, success, onResult, extra, reset}) returns {form, send()} or null.
 *     kindFrom: a field name (or function (form, submitter)) whose value picks the kind. A full kind works, and so
 *       does a short value: "quick" with kind "space-memo" gives "space-memo-quick".
 *     success: text, or function (result, kind), shown only when ok === true. Messages are plain text.
 *     onResult(result, kind, form) runs after every attempt. extra: object (or function (form)) merged into "extra".
 *     reset: false keeps the fields after a success. While a form is busy its submit buttons are disabled and
 *     read "Sending...". For styling, the status element gets data-leads-state:
 *     sending | success | fallback | invalid.
 *     A filled honeypot sends nothing and never shows success. Autofill can fill it by mistake, so the form keeps
 *     what was typed, empties the trap and shows the not-saved text; onResult gets {ok: true, dropped: true}.
 *   Kinds: space-memo-quick, space-memo-full, space-memo-custom, v8-early-access, v7-orbital-intent, contact,
 *     enterprise, partner, newsletter, waitlist.
 * Privacy: only the reason code is ever logged; no cookies are sent; nothing is stored in the browser.
 *
 * Supabase table for the endpoint above (run once in the SQL editor):
 *   create table public.leads (id bigint generated always as identity primary key,
 *     created_at timestamptz default now(), kind text, email text, name text, company text, message text,
 *     tier text, extra jsonb, page text, ts timestamptz, referrer text);
 *   alter table public.leads enable row level security;
 *   grant insert on table public.leads to anon;
 *   create policy "anyone can add a lead" on public.leads for insert to anon with check (true);
 *   (There is no select policy, so the publishable key cannot read leads back.)
 * ------------------------------------------------------------------------------------------------------------- */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  var TIMEOUT_MS = 10000;
  var SENDING = 'Sending\u2026';
  var INVALID_EMAIL = 'Please enter a valid email address, like name@example.com.';
  var STANDARD = { email: 1, name: 1, company: 1, message: 1, tier: 1, website: 1 };
  var EMAIL_RE = /^[^\s@<>()\[\]\\,;:"]{1,64}@(?:[^\s@<>()\[\]\\,;:".]+\.)+[^\s@<>()\[\]\\,;:".]{2,}$/;
  var hasOwn = Object.prototype.hasOwnProperty;

  /* What each kind of form is about, so every message names the right thing. */
  var KINDS = {
    'space-memo-quick': {
      thanks: 'Thanks for your interest in the quick feasibility memo!',
      inbox: 'Our order inbox', item: 'your order', note: 'No payment was taken.'
    },
    'space-memo-full': {
      thanks: 'Thanks for your interest in the full feasibility memo!',
      inbox: 'Our order inbox', item: 'your order', note: 'No payment was taken.'
    },
    'space-memo-custom': {
      thanks: 'Thanks for your interest in a custom memo!',
      inbox: 'Our order inbox', item: 'your request', note: 'No payment was taken.'
    },
    'v8-early-access': {
      thanks: 'Thanks for your interest in early access!',
      inbox: 'Our early-access list', item: 'your request'
    },
    'v7-orbital-intent': {
      thanks: 'Thanks for your interest in orbital GPU-hours!',
      inbox: 'Our request inbox', item: 'your request'
    },
    'contact': { thanks: 'Thanks for getting in touch!', inbox: 'Our inbox', item: 'your message' },
    'enterprise': { thanks: 'Thanks for your enterprise request!', inbox: 'Our inbox', item: 'your request' },
    'partner': { thanks: 'Thanks for your interest in partnering with us!', inbox: 'Our inbox', item: 'your request' },
    'newsletter': {
      thanks: 'Thanks for your interest in our newsletter!',
      inbox: 'Our mailing list', item: 'your email address'
    },
    'waitlist': {
      thanks: 'Thanks for your interest in MoltBot Cloud!',
      inbox: 'Our waitlist', item: 'your email address'
    }
  };
  var GENERIC = { thanks: 'Thanks for your interest!', inbox: 'Our inbox', item: 'your request' };

  function has(obj, key) {
    return obj !== null && obj !== undefined && hasOwn.call(obj, key);
  }

  /* Any value to a trimmed, length-capped string. Single-line fields lose control characters. */
  function clean(value, max, multiLine) {
    if (value === null || value === undefined) return '';
    var text;
    try { text = String(value); } catch (e) { return ''; }
    text = multiLine ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      : text.replace(/[\u0000-\u001f\u007f]+/g, ' ');
    text = text.replace(/^\s+|\s+$/g, '');
    return text.length > max ? text.slice(0, max) : text;
  }

  function validEmail(email) {
    return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
  }

  function endpoint() {
    return typeof LEADS_ENDPOINT === 'string' ? LEADS_ENDPOINT.replace(/^\s+|\s+$/g, '') : '';
  }

  /* A header value still holding a placeholder such as sb_publishable_YOUR_KEY would make every lead fail. */
  function placeholderHeader() {
    try {
      var custom = typeof LEADS_HEADERS === 'object' && LEADS_HEADERS ? LEADS_HEADERS : {};
      for (var key in custom) {
        if (hasOwn.call(custom, key) && custom[key] !== null && custom[key] !== undefined &&
          /YOUR[_-]/.test(String(custom[key]))) return true;
      }
    } catch (e) { /* unreadable headers: leave the decision to buildHeaders() */ }
    return false;
  }

  function isConfigured() {
    var url = endpoint();
    return /^https?:\/\/[^\s\/?#]+(?:[\/?#]\S*)?$/i.test(url) && !/YOUR[_-]/.test(url) && !placeholderHeader();
  }

  function buildHeaders() {
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    var custom = typeof LEADS_HEADERS === 'object' && LEADS_HEADERS ? LEADS_HEADERS : {};
    for (var key in custom) {
      if (!hasOwn.call(custom, key) || custom[key] === null || custom[key] === undefined) continue;
      for (var existing in headers) {
        if (hasOwn.call(headers, existing) && existing.toLowerCase() === key.toLowerCase()) delete headers[existing];
      }
      headers[key] = String(custom[key]);
    }
    return headers;
  }

  function cleanExtra(extra) {
    if (extra === null || extra === undefined || extra === '') return null;
    if (typeof extra === 'function' || typeof extra === 'symbol') return null;
    if (typeof extra !== 'object') return { value: clean(extra, 2000, true) };
    try {
      var json = JSON.stringify(extra);
      if (typeof json !== 'string' || json === '{}' || json === '[]') return null;
      return json.length > 10000 ? { truncated: true } : JSON.parse(json);
    } catch (e) {
      return null; /* circular or not serialisable: send the lead without it */
    }
  }

  function buildPayload(data, email) {
    var loc = root.location;
    var doc = root.document;
    return {
      kind: clean(data.kind, 64) || 'contact',
      email: email,
      name: clean(data.name, 200),
      company: clean(data.company, 200),
      message: clean(data.message, 5000, true),
      tier: clean(data.tier, 100),
      extra: cleanExtra(data.extra),
      page: clean(loc && loc.pathname, 500),
      ts: new Date().toISOString(),
      referrer: clean(doc && doc.referrer, 1000)
    };
  }

  /* Logs the reason code only, never what a visitor typed. */
  function warn(reason) {
    try {
      var c = root.console;
      if (c && typeof c.warn === 'function') {
        c.warn('[MoltbotLeads] Not saved (' + reason + ').' +
          (reason === 'not_configured'
            ? ' Paste a real endpoint into LEADS_ENDPOINT, and any key into LEADS_HEADERS, at the top of leads.js.' : ''));
      }
    } catch (e) { /* ignore */ }
  }

  function failed(reason) {
    warn(reason);
    return { ok: false, reason: reason };
  }

  /* A 2xx JSON answer can still say no: {"ok":false}, {"success":false}, {"error":...}, a non-empty "errors" list,
     or {"status":"error"|"fail"}. An empty or unreadable body is not a refusal (Supabase return=minimal is empty). */
  function refused(text) {
    var b = null;
    try { b = text ? JSON.parse(text) : null; } catch (e) { return false; }
    if (!b || typeof b !== 'object') return false;
    return b.ok === false || b.success === false ||
      (b.error !== undefined && b.error !== null && b.error !== false && b.error !== '') ||
      (Object.prototype.toString.call(b.errors) === '[object Array]' && b.errors.length > 0) ||
      (typeof b.status === 'string' && /^(error|fail|failed|failure)$/i.test(b.status));
  }

  /* POST with a hard timeout that also covers reading the answer. Resolves {ok:true} only for a 2xx answer that is
     not an HTML page and not a JSON refusal. Never rejects. */
  function post(url, headers, body, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      var controller = null;
      var request;
      function finish(result) {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          try { clearTimeout(timer); } catch (e) { /* ignore */ }
          timer = null;
        }
        resolve(result);
      }
      if (typeof fetch !== 'function') {
        finish({ ok: false, reason: 'network' });
        return;
      }
      try {
        if (typeof AbortController === 'function') controller = new AbortController();
      } catch (e) { controller = null; }
      try {
        timer = setTimeout(function () {
          timer = null;
          try { if (controller) controller.abort(); } catch (e) { /* ignore */ }
          finish({ ok: false, reason: 'network' });
        }, ms);
      } catch (e) { timer = null; }
      var init = { method: 'POST', headers: headers, body: body, mode: 'cors', credentials: 'omit' };
      if (controller) init.signal = controller.signal;
      try {
        request = fetch(url, init);
      } catch (e) {
        finish({ ok: false, reason: 'network' });
        return;
      }
      Promise.resolve(request).then(function (response) {
        var status = response && typeof response.status === 'number' ? response.status : 0;
        if (status < 200 || status >= 300) {
          finish({ ok: false, reason: status > 0 ? 'http_' + status : 'network' });
          return;
        }
        var type = '';
        try { type = String(response.headers.get('content-type') || '').toLowerCase(); } catch (e) { type = ''; }
        if (type.indexOf('text/html') !== -1) { /* a login or app page, often reached through a wrong URL */
          finish({ ok: false, reason: 'unexpected_response' });
          return;
        }
        if (type.indexOf('json') === -1 || typeof response.text !== 'function') {
          finish({ ok: true });
          return;
        }
        var reading;
        try { reading = response.text(); } catch (e) {
          finish({ ok: true });
          return;
        }
        Promise.resolve(reading).then(function (text) {
          finish(refused(text) ? { ok: false, reason: 'rejected' } : { ok: true });
        }, function () {
          finish({ ok: true }); /* the 2xx status already arrived; only the body could not be read */
        });
      }, function () {
        finish({ ok: false, reason: 'network' });
      });
    });
  }

  function submit(data, options) {
    return new Promise(function (resolve) {
      try {
        var d = data && typeof data === 'object' ? data : {};
        if (clean(d.website, 2000) !== '') { /* honeypot filled: a bot. Drop it quietly. */
          resolve({ ok: true });
          return;
        }
        var email = clean(d.email, 320);
        if (!validEmail(email)) {
          resolve({ ok: false, reason: 'invalid_email' });
          return;
        }
        if (!isConfigured()) {
          resolve(failed('not_configured'));
          return;
        }
        var ms = options && typeof options === 'object' && Number(options.timeoutMs) > 0
          ? Math.min(Number(options.timeoutMs), 60000) : TIMEOUT_MS;
        post(endpoint(), buildHeaders(), JSON.stringify(buildPayload(d, email)), ms).then(function (result) {
          resolve(result.ok ? result : failed(result.reason));
        });
      } catch (e) {
        resolve(failed('error'));
      }
    });
  }

  function wording(kind) {
    var key = clean(kind, 64).toLowerCase();
    return has(KINDS, key) ? KINDS[key] : GENERIC;
  }

  function fallbackMessage(kind, reason) {
    try {
      if (reason && typeof reason === 'object') reason = reason.reason;
      reason = typeof reason === 'string' ? reason : '';
      if (reason === 'invalid_email') return INVALID_EMAIL;
      var w = wording(kind);
      var note = w.note ? ' ' + w.note : '';
      if (reason === 'not_configured' || (!reason && !isConfigured())) {
        return w.thanks + ' ' + w.inbox + ' is still being set up, so ' + w.item + ' could not be saved yet.' +
          note + ' Please check back soon and try again.';
      }
      /* After a timeout, a blocked answer or an unexpected page the lead may still have arrived: say so plainly. */
      var unsure = reason === 'network' || reason === 'unexpected_response';
      return w.thanks + (unsure ? ' We could not confirm that we received ' + w.item + '.'
        : ' We could not save ' + w.item + ' just now.') + note +
        (reason === 'network' ? ' Please check your connection and try again in a few minutes.'
          : ' Please try again in a few minutes.');
    } catch (e) {
      return 'Thanks! This could not be saved yet. Please check back soon and try again.';
    }
  }

  function successDefault(kind) {
    var item = wording(kind).item;
    return 'Thanks! ' + item.charAt(0).toUpperCase() + item.slice(1) + ' was saved.';
  }

  /* ---- Form wiring ---- */

  function attr(el, name) {
    try {
      return el && typeof el.getAttribute === 'function' ? (el.getAttribute(name) || '') : '';
    } catch (e) { return ''; }
  }

  function setAttr(el, name, value) {
    try { el.setAttribute(name, value); } catch (e) { /* ignore */ }
  }

  function dropAttr(el, name) {
    try { el.removeAttribute(name); } catch (e) { /* ignore */ }
  }

  function find(scope, selector) {
    try { return scope.querySelector(selector); } catch (e) { return null; }
  }

  function isButton(el) {
    var tag = String(el.tagName || '').toLowerCase();
    var type = String(el.type || '').toLowerCase();
    return tag === 'button' || (tag === 'input' && /^(submit|button|reset|image)$/.test(type));
  }

  function named(form, name) {
    try {
      return form.elements && typeof form.elements.namedItem === 'function' ? form.elements.namedItem(name) : null;
    } catch (e) { return null; }
  }

  /* Value of one field, or of a group of fields sharing a name (radio buttons). Buttons only count as submitter. */
  function readValue(el) {
    try {
      if (!el) return '';
      var i;
      if (!el.tagName && typeof el.length === 'number') {
        for (i = 0; i < el.length; i++) {
          if (el[i] && (el[i].type === 'radio' || el[i].type === 'checkbox') && el[i].checked) {
            return String(el[i].value);
          }
        }
        for (i = 0; i < el.length; i++) {
          if (el[i] && el[i].type !== 'radio' && el[i].type !== 'checkbox' && !isButton(el[i]) && el[i].value) {
            return String(el[i].value);
          }
        }
        return '';
      }
      if (isButton(el)) return '';
      if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) return '';
      return el.value === null || el.value === undefined ? '' : String(el.value);
    } catch (e) { return ''; }
  }

  function fieldValue(form, name, submitter) {
    if (submitter && submitter.name === name) return clean(submitter.value, 2000);
    return readValue(named(form, name));
  }

  function addField(out, name, value) {
    if (hasOwn.call(out, name)) {
      if (Object.prototype.toString.call(out[name]) !== '[object Array]') out[name] = [out[name]];
      out[name].push(value);
      return 0;
    }
    out[name] = value;
    return 1;
  }

  /* Every other named field (a deadline, a budget, calculator inputs...) goes into "extra". */
  function collectExtra(form, opts, skip, submitter) {
    var out = {};
    var count = 0;
    var els = form.elements || [];
    for (var i = 0; i < els.length && count < 40; i++) {
      var el = els[i];
      var name = el && typeof el.name === 'string' ? el.name : '';
      if (!name || name === '__proto__' || hasOwn.call(STANDARD, name) || el === skip || el.disabled) continue;
      var tag = String(el.tagName || '').toLowerCase();
      var type = String(el.type || '').toLowerCase();
      if (isButton(el) || tag === 'fieldset' || tag === 'object' || tag === 'output') continue;
      if (/^(file|password)$/.test(type)) continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      var value;
      if (tag === 'select' && el.multiple) {
        value = [];
        for (var j = 0; j < el.options.length; j++) {
          if (el.options[j].selected) value.push(clean(el.options[j].value, 2000));
        }
      } else {
        value = clean(el.value, 2000, tag === 'textarea');
      }
      count += addField(out, name, value);
    }
    if (submitter && submitter.name && submitter.name !== '__proto__' && !hasOwn.call(STANDARD, submitter.name)) {
      count += addField(out, submitter.name, clean(submitter.value, 2000));
    }
    var given = opts.extra;
    if (typeof given === 'function') {
      try { given = given(form); } catch (e) { given = null; }
    }
    if (given && typeof given === 'object') {
      for (var key in given) {
        if (hasOwn.call(given, key) && key !== '__proto__') {
          out[key] = given[key];
          count++;
        }
      }
    }
    return count ? out : null;
  }

  /* "space-memo-quick" stays as it is; "quick" becomes "space-memo-quick" (with kind "space-memo", or by suffix). */
  function matchKind(value, base) {
    if (!value) return '';
    var v = value.toLowerCase();
    var b = base.toLowerCase();
    if (has(KINDS, v)) return v;
    if (b && has(KINDS, b + '-' + v)) return b + '-' + v;
    var hit = '';
    var hits = 0;
    for (var k in KINDS) {
      if (has(KINDS, k) && k.slice(-(v.length + 1)) === '-' + v) {
        hit = k;
        hits++;
      }
    }
    return hits === 1 ? hit : '';
  }

  function resolveKind(form, opts, submitter) {
    var base = clean(opts.kind, 64) || clean(attr(form, 'data-leads-kind'), 64);
    var value = '';
    try {
      if (typeof opts.kindFrom === 'function') {
        value = clean(opts.kindFrom(form, submitter), 64);
      } else if (typeof opts.kindFrom === 'string' && opts.kindFrom) {
        value = submitter && submitter.name === opts.kindFrom ? submitter.value
          : readValue(named(form, opts.kindFrom) || find(form, opts.kindFrom));
        value = clean(value, 64);
      }
    } catch (e) { value = ''; }
    return matchKind(value, base) || base || value || 'contact';
  }

  function findStatus(form, create) {
    var doc = root.document;
    var el = find(form, '[data-leads-status]');
    if (!el && form.id && doc) {
      el = find(doc, '[data-leads-status="' + String(form.id).replace(/["\\]/g, '\\$&') + '"]');
    }
    if (!el && create && doc && typeof doc.createElement === 'function') {
      try {
        el = doc.createElement('p');
        el.setAttribute('data-leads-status', '');
        el.setAttribute('role', 'status');
        form.appendChild(el);
      } catch (e) { el = null; }
    }
    if (el && !attr(el, 'aria-live')) setAttr(el, 'aria-live', 'polite');
    return el;
  }

  /* Plain text only. data-leads-state lets pages style it: sending | success | fallback | invalid. */
  function show(el, text, state) {
    if (!el) return;
    try {
      el.textContent = text;
      el.setAttribute('data-leads-state', state);
      if (el.hidden) el.hidden = false;
    } catch (e) { /* ignore */ }
  }

  function markInvalid(el, on) {
    if (!el || typeof el.setAttribute !== 'function') return;
    if (on) {
      setAttr(el, 'aria-invalid', 'true');
      setAttr(el, 'data-leads-invalid', '');
      try { el.focus(); } catch (e) { /* ignore */ }
    } else if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-leads-invalid')) {
      dropAttr(el, 'aria-invalid');
      dropAttr(el, 'data-leads-invalid');
    }
  }

  function lock(form) {
    var locked = [];
    var els = form.elements || [];
    for (var i = 0; i < els.length; i++) {
      var b = els[i];
      if (!b) continue;
      var tag = String(b.tagName || '').toLowerCase();
      var type = String(b.type || '').toLowerCase();
      var isSubmit = (tag === 'button' && type === 'submit') ||
        (tag === 'input' && (type === 'submit' || type === 'image'));
      if (!isSubmit || b.disabled) continue;
      try {
        locked.push({ el: b, html: tag === 'button' ? b.innerHTML : null, value: tag === 'input' ? b.value : null });
        if (tag === 'button') b.textContent = SENDING;
        else if (type === 'submit') b.value = SENDING;
        b.disabled = true;
      } catch (e) { /* ignore */ }
    }
    return locked;
  }

  function unlock(locked) {
    for (var i = 0; i < locked.length; i++) {
      try {
        if (locked[i].html !== null) locked[i].el.innerHTML = locked[i].html;
        if (locked[i].value !== null) locked[i].el.value = locked[i].value;
        locked[i].el.disabled = false;
      } catch (e) { /* ignore */ }
    }
  }

  function successText(opts, kind, result) {
    var text = opts.success;
    if (typeof text === 'function') {
      try { text = text(result, kind); } catch (e) { text = ''; }
    }
    return clean(text, 1000, true) || successDefault(kind);
  }

  function report(opts, result, kind, form) {
    if (typeof opts.onResult !== 'function') return;
    try { opts.onResult(result, kind, form); } catch (e) { /* a page callback must not break the form */ }
  }

  function send(form, state, submitter) {
    if (state.busy) return state.pending;
    var opts = state.opts;
    var status = findStatus(form, true);
    var kind = resolveKind(form, opts, submitter);
    var emailField = named(form, 'email') || find(form, 'input[type="email"]');
    var email = clean(readValue(emailField), 320);
    if (!validEmail(email)) {
      var invalid = { ok: false, reason: 'invalid_email' };
      show(status, INVALID_EMAIL, 'invalid');
      markInvalid(emailField, true);
      report(opts, invalid, kind, form);
      return Promise.resolve(invalid);
    }
    markInvalid(emailField, false);
    var data = {
      kind: kind,
      email: email,
      name: fieldValue(form, 'name', submitter),
      company: fieldValue(form, 'company', submitter),
      message: fieldValue(form, 'message', submitter),
      tier: fieldValue(form, 'tier', submitter),
      extra: collectExtra(form, opts, emailField, submitter),
      website: fieldValue(form, 'website', submitter)
    };
    if (clean(data.website, 2000) !== '') {
      /* Honeypot filled. Nothing is sent and bots get no signal, but autofill can fill it by mistake, so a person
         keeps what they typed, sees the honest not-saved text and can send again with the trap emptied. */
      var trap = named(form, 'website');
      try { if (trap && trap.tagName) trap.value = ''; } catch (e) { /* ignore */ }
      var dropped = { ok: true, dropped: true };
      show(status, fallbackMessage(kind, isConfigured() ? 'error' : 'not_configured'), 'fallback');
      report(opts, dropped, kind, form);
      return Promise.resolve(dropped);
    }
    state.busy = true;
    var locked = lock(form);
    setAttr(form, 'aria-busy', 'true');
    show(status, SENDING, 'sending');
    state.pending = submit(data).then(function (result) {
      state.busy = false;
      state.pending = null;
      unlock(locked);
      dropAttr(form, 'aria-busy');
      if (result && result.ok === true) {
        show(status, successText(opts, kind, result), 'success');
        if (opts.reset !== false) {
          try { form.reset(); } catch (e) { /* ignore */ }
        }
      } else {
        show(status, fallbackMessage(kind, result && result.reason), 'fallback');
      }
      report(opts, result, kind, form);
      return result;
    });
    return state.pending;
  }

  function assign(target, source) {
    for (var key in source) {
      if (hasOwn.call(source, key) && source[key] !== undefined) target[key] = source[key];
    }
    return target;
  }

  function findForm(form) {
    if (typeof form !== 'string') return form;
    var doc = root.document;
    if (!doc) return null;
    try { return doc.getElementById(form) || doc.querySelector(form); } catch (e) { return null; }
  }

  function wire(form, options) {
    try {
      form = findForm(form);
      if (!form || typeof form.addEventListener !== 'function' || !form.elements) return null;
      var opts = options && typeof options === 'object' ? options : {};
      var state = form.__moltbotLeads;
      if (state) { /* wired before: update the options, never add a second listener */
        assign(state.opts, opts);
        return state.handle;
      }
      state = { opts: assign({}, opts), busy: false, pending: null };
      state.handle = { form: form, send: function () { return send(form, state, null); } };
      try {
        Object.defineProperty(form, '__moltbotLeads', { value: state, configurable: true });
      } catch (e) { form.__moltbotLeads = state; }
      findStatus(form, true); /* the live region exists before it changes, so screen readers announce it */
      form.addEventListener('submit', function (event) {
        try {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
        } catch (e) { /* ignore */ }
        send(form, state, event && event.submitter);
      });
      form.addEventListener('input', function (event) {
        markInvalid(event && event.target, false);
      });
      return state.handle;
    } catch (e) {
      return null;
    }
  }

  /* <form data-leads-kind="..."> needs no page script. Safe with defer, and in <head> without it. */
  function autoWire() {
    var doc = root.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    var run = function () {
      try {
        var forms = doc.querySelectorAll('form[data-leads-kind]');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].__moltbotLeads) continue;
          wire(forms[i], {
            kind: attr(forms[i], 'data-leads-kind') || undefined,
            kindFrom: attr(forms[i], 'data-leads-kind-from') || undefined,
            success: attr(forms[i], 'data-leads-success') || undefined
          });
        }
      } catch (e) { /* ignore */ }
    };
    if (doc.readyState === 'loading' && typeof doc.addEventListener === 'function') {
      doc.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  root.MoltbotLeads = {
    submit: submit,
    fallbackMessage: fallbackMessage,
    isConfigured: isConfigured,
    wire: wire
  };
  autoWire();
})();
