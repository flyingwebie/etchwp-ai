/* etchwp-ai Bridge — settings page UX: mode gating, token generator, live env block, status poll. */
(function () {
	'use strict';
	var CFG = window.EtchwpAiBridgeAdmin || {};

	function $(sel) { return document.querySelector(sel); }
	function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

	// --- mode-gated fields ---------------------------------------------------
	function currentMode() {
		var direct = $('#etchwp-mode-direct');
		return direct && direct.checked ? 'direct' : 'relay';
	}
	function applyMode() {
		var mode = currentMode();
		$all('.etchwp-relay-only').forEach(function (el) { el.style.display = mode === 'relay' ? '' : 'none'; });
		$all('.etchwp-direct-only').forEach(function (el) { el.style.display = mode === 'direct' ? '' : 'none'; });
		renderEnv();
	}

	// --- token generator -----------------------------------------------------
	function randomToken() {
		var bytes = new Uint8Array(24);
		(window.crypto || window.msCrypto).getRandomValues(bytes);
		var bin = '';
		for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
		return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	// --- copy buttons --------------------------------------------------------
	function copyFrom(sel, btn) {
		var el = $(sel);
		if (!el) return;
		var text = 'value' in el ? el.value : el.textContent;
		var done = function () { flash(btn); };
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, function () { legacyCopy(el, done); });
		} else {
			legacyCopy(el, done);
		}
	}
	function legacyCopy(el, done) {
		var ta = document.createElement('textarea');
		ta.value = 'value' in el ? el.value : el.textContent;
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy'); } catch (e) {}
		document.body.removeChild(ta);
		done();
	}
	function flash(btn) {
		if (!btn) return;
		var orig = btn.textContent;
		btn.textContent = 'Copied!';
		setTimeout(function () { btn.textContent = orig; }, 1200);
	}

	// --- live MCP env block --------------------------------------------------
	function val(sel) { var el = $(sel); return el ? el.value.trim() : ''; }
	function renderEnv() {
		var pre = $('#etchwp-env');
		if (!pre) return;
		var mode = currentMode();
		var env = { ETCH_TRANSPORT: 'ws', ETCH_WS_MODE: mode };
		if (mode === 'relay') {
			env.ETCH_WS_RELAY_URL = val('#etchwp-relay-url') || 'wss://relay.example.com';
			env.ETCH_WS_ROOM = val('#etchwp-room') || 'default';
		} else {
			env.ETCH_WS_PORT = val('#etchwp-port') || '9223';
			var wss = $('#etchwp-wss');
			if (wss && wss.checked) {
				env.ETCH_WS_CERT = '/path/to/cert.pem';
				env.ETCH_WS_KEY = '/path/to/key.pem';
			}
		}
		env.ETCH_WS_TOKEN = val('#etchwp-token') || '<click Generate above>';
		pre.textContent = '"env": ' + JSON.stringify(env, null, 2);
	}

	// --- live status poll ----------------------------------------------------
	function setStatus(state, title, detail) {
		var card = $('#etchwp-status');
		if (!card) return;
		card.setAttribute('data-state', state);
		var t = card.querySelector('.etchwp-status-title');
		var d = card.querySelector('.etchwp-status-detail');
		if (t) t.textContent = title;
		if (d) d.textContent = detail || '';
	}
	function pollStatus() {
		if (document.hidden) return;
		var body = new URLSearchParams();
		body.set('action', 'etchwp_ai_bridge_status');
		body.set('nonce', CFG.nonce || '');
		fetch(CFG.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				var s = (res && res.data) || {};
				if (!s.seen) {
					setStatus('idle', 'No agent yet', 'Open your page in the Etch builder — the agent connects automatically.');
					return;
				}
				var etch = s.hasEtch ? ('window.etch detected' + (s.etchVersion ? ' (v' + s.etchVersion + ')' : '')) : 'window.etch not found on that tab';
				var where = s.endpoint ? (' · ' + s.endpoint + (s.room ? ' (room: ' + s.room + ')' : '')) : '';
				var ago = (s.ageSeconds === 0 ? 'just now' : s.ageSeconds + 's ago');
				if (s.connected) {
					setStatus('connected', 'Agent connected', etch + where + ' · last seen ' + ago);
				} else {
					setStatus('stale', 'Agent ' + (s.state || 'disconnected'), 'Last seen ' + ago + where + '. Open/refresh the Etch builder to reconnect.');
				}
			})
			.catch(function () { setStatus('idle', 'Status unavailable', ''); });
	}

	// --- wire up -------------------------------------------------------------
	document.addEventListener('DOMContentLoaded', function () {
		$all('input[name$="[mode]"]').forEach(function (r) { r.addEventListener('change', applyMode); });
		var gen = $('#etchwp-gen-token');
		if (gen) gen.addEventListener('click', function () {
			var f = $('#etchwp-token');
			if (f) { f.value = randomToken(); renderEnv(); }
		});
		$all('[data-etchwp-copy]').forEach(function (btn) {
			btn.addEventListener('click', function () { copyFrom(btn.getAttribute('data-etchwp-copy'), btn); });
		});
		['#etchwp-token', '#etchwp-relay-url', '#etchwp-room', '#etchwp-host', '#etchwp-port', '#etchwp-wss'].forEach(function (sel) {
			var el = $(sel);
			if (el) el.addEventListener('input', renderEnv), el.addEventListener('change', renderEnv);
		});
		applyMode();
		renderEnv();
		pollStatus();
		setInterval(pollStatus, 5000);
		document.addEventListener('visibilitychange', function () { if (!document.hidden) pollStatus(); });
	});
})();
