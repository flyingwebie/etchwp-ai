/*
 * etchwp-ai Bridge — in-page agent.
 *
 * Runs on any view a capable user opens, but stays dormant until window.etch is
 * present. Once the Etch builder is detected it connects to the etchwp-ai MCP
 * server (directly to a loopback ws(s) server, or via a shared relay) and
 * relays the SAME allowlisted window.etch Public API the CDP transport drives.
 *
 * The page functions and allowlist below MIRROR the server's
 * src/bridge/page-functions.ts and src/bridge/allowlist.ts — keep them in sync.
 */
(function () {
	'use strict';

	var CFG = window.EtchwpAiBridge || {};

	// --- mirror of src/bridge/allowlist.ts (defence in depth) ----------------
	var ALLOWLIST = {
		root: ['saveAsync'],
		blocks: ['select', 'deselect', 'getSelectedId', 'getJson', 'getTree', 'find', 'create', 'delete', 'duplicate', 'move', 'replace', 'update', 'setText', 'rename', 'getAttribute', 'setAttribute', 'removeAttribute', 'addClass', 'removeClass', 'hasClass', 'enterComponentEditMode', 'exitComponentEditMode', 'isInComponentEditMode', 'saveComponentEditModeAsync'],
		styles: ['list', 'create', 'update', 'delete', 'listVariables', 'getVariable', 'setVariable', 'removeVariable'],
		stylesheets: ['list', 'get', 'createAsync', 'updateAsync', 'appendAsync', 'deleteAsync', 'listCustomMedia', 'addCustomMediaAsync'],
		components: ['list', 'getJson', 'createAsync', 'updateAsync', 'deleteAsync'],
		loops: ['getAll', 'add', 'update', 'delete', 'findLoop', 'setForBlock'],
		navigation: ['goTo', 'getCurrentPlace', 'getPlaces', 'openPostAsync', 'openTemplateAsync', 'getActivePostId', 'isEditingTemplate', 'listPostsAsync', 'listTemplatesAsync'],
		fields: ['listGroupsAsync', 'getGroupAsync', 'createGroupAsync', 'updateGroupAsync', 'deleteGroupAsync', 'addFieldAsync', 'updateFieldAsync', 'removeFieldAsync', 'getValuesAsync', 'getValueAsync', 'setValueAsync', 'setValuesAsync', 'deleteValueAsync'],
		ui: ['getColorScheme', 'setColorScheme', 'toggleColorScheme', 'isInterfaceHidden', 'setInterfaceHidden', 'toggleInterface', 'exitToWordPress'],
		history: ['undo', 'redo', 'canUndo', 'canRedo']
	};

	function isAllowed(domain, method) {
		return Object.prototype.hasOwnProperty.call(ALLOWLIST, domain) && ALLOWLIST[domain].indexOf(method) !== -1;
	}

	// --- mirror of src/bridge/page-functions.ts ------------------------------
	function evalWrapper(domain, method, args) {
		var w = window;
		function fail(code, message) { return { ok: false, code: code, message: message }; }
		try {
			if (!w.etch) return fail('E_NO_ETCH', 'window.etch is not present on this page');
			var target = domain === 'root' ? w.etch : w.etch[domain];
			var fn = target && target[method];
			if (typeof fn !== 'function') return fail('E_FEATURE_MISSING', 'etch.' + domain + '.' + method + ' is not a function');
			var out = fn.apply(target, args || []);
			return Promise.resolve(out).then(
				function (value) { return { ok: true, value: value === undefined ? null : value }; },
				function (e) { return fail(e && typeof e.code === 'string' ? e.code : 'OPERATION_FAILED', String((e && e.message) || e)); }
			);
		} catch (e) {
			return fail(e && typeof e.code === 'string' ? e.code : 'OPERATION_FAILED', String((e && e.message) || e));
		}
	}

	function isAvailable() {
		return typeof window.etch !== 'undefined';
	}

	function readRootVariables() {
		var out = [];
		var seen = {};
		var sheets = Array.prototype.slice.call(document.styleSheets);
		for (var i = 0; i < sheets.length; i++) {
			var sheet = sheets[i], rules;
			try { rules = sheet.cssRules; } catch (e) { continue; }
			var rl = Array.prototype.slice.call(rules);
			for (var j = 0; j < rl.length; j++) {
				var styleRule = rl[j];
				if (!styleRule.selectorText) continue;
				var hitsRoot = styleRule.selectorText.split(',').some(function (s) { return s.trim() === ':root'; });
				if (!hitsRoot) continue;
				var props = Array.prototype.slice.call(styleRule.style);
				for (var k = 0; k < props.length; k++) {
					var prop = props[k];
					if (prop.indexOf('--') !== 0) continue;
					var key = prop + '@@' + (sheet.href || '');
					if (seen[key]) continue;
					seen[key] = true;
					out.push({ name: prop, value: styleRule.style.getPropertyValue(prop).trim(), stylesheetHref: sheet.href });
				}
			}
		}
		var names = {};
		out.forEach(function (v) { names[v.name] = true; });
		var computed = getComputedStyle(document.documentElement);
		var cprops = Array.prototype.slice.call(computed);
		for (var m = 0; m < cprops.length; m++) {
			var p = cprops[m];
			if (p.indexOf('--') === 0 && !names[p]) {
				out.push({ name: p, value: computed.getPropertyValue(p).trim(), stylesheetHref: null });
			}
		}
		return out;
	}

	function probeFeatures(manifest) {
		var w = window;
		var result = {};
		Object.keys(manifest || {}).forEach(function (domain) {
			result[domain] = {};
			var target = domain === 'root' ? w.etch : (w.etch && w.etch[domain]);
			(manifest[domain] || []).forEach(function (method) {
				result[domain][method] = typeof (target && target[method]) === 'function';
			});
		});
		return result;
	}

	// --- frame handling ------------------------------------------------------
	function handleCall(frame) {
		var id = frame.id;
		function reply(res) { send({ t: 'result', id: id, ok: res.ok, value: res.value, code: res.code, message: res.message }); }
		if (frame.kind === 'isAvailable') { reply({ ok: true, value: isAvailable() }); return; }
		if (frame.kind === 'readRootVariables') { reply({ ok: true, value: readRootVariables() }); return; }
		if (frame.kind === 'probeFeatures') { reply({ ok: true, value: probeFeatures(frame.manifest || {}) }); return; }
		if (frame.kind === 'eval') {
			if (!isAllowed(frame.domain, frame.method)) {
				reply({ ok: false, code: 'E_VALIDATION', message: "'" + frame.domain + '.' + frame.method + "' is not a documented Etch API operation" });
				return;
			}
			Promise.resolve(evalWrapper(frame.domain, frame.method, frame.args)).then(reply, function (e) {
				reply({ ok: false, code: 'OPERATION_FAILED', message: String((e && e.message) || e) });
			});
			return;
		}
		reply({ ok: false, code: 'E_VALIDATION', message: 'unknown call kind: ' + frame.kind });
	}

	// --- connection ----------------------------------------------------------
	var ws = null;
	var backoff = 1000;

	function endpoint() {
		if (CFG.mode === 'direct') {
			var proto = CFG.useWss ? 'wss' : 'ws';
			return proto + '://' + (CFG.host || '127.0.0.1') + ':' + (CFG.port || 9223);
		}
		return CFG.relayUrl || '';
	}

	function send(obj) {
		if (ws && ws.readyState === 1) {
			try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket dying */ }
		}
	}

	function sendHello() {
		send({
			t: 'hello',
			url: location.href,
			title: document.title,
			hasEtch: isAvailable(),
			etchVersion: (window.etch && window.etch.version) || null,
			apiVersion: (window.etch && window.etch.apiVersion) || null,
			token: CFG.token || undefined
		});
	}

	function connect() {
		var url = endpoint();
		if (!url) return; // misconfigured; nothing to do
		try { ws = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

		ws.onopen = function () {
			backoff = 1000;
			if (CFG.mode !== 'direct') {
				send({ t: 'join', role: 'agent', room: CFG.room || 'default', token: CFG.token || undefined });
			}
			sendHello();
		};
		ws.onmessage = function (ev) {
			var frame;
			try { frame = JSON.parse(ev.data); } catch (e) { return; }
			if (frame && frame.t === 'call') handleCall(frame);
		};
		ws.onclose = function () { scheduleReconnect(); };
		ws.onerror = function () { try { ws.close(); } catch (e) {} };
	}

	function scheduleReconnect() {
		ws = null;
		setTimeout(connect, backoff);
		backoff = Math.min(backoff * 2, 15000);
	}

	function notifyNavigated() {
		send({ t: 'navigated', url: location.href });
	}

	// SPA route changes (Etch builder is a single-page app).
	(function patchHistory() {
		var push = history.pushState, replace = history.replaceState;
		history.pushState = function () { var r = push.apply(this, arguments); notifyNavigated(); return r; };
		history.replaceState = function () { var r = replace.apply(this, arguments); notifyNavigated(); return r; };
		window.addEventListener('popstate', notifyNavigated);
	})();

	// Wait for window.etch, then connect. Re-poll forever (cheap) so opening the
	// builder later in the same page also works.
	var waited = 0;
	(function waitForEtch() {
		if (isAvailable()) { connect(); return; }
		waited += 500;
		if (waited > 600000) return; // give up after 10 min of no builder
		setTimeout(waitForEtch, 500);
	})();
})();
