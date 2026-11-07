/**
 * Front-end access gate.
 *
 * The page asks /api/health whether the deployment is protected. When
 * `auth.enabled` is true, a passphrase overlay blocks the UI until the key is
 * verified through /api/auth/check; the key is then reused for every API call.
 */
import { apiFetch, getAccessKey, saveAccessKey, forgetAccessKey } from './core/api.js';

let gate = null;
let form = null;
let input = null;
let errorEl = null;
let rememberEl = null;
let submitBtn = null;
let lockBtn = null;
let enabled = false;
let unlocked = false;
let bound = false;

function showError(message) {
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.classList.toggle('show', !!message);
}

function setGate(open, message) {
  if (!gate) return;
  gate.hidden = !open;
  gate.classList.toggle('open', open);
  document.body.classList.toggle('gate-locked', open);
  if (open) {
    if (input) input.value = '';
    showError(message || '');
    if (submitBtn) submitBtn.disabled = false;
    setTimeout(() => input && input.focus(), 120);
  } else {
    showError('');
  }
}

async function validate(key) {
  try {
    const res = await fetch('/api/auth/check', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: '{}',
    });
    if (res.status === 429) return 'rate';
    return res.ok ? 'ok' : 'bad';
  } catch (_) {
    return 'offline';
  }
}

function bind() {
  if (bound) return;
  bound = true;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) {
      showError('请输入访问密钥');
      input.focus();
      return;
    }
    submitBtn.disabled = true;
    submitBtn.classList.add('is-busy');
    showError('');
    const state = await validate(key);
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-busy');

    if (state === 'ok') {
      saveAccessKey(key, !!(rememberEl && rememberEl.checked));
      unlocked = true;
      setGate(false);
      window.dispatchEvent(new CustomEvent('qijing:unlocked'));
      return;
    }
    if (state === 'rate') {
      showError('尝试次数过多，请 1 分钟后再试');
    } else if (state === 'offline') {
      showError('无法连接服务器，请检查网络后重试');
    } else {
      showError('密钥不正确，请重新输入');
      input.select();
    }
    gate.classList.remove('shake');
    void gate.offsetWidth;
    gate.classList.add('shake');
  });

  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      forgetAccessKey();
      unlocked = false;
      setGate(true, '已锁定本设备，请重新输入访问密钥');
      window.dispatchEvent(new CustomEvent('qijing:unlocked', { detail: { locked: true } }));
    });
  }

  window.addEventListener('qijing:access-denied', () => {
    if (!enabled || gate.hidden === false) return;
    unlocked = false;
    forgetAccessKey();
    setGate(true, '访问密钥已失效，请重新验证');
  });
}

export async function initAccessGate() {
  gate = document.getElementById('accessGate');
  if (!gate) {
    enabled = false;
    unlocked = true;
    return { enabled, unlocked };
  }
  form = document.getElementById('gateForm');
  input = document.getElementById('gateKey');
  errorEl = document.getElementById('gateError');
  rememberEl = document.getElementById('gateRemember');
  submitBtn = document.getElementById('gateSubmit');
  lockBtn = document.getElementById('lockAccess');

  let health = null;
  try {
    const res = await apiFetch('/api/health');
    if (res.ok) health = await res.json();
  } catch (_) {
    /* offline preview: treat as unprotected */
  }

  enabled = !!(health && health.auth && health.auth.enabled);
  document.documentElement.dataset.secure = enabled ? 'on' : 'off';
  document.documentElement.dataset.storage = (health && health.storage) || 'memory';
  if (lockBtn) lockBtn.hidden = !enabled;

  bind();

  if (!enabled) {
    unlocked = true;
    setGate(false);
    return { enabled, unlocked };
  }

  const stored = getAccessKey();
  if (stored) {
    const state = await validate(stored);
    if (state === 'ok') {
      unlocked = true;
      setGate(false);
      return { enabled, unlocked };
    }
    if (state === 'bad') forgetAccessKey();
  }

  setGate(true, stored ? '访问密钥已失效，请重新验证' : '');
  return { enabled, unlocked: false };
}

export function isGateEnabled() {
  return enabled;
}

export function isUnlocked() {
  return unlocked;
}