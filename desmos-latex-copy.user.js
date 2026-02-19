// ==UserScript==
// @name         Desmos Scientific → Copy LaTeX
// @namespace    https://desmos.com/
// @version      1.2.0
// @description  Adds a button + shortcut to copy all expressions from Desmos Scientific Calculator as LaTeX.
// @match        https://www.desmos.com/scientific*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'desmos-copy-latex-btn';
  const HOTKEY = 'Alt+Shift+L';

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function isBalanced(text, openChar, closeChar) {
    let depth = 0;
    for (const ch of text) {
      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth < 0) return false;
      }
    }
    return depth === 0;
  }

  function isCompleteLatex(text) {
    if (!text) return false;
    if (!isBalanced(text, '{', '}')) return false;
    if (!isBalanced(text, '(', ')')) return false;
    if (/\\(left|right)$/.test(text)) return false;
    if (/[+\-*/^_=,]$/.test(text)) return false;
    return true;
  }

  function readDeep(obj, path) {
    let current = obj;
    for (const part of path) {
      if (!current || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  function extractEvaluatedValue(node) {
    const candidates = [
      ['evaluation', 'value'],
      ['evaluation', 'displayValue'],
      ['evaluation', 'numericValue'],
      ['computedValue'],
      ['value'],
      ['result'],
      ['_value']
    ];

    for (const path of candidates) {
      const value = readDeep(node, path);
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return null;
  }

  function formatOutputLine(latex, value) {
    return value ? `${latex} = ${value}` : latex;
  }

  function maybePushLine(lines, seen, nodeLogs, latex, value, meta) {
    const normalizedLatex = normalizeText(latex);
    if (!normalizedLatex || !isCompleteLatex(normalizedLatex)) return;

    const output = formatOutputLine(normalizedLatex, normalizeText(value) || null);
    if (seen.has(output)) return;

    seen.add(output);
    lines.push(output);
    nodeLogs.push({ latex: normalizedLatex, value: value ?? null, output, ...meta });
  }

  function collectFromExpressionsApi(lines, seen, nodeLogs) {
    if (!window.Calc || typeof window.Calc.getExpressions !== 'function') return;
    const expressions = window.Calc.getExpressions();
    if (!Array.isArray(expressions)) return;

    for (let i = 0; i < expressions.length; i += 1) {
      const item = expressions[i];
      if (!item || typeof item !== 'object') continue;
      maybePushLine(lines, seen, nodeLogs, item.latex, extractEvaluatedValue(item), {
        source: 'Calc.getExpressions',
        index: i,
        id: item.id || null
      });
    }
  }

  function collectFromControllerModels(lines, seen, nodeLogs) {
    const controller = window.Calc?.controller;
    if (!controller || typeof controller.getAllItemModels !== 'function') return;
    const models = controller.getAllItemModels();
    if (!Array.isArray(models)) return;

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      if (!model || typeof model !== 'object') continue;
      maybePushLine(lines, seen, nodeLogs, model.latex, extractEvaluatedValue(model), {
        source: 'Calc.controller.getAllItemModels',
        index: i,
        id: model.id || null
      });
    }
  }

  function findHighestStackNode(root, rootName, maxNodes = 5000) {
    const queue = [{ value: root, path: rootName }];
    const visited = new Set();
    let best = null;

    while (queue.length && visited.size < maxNodes) {
      const current = queue.shift();
      const node = current.value;
      if (!node || (typeof node !== 'object' && typeof node !== 'function')) continue;
      if (visited.has(node)) continue;
      visited.add(node);

      if (typeof node._stack === 'number' && Number.isFinite(node._stack)) {
        if (!best || node._stack > best.stack) {
          best = { stack: node._stack, node, path: current.path };
        }
      }

      for (const key of Object.keys(node)) {
        let value;
        try {
          value = node[key];
        } catch {
          continue;
        }

        if (value && (typeof value === 'object' || typeof value === 'function')) {
          const childPath = Array.isArray(node) ? `${current.path}[${key}]` : `${current.path}.${key}`;
          queue.push({ value, path: childPath });
        }
      }
    }

    return best;
  }

  function getExpressionListFromNode(node) {
    const candidates = [node?.expressions, node?.items, node?.list, node?.models];
    for (const value of candidates) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') {
        const values = Object.values(value);
        if (values.length && values.every((v) => v && typeof v === 'object')) return values;
      }
    }
    return [];
  }

  function collectFromHighestStack(root, rootName, lines, seen, nodeLogs) {
    const highest = findHighestStackNode(root, rootName);
    if (!highest) return;

    const expressions = getExpressionListFromNode(highest.node);
    for (let i = 0; i < expressions.length; i += 1) {
      const entry = expressions[i];
      if (!entry || typeof entry !== 'object') continue;
      maybePushLine(lines, seen, nodeLogs, entry.latex, extractEvaluatedValue(entry), {
        source: 'deepScan.highestStack',
        stack: highest.stack,
        stackPath: highest.path,
        expressionIndex: i,
        id: entry.id || null
      });
    }
  }

  function getLatexLinesWithSources() {
    const lines = [];
    const seen = new Set();
    const nodeLogs = [];

    collectFromExpressionsApi(lines, seen, nodeLogs);
    collectFromControllerModels(lines, seen, nodeLogs);

    // Deep fallback: only highest _stack node, then iterate expressions from that node.
    collectFromHighestStack(window.Calc, 'window.Calc', lines, seen, nodeLogs);
    collectFromHighestStack(window.Desmos, 'window.Desmos', lines, seen, nodeLogs);

    return { lines, nodeLogs };
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  function toast(message, isError = false) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:99999',
      'padding:10px 14px',
      'border-radius:8px',
      'font:12px/1.4 sans-serif',
      'color:#fff',
      `background:${isError ? '#a61b1b' : '#1f6d2c'}`,
      'box-shadow:0 4px 12px rgba(0,0,0,.25)'
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  async function copyAllLatex() {
    const { lines, nodeLogs } = getLatexLinesWithSources();

    if (!lines.length) {
      toast('No complete LaTeX expressions found yet.', true);
      return;
    }

    const payload = lines.join('\n');
    try {
      await copyText(payload);
      toast(`Copied ${lines.length} expression(s).`);
      console.group('[Desmos Copy LaTeX] Nodes found');
      console.table(nodeLogs);
      console.log('Copied payload:\n' + payload);
      console.groupEnd();
    } catch (error) {
      console.error('[Desmos Copy LaTeX] Copy failed:', error);
      toast('Copy failed. See console for details.', true);
    }
  }

  function addButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Copy LaTeX';
    btn.title = `Copy all expressions as LaTeX (${HOTKEY})`;
    btn.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:16px',
      'z-index:99999',
      'background:#2b72ff',
      'color:#fff',
      'border:none',
      'padding:8px 12px',
      'border-radius:8px',
      'font:12px/1 sans-serif',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,.25)'
    ].join(';');

    btn.addEventListener('click', copyAllLatex);
    document.body.appendChild(btn);
  }

  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      copyAllLatex();
    }
  });

  addButton();
  const timer = setInterval(addButton, 2000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
})();
