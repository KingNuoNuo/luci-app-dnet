'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callStatus = rpc.declare({ object: 'luci.dnet', method: 'status' });
var callSave = rpc.declare({ object: 'luci.dnet', method: 'settings_save', params: [ 'program_path', 'config_path', 'enabled' ] });
var callApply = rpc.declare({ object: 'luci.dnet', method: 'settings_apply', params: [ 'program_path', 'config_path', 'enabled' ] });
var callUpdate = rpc.declare({ object: 'luci.dnet', method: 'update_start', params: [ 'mode' ] });
var callUpdateStatus = rpc.declare({ object: 'luci.dnet', method: 'update_status' });
var callBinaryStatus = rpc.declare({ object: 'luci.dnet', method: 'binary_status' });
var callLogs = rpc.declare({ object: 'luci.dnet', method: 'logs' });
var callLogsClear = rpc.declare({ object: 'luci.dnet', method: 'logs_clear' });
var callSecretStatus = rpc.declare({ object: 'luci.dnet', method: 'secret_status' });
var callSecretInit = rpc.declare({ object: 'luci.dnet', method: 'secret_init' });
var callSecretEncrypt = rpc.declare({ object: 'luci.dnet', method: 'secret_encrypt' });
var callSecretDecrypt = rpc.declare({ object: 'luci.dnet', method: 'secret_decrypt' });

function notify(message, error) {
	ui.addNotification(null, E('p', {}, message), error ? 'error' : 'info');
}

/* 开关勾反映的是 uci 配置（是否启用/开机自启），不是当前进程状态。
 * 后端在启动失败时会把 enabled 回滚成 0，但前端之前只弹提示不回读，
 * 于是出现「服务没起来、勾却还开着」。每次提交后都回读一次实际配置。 */
function resyncEnabled(result) {
	var enabled = document.getElementById('dnet-enabled');
	if (!enabled)
		return Promise.resolve(result);
	return callStatus().then(function(s) {
		enabled.checked = !!s.enabled;
		return result;
	}).catch(function() {
		return result;
	});
}

return view.extend({
	handleSave: function() {
		var program = document.getElementById('dnet-program-path');
		var config = document.getElementById('dnet-config-path');
		var enabled = document.getElementById('dnet-enabled');
		if (!program || !config || !enabled)
			return Promise.resolve(false);

		return callSave(program.value, config.value, enabled.checked ? '1' : '0').then(function(r) {
			if (!r || !r.ok) {
				notify(r && r.error ? r.error : '保存失败', true);
				return resyncEnabled(false);
			}
			program.value = r.program_path || program.value;
			config.value = r.config_path || config.value;
			notify('设置已保存；服务运行状态未更改');
			return resyncEnabled(true);
		}).catch(function(err) {
			notify('保存失败：' + (err.message || err), true);
			return resyncEnabled(false);
		});
	},
	handleReset: function() {
		return callStatus().then(function(s) {
			document.getElementById('dnet-program-path').value = s.program_path;
			document.getElementById('dnet-config-path').value = s.config_path;
			document.getElementById('dnet-enabled').checked = s.enabled;
			return true;
		});
	},
	handleSaveApply: function() {
		var program = document.getElementById('dnet-program-path');
		var config = document.getElementById('dnet-config-path');
		var enabled = document.getElementById('dnet-enabled');
		if (!program || !config || !enabled)
			return Promise.resolve(false);

		return callApply(program.value, config.value, enabled.checked ? '1' : '0').then(function(r) {
			if (!r || !r.ok) {
				notify(r && r.error ? r.error : '保存并应用失败', true);
				// 后端可能在启动失败后回滚 enabled=0，必须回读，否则勾会留在开着的位置。
				return resyncEnabled(false);
			}
			program.value = r.program_path || program.value;
			config.value = r.config_path || config.value;
			if (r.pending) {
				notify('未找到 D-NET 程序，已开始下载；完成后会自动创建缺少的配置文件并启动服务');
				return resyncEnabled(true);
			}
			return callStatus().then(function(s) {
				enabled.checked = !!s.enabled;
				notify(s.enabled ? '设置已保存并应用，D-NET 服务已启动' : '设置已保存并应用，D-NET 服务已停止');
				return true;
			});
		}).catch(function(err) {
			notify('应用失败：' + (err.message || err), true);
			return resyncEnabled(false);
		});
	},
	load: function() {
		return Promise.all([ callStatus(), callUpdateStatus(), callBinaryStatus(),
			callSecretStatus().catch(function() {
				// rpcd 未重载 / 旧版插件没有该方法时，页面仍要能打开。
				return { ok: false, supported: false, state: 'no_program', config_exists: false,
					encrypted: 0, plain: 0, empty: 0, key_source: 'none', key_path: '', config_path: '' };
			}) ]);
	},
	render: function(data) {
		var e = E, initial = data[0], binaryInitial = data[2], secretInitial = data[3];
		var pathStyle = 'display:block;width:100%;max-width:56rem;min-width:0;box-sizing:border-box';
		var program = e('input', { 'id': 'dnet-program-path', 'class': 'cbi-input-text', 'style': pathStyle, value: initial.program_path, placeholder: '/usr/bin/dnet' });
		var config = e('input', { 'id': 'dnet-config-path', 'class': 'cbi-input-text', 'style': pathStyle, value: initial.config_path, placeholder: '/etc/dnet/.dnet_config.yaml' });
		// LuCI 的 E() 用 setAttribute() 写属性；checked:false 会变成 checked="false"，
		// 浏览器只要看到 checked 属性就勾上。必须直接设 DOM 属性。
		var enabled = e('input', { 'id': 'dnet-enabled', 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		enabled.checked = !!initial.enabled;
		// 主题给 label > input[type=checkbox] 加了 position:relative;top:0.4rem，
		// 外层 label 又继承 .cbi-value 的 line-height:2.4rem，复选框按 baseline 排会下沉。
		// 复位偏移 + 关掉外层的 2.4rem 行高，让复选框和文字真正居中对齐。
		enabled.style.top = '0';
		enabled.style.right = '0';
		enabled.style.verticalAlign = 'middle';
		var state = e('span', { 'class': 'label' }, initial.running ? '运行中' : (initial.enabled ? '已启用，未运行' : '已关闭'));
		var binaryProgress = e('progress', { 'max': 100, 'value': 0, 'style': 'display:none;width:100%;max-width:36rem;height:1.2em' });
		var binaryMessage = e('p', { 'class': 'cbi-value-description', 'style': 'margin:0' }, '程序不存在时，启用服务会自动下载；缺少的配置文件也会自动创建。');
		var job = e('pre', { 'style': 'white-space:pre-wrap;max-height:16em;overflow:auto;margin:0.5em 0 0;background:#f5f5f5;padding:0.6em;border-radius:3px' }, '尚未检查更新。');
		var upgradeButton;
		/* ---- 配置加密 ---- */
		var secretBadge = e('span', { 'class': 'label' }, '读取中…');
		var secretSummary = e('p', { 'class': 'cbi-value-description', 'style': 'margin:0.2em 0 0' }, '');
		var secretPaths = e('p', { 'class': 'cbi-value-description', 'style': 'margin:0;white-space:pre-wrap;word-break:break-all' }, '');
		var secretHint = e('p', { 'class': 'cbi-value-description', 'style': 'margin:0.5em 0 0;color:#c0392b' }, '');
		var secretInitBtn, secretEncryptBtn, secretDecryptBtn;
		function applySecret(s) {
			if (!s) return;
			var configPath = s.config_path || '（未知，请先保存配置）';
			var keyPath = s.key_path || '（未知）';
			var states = {
				'encrypted': [ '已加密', 'label success' ],
				'key_only': [ '已生成主密钥，配置仍为明文', 'label warning' ],
				'plain': [ '未加密（明文）', 'label' ],
				'missing_key': [ '缺少主密钥，服务无法启动', 'label error' ],
				'no_config': [ '尚未创建配置文件', 'label' ],
				'no_program': [ '程序不可用', 'label error' ]
			};
			var view = states[s.state] || [ '未知', 'label' ];
			secretBadge.textContent = view[0];
			secretBadge.className = view[1];
			var summary = '敏感字段：已加密 ' + (s.encrypted || 0) + ' 个';
			if (s.plain > 0) summary += '，明文 ' + s.plain + ' 个';
			if (s.empty > 0) summary += '，空 ' + s.empty + ' 个';
			secretSummary.textContent = summary;
			var keyText = s.key_source == 'none' ?
				'未生成（' + keyPath + '）' :
				keyPath + (s.key_source == 'env' ? '（来自环境变量）' : '');
			secretPaths.textContent = '配置文件：' + configPath + '\n主密钥：' + keyText;
			var hint = '';
			if (!s.supported)
				hint = '当前 D-NET 版本不支持配置加密，请先升级到 v0.2.7 及以上。';
			else if (s.state == 'missing_key')
				hint = '配置里有密文但找不到主密钥：请恢复原来的 master.key。不要重新生成——新密钥解不开旧密文。';
			else if (s.state == 'key_only')
				hint = '主密钥已就绪，点「一键加密」把现有明文密钥迁移为密文。';
			else if (s.state == 'plain')
				hint = '尚未生成主密钥：先点「生成主密钥」，再执行加密。';
			secretHint.textContent = hint;
			// 已有密文却缺主密钥时绝不能给「生成主密钥」——那会导致旧密文永久解不开。
			if (secretInitBtn) secretInitBtn.style.display = (s.supported && s.config_exists && s.encrypted == 0 && s.key_source == 'none') ? '' : 'none';
			if (secretEncryptBtn) secretEncryptBtn.style.display = (s.supported && s.config_exists && s.key_source != 'none' && (s.plain > 0 || s.encrypted == 0)) ? '' : 'none';
			if (secretDecryptBtn) secretDecryptBtn.style.display = (s.supported && s.encrypted > 0) ? '' : 'none';
		}
		function showKeyModal(key, path) {
			var field = e('input', { 'class': 'cbi-input-text', 'readonly': 'readonly', 'value': key || '',
				'style': 'width:100%;font-family:monospace;box-sizing:border-box',
				'click': function(ev) { ev.target.select(); } });
			var copy = function() {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					return navigator.clipboard.writeText(key).then(function() { notify('主密钥已复制'); })
						.catch(function() { field.select(); notify('浏览器拒绝了剪贴板访问，请手动复制', true); });
				}
				field.select();
				notify('已全选，请按 Ctrl+C 复制');
			};
			ui.showModal('主密钥已生成', [
				e('p', {}, '请立即把下面的密钥离线保存（密码管理器 / U 盘）。丢了它，已加密的云厂商密钥和 ACME 账号密钥将无法恢复。'),
				field,
				e('p', { 'class': 'cbi-value-description' }, '文件位置：' + path + '（权限 0600）'),
				e('div', { 'style': 'display:flex;flex-wrap:wrap;gap:0.5em;margin-top:0.5em' }, [
					e('button', { 'class': 'cbi-button cbi-button-action', 'click': copy }, '复制到剪贴板'),
					e('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() { ui.hideModal(); } }, '我已保存')
				])
			]);
		}
		function secretCall(kind) {
			var call = kind == 'init' ? callSecretInit : (kind == 'encrypt' ? callSecretEncrypt : callSecretDecrypt);
			return call().then(function(r) {
				if (r && r.status) applySecret(r.status);
				if (!r || !r.ok) {
					notify((r && r.error) || '操作失败', true);
					return;
				}
				if (kind == 'init') {
					showKeyModal(r.key, r.key_path);
					notify('主密钥已生成，请立即离线备份');
				} else if (kind == 'encrypt') {
					notify('配置已加密，D-NET 已重启');
				} else {
					notify('配置已解密为明文，建议确认后尽快重新加密', true);
				}
			}).catch(function(err) {
				notify('操作失败：' + (err.message || err), true);
			});
		}
		function confirmSecret(kind) {
			var text = kind == 'encrypt' ?
				'将把配置里的云厂商密钥、ACME 账号密钥、证书私钥、Webhook 地址加密后落盘，并重启 D-NET。原文件会备份为 .bak.<时间>。' :
				'将把配置里的密钥字段解密成明文并重启 D-NET。明文会留在磁盘上，只建议在更换主密钥时临时使用。';
			ui.showModal(kind == 'encrypt' ? '确认加密配置' : '确认解密配置', [
				e('p', {}, text),
				e('div', { 'style': 'display:flex;flex-wrap:wrap;gap:0.5em;margin-top:0.5em' }, [
					e('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, '取消'),
					e('button', {
						'class': 'cbi-button ' + (kind == 'encrypt' ? 'cbi-button-positive' : 'cbi-button-negative'),
						'click': function() { ui.hideModal(); return secretCall(kind); }
					}, kind == 'encrypt' ? '开始加密' : '解密为明文')
				])
			]);
		}
		var previousBootstrapStatus = binaryInitial.status;
		var upgradePending = false; // 本页发起过升级、等待结果通知
		function formatBytes(value) {
			if (!value) return '0 B';
			var units = [ 'B', 'KB', 'MB', 'GB' ], n = value, i = 0;
			while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
			return n.toFixed(i ? 1 : 0) + ' ' + units[i];
		}
		function updateBinaryProgress(result, isEnabled, isRunning) {
			var active = [ 'resolving', 'verifying', 'downloading', 'installing', 'creating_config', 'starting' ].indexOf(result.status) != -1;
			// 升级/安装过程中即使 D-NET 服务仍在运行，也要把进度显示出来；
			// 只有既没有任务、服务又正常运行时才显示“服务正在运行”。
			if (isRunning && !active && result.status != 'done') {
				binaryProgress.style.display = 'none';
				binaryMessage.textContent = 'D-NET 服务正在运行。';
				updateState(isEnabled, true);
				previousBootstrapStatus = result.status;
				return;
			}
			binaryProgress.style.display = active || result.status == 'done' ? '' : 'none';
			binaryProgress.value = result.percent || 0;
			if (result.status == 'downloading') {
				binaryMessage.textContent = '正在下载 D-NET：' + (result.percent || 0) + '%（' + formatBytes(result.downloaded) + (result.total ? ' / ' + formatBytes(result.total) : '') + '）';
				state.textContent = '下载中';
				state.className = 'label warning';
			}
			else if (active) {
				binaryMessage.textContent = result.message || '正在准备 D-NET 服务…';
				state.textContent = result.status == 'starting' ? '启动中' : '准备中';
				state.className = 'label warning';
			}
			else if (result.status == 'done') {
				// bootstrap_status 是历史产物，服务停掉后仍会是 done。
				// 必须以 isRunning 为准，否则关了服务页面还显示“已启动”。
				binaryMessage.textContent = isRunning ? 'D-NET 程序已就绪，服务已启动。' : 'D-NET 程序已就绪，服务未运行。';
				updateState(isEnabled, isRunning);
			}
			else if (result.status == 'error') {
				binaryMessage.textContent = '自动准备失败：' + (result.message || '未知错误');
				// 用户主动关掉服务后，不应再拿旧的失败状态覆盖“已关闭”。
				updateState(isEnabled, isRunning);
			}
			else {
				binaryMessage.textContent = '程序不存在时，启用服务会自动下载；缺少的配置文件也会自动创建。';
				updateState(isEnabled, isRunning);
			}
			if (result.status == 'done' && previousBootstrapStatus != 'done' && !upgradePending)
				notify('D-NET 已下载并启动');
			else if (result.status == 'error' && previousBootstrapStatus != 'error')
				notify('D-NET 自动准备失败：' + (result.message || '未知错误'), true);
			previousBootstrapStatus = result.status;
		}
		function newerVersion(output) {
			var latest = output.match(/最新版本\s*[:：]\s*[vV]?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?)/);
			if (!latest) return false;
			var current = output.match(/当前版本\s*[:：]\s*[vV]?([0-9A-Za-z.\-]+)/);
			// 当前版本解析不出语义化版本（DEV、日期构建号等）时按「可升级」处理：
			// 该类程序无法参与本地版本比较，升级后即可恢复正常的版本线。
			if (!current) return true;
			if (!/^(?:\d+\.){1,3}\d+(?:-[0-9A-Za-z.-]+)?$/.test(current[1])) return true;
			var a = current[1].split('-'), b = latest[1].split('-');
			var av = a[0].split('.'), bv = b[0].split('.');
			for (var i = 0; i < Math.max(av.length, bv.length); i++) {
				var an = parseInt(av[i] || '0', 10), bn = parseInt(bv[i] || '0', 10);
				if (bn != an) return bn > an;
			}
			if (a.length == b.length) return false;
			return a.length > b.length;
		}
		function canUpgrade(result) {
			if (result.mode != 'check' || result.status == 'running') return false;
			// 旧程序的版本号解析不了时，dnet -u 直接退出，但 bootstrap 只看发布资产，
			// 照样能把任意已安装版本升级到最新发布。
			if (/不是语义化版本/.test(result.output)) return true;
			return result.exit_code == '0' && newerVersion(result.output);
		}
		function updateUpgradeButton(result) {
			upgradeButton.style.display = canUpgrade(result) ? '' : 'none';
		}
		function button(text, cls, handler) {
			return e('button', { 'class': 'cbi-button ' + (cls || ''), 'click': handler, 'style': 'margin:0.25em 0.5em 0.25em 0' }, text);
		}
		function updateState(isEnabled, isRunning) {
			state.textContent = isRunning ? '运行中' : (isEnabled ? '已启用，未运行' : '已关闭');
			state.className = isRunning ? 'label success' : (isEnabled ? 'label warning' : 'label');
		}
		function runUpdate(mode) {
			if (mode == 'check') {
				upgradeButton.style.display = 'none';
			} else {
				upgradePending = true;
			}
			job.textContent = mode == 'update' ? '正在提交升级任务…' : '正在提交任务…';
			return callUpdate(mode).then(function(r) {
				if (!r || !r.ok) {
					upgradePending = false;
					job.textContent = r && r.error ? r.error : '无法启动更新任务';
					return;
				}
				job.textContent = mode == 'update' ? '正在通过 LuCI 下载并校验升级…' : '正在检查或升级…';
			}).catch(function(err) {
				upgradePending = false;
				job.textContent = '操作失败：' + (err.message || err);
			});
		}
		function binaryProgressText(result) {
			if (!result) return '正在通过 LuCI 下载并校验升级…';
			if (result.status == 'downloading')
				return '正在下载 D-NET：' + (result.percent || 0) + '%（' + formatBytes(result.downloaded) + (result.total ? ' / ' + formatBytes(result.total) : '') + '）';
			return result.message || '正在通过 LuCI 下载并校验升级…';
		}
		/* ---- 顶部 tab：基本设置 / 仪表板 / 日志 ----
		 * D-NET 登录页现在只允许同主机的 LuCI 页面把它放进 iframe，
		 * 所以仪表板可以内嵌；referrerpolicy 必须放行 origin，
		 * 否则登录页认不出父页面，又会把整个 LuCI 顶走。 */
		var webBase = 'http://' + window.location.hostname + ':' + initial.web_port;
		var dashFrame = e('iframe', {
			'style': 'width:100%;height:70vh;min-height:32rem;border:1px solid #ddd;border-radius:4px;background:#fff',
			'loading': 'lazy', 'referrerpolicy': 'strict-origin-when-cross-origin'
		});
		var panes = {};
		var tabButtons = {};
		var activeTab = 'settings';
		var logView = e('pre', { 'id': 'dnet-log-view', 'style': 'margin:0;padding:0.8em;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;min-height:32rem;max-height:70vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:0.85em;line-height:1.45' }, '尚未读取日志。');
		var logInfo = e('span', { 'style': 'color:#666' }, '');
		var autoRefresh = e('input', { 'type': 'checkbox', 'style': 'vertical-align:middle' });
		autoRefresh.checked = true;
		function refreshLogs() {
			// 用户翻到上面看历史时，刷新后不要把他拽回底部。
			var stickBottom = logView.scrollHeight - logView.scrollTop - logView.clientHeight < 40;
			logInfo.textContent = '读取中…';
			return callLogs().then(function(r) {
				logInfo.textContent = r && r.ok ? ('共 ' + (r.count || 0) + ' 条') : '读取失败';
				logView.textContent = (r && r.lines) || (r && r.error) || '暂无 D-NET 日志。';
				if (stickBottom)
					logView.scrollTop = logView.scrollHeight;
				return r;
			}).catch(function(err) {
				logInfo.textContent = '读取失败';
				logView.textContent = '读取 D-NET 日志失败：' + (err.message || err);
			});
		}
		function clearLogs() {
			ui.showModal('清空 D-NET 日志', [
				e('p', {}, '只清空这个页面显示的 D-NET 日志，不动系统里其它服务的日志；之后产生的新日志会继续显示。'),
				e('div', { 'style': 'display:flex;flex-wrap:wrap;gap:0.5em;margin-top:0.5em' }, [
					e('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, '取消'),
					e('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() {
						ui.hideModal();
						return callLogsClear().then(function(r) {
							if (!r || !r.ok) {
								notify((r && r.error) || '清空失败', true);
								return;
							}
							notify('已清空当前显示的 D-NET 日志');
							return refreshLogs();
						}).catch(function(err) {
							notify('清空失败：' + (err.message || err), true);
						});
					} }, '清空')
				])
			]);
		}
		function selectTab(name) {
			activeTab = name;
			for (var k in panes)
				panes[k].style.display = (k == name) ? '' : 'none';
			for (var t in tabButtons) {
				// LuCI 主题的激活样式是 li.cbi-tab，未激活是 li.cbi-tab-disabled；
				// cbi-tab-active 不是主题认的类名。
				tabButtons[t].className = t == name ? 'cbi-tab' : 'cbi-tab-disabled';
				tabButtons[t].setAttribute('aria-selected', t == name ? 'true' : 'false');
			}
			// 切到仪表板时才加载 iframe，避免每次打开页面都去访问 9877。
			if (name == 'dashboard' && !dashFrame.src)
				dashFrame.src = webBase + '/';
			if (name == 'logs')
				return refreshLogs();
		}
		function makeTab(name, label) {
			// 主题样式只写在 .cbi-tabmenu > li 上，用 button 永远不会有选中态。
			tabButtons[name] = e('li', {
				'class': 'cbi-tab-disabled', 'role': 'tab',
				'aria-selected': 'false',
				'click': function(ev) { ev.preventDefault(); selectTab(name); }
			}, [ e('a', { 'href': '#' }, label) ]);
			return tabButtons[name];
		}
		var root = e('div', { 'class': 'dnet-page' }, [
			e('h2', {}, 'D-NET'),
			e('p', { 'class': 'description' }, '服务与路径配置、内置仪表板与 D-NET 日志。配置改动需点「保存并应用」才会生效。'),
			e('div', { 'class': 'cbi-tabmenu', 'role': 'tablist' }, [
				makeTab('settings', '基本设置'),
				makeTab('dashboard', '仪表板'),
				makeTab('logs', '日志')
			]),
			panes.settings = e('div', { 'data-tab': 'settings' }, [
			e('div', { 'class': 'cbi-section' }, [
				e('h3', {}, '服务与路径'),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title', 'for': 'dnet-enabled' }, '服务开关'),
					e('div', { 'class': 'cbi-value-field', 'style': 'display:flex;flex-direction:column;align-items:flex-start;gap:0.2em;min-height:2.4rem' }, [
						e('div', { 'style': 'display:flex;align-items:center;flex-wrap:wrap;gap:1em;min-height:2.4rem;line-height:1.4' }, [
							e('label', { 'style': 'display:inline-flex;align-items:center;gap:0.6em;cursor:pointer;line-height:1.4' }, [ enabled, '启用 D-NET 服务' ]),
							state
						]),
						e('p', { 'class': 'cbi-value-description', 'style': 'margin:0;padding:0' }, '程序不存在时，启用服务会自动从 GitHub Releases 下载 D-NET 二进制程序。')
					])
				]),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title' }, '应用程序路径'),
					e('div', { 'class': 'cbi-value-field' }, [ program,
						e('p', { 'class': 'cbi-value-description' }, '可填写完整文件路径；如果填写目录，程序会保存为该目录下的 dnet。') ])
				]),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title' }, '配置文件路径'),
						e('div', { 'class': 'cbi-value-field' }, [ config,
							e('p', { 'class': 'cbi-value-description' }, '可填写完整文件路径；如果填写目录，配置文件会保存为该目录下的 .dnet_config.yaml。') ])
				]),
			]),
			e('div', { 'class': 'cbi-section' }, [
				e('h3', {}, '配置加密'),
				e('p', { 'class': 'cbi-value-description', 'style': 'margin-top:0' },
					'加密配置里的云厂商密钥、ACME 账号密钥、证书私钥和 Webhook 地址。它只防「配置文件被看到」，不防拿到 root 或拆走闪存的人。'),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title' }, '加密状态'),
					e('div', { 'class': 'cbi-value-field' }, [ secretBadge, secretSummary ])
				]),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title' }, '路径'),
					e('div', { 'class': 'cbi-value-field' }, [ secretPaths ])
				]),
				e('div', { 'style': 'display:flex;flex-wrap:wrap;gap:0.5em' }, [
					(secretInitBtn = button('生成主密钥', 'cbi-button-action', function() { return secretCall('init'); })),
					(secretEncryptBtn = button('一键加密', 'cbi-button-positive', function() { return confirmSecret('encrypt'); })),
					(secretDecryptBtn = button('解密为明文', 'cbi-button-negative', function() { return confirmSecret('decrypt'); })),
					button('刷新状态', '', function() { return callSecretStatus().then(applySecret); })
				]),
				secretHint
			]),
			e('div', { 'class': 'cbi-section' }, [
				e('h3', {}, '程序与更新'),
				e('div', { 'class': 'dnet-update-card', 'style': 'border:1px solid #ddd;border-radius:4px;padding:0.8em' }, [
					e('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:0.6em' }, [
						binaryMessage,
						button('检查更新', '', function() { return runUpdate('check'); }),
						(upgradeButton = button('立即升级', 'cbi-button-negative', function() { return runUpdate('update'); }))
					]),
					e('p', { 'class': 'cbi-value-description', 'style': 'margin:0;padding:0.3em 0' }, [
						'版本发布页：',
						e('a', { 'href': 'https://github.com/KingNuoNuo/dnet/releases', 'target': '_blank', 'rel': 'noreferrer' }, 'github.com/KingNuoNuo/dnet/releases')
					]),
					binaryProgress,
					job
				])
			]),
			]),
			panes.dashboard = e('div', { 'data-tab': 'dashboard', 'style': 'display:none' }, [
				e('div', { 'class': 'cbi-section' }, [
					e('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5em;margin-bottom:0.6em' }, [
						e('p', { 'style': 'margin:0' }, '内嵌 D-NET 管理界面（端口 ' + initial.web_port + '）；未登录时在框内登录即可。'),
						e('a', { 'class': 'cbi-button cbi-button-action', 'href': webBase + '/', 'target': '_blank', 'rel': 'noreferrer' }, '在新窗口打开')
					]),
					dashFrame
				])
			]),
			panes.logs = e('div', { 'data-tab': 'logs', 'style': 'display:none' }, [
				e('div', { 'class': 'cbi-section' }, [
					e('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5em;margin-bottom:0.6em' }, [
						e('label', { 'style': 'display:inline-flex;align-items:center;gap:0.3em' }, [ autoRefresh, '自动刷新' ]),
						button('立即刷新', '', function() { return refreshLogs(); }),
						button('清空', 'cbi-button-negative', function() { return clearLogs(); }),
						logInfo
					]),
					logView
				])
			])
		]);
		selectTab('settings');
		upgradeButton.style.display = 'none';
		applySecret(secretInitial);
		if (data[1].output)
			job.textContent = data[1].output + (data[1].exit_code ? '\n退出码：' + data[1].exit_code : '');
		updateUpgradeButton(data[1]);
		poll.add(function() {
			return Promise.all([ callStatus(), callUpdateStatus(), callBinaryStatus() ]).then(function(v) {
				updateState(v[0].enabled, v[0].running);
				updateBinaryProgress(v[2], v[0].enabled, v[0].running);
				updateUpgradeButton(v[1]);
				if (v[1].mode == 'update' && v[1].status == 'running') {
					job.textContent = binaryProgressText(v[2]);
				} else if (v[1].mode == 'update' && v[1].status == 'done' && upgradePending) {
					upgradePending = false;
					if (v[1].exit_code === '0') {
						job.textContent = '升级完成，D-NET 已重启。';
						notify('D-NET 升级完成，服务已重启');
					} else {
						job.textContent = '升级失败' + (v[1].output ? '：\n' + v[1].output : '') + (v[1].exit_code ? '\n退出码：' + v[1].exit_code : '');
						notify('D-NET 升级失败：' + ((v[2] && v[2].message) || '请查看程序状态'), true);
					}
				} else if (v[1].status == 'running') {
					job.textContent = '正在检查或升级…';
				} else if (v[1].output) {
					job.textContent = v[1].output + (v[1].exit_code ? '\n退出码：' + v[1].exit_code : '');
				}
				if (activeTab == 'logs' && autoRefresh.checked)
					refreshLogs();
			});
		});
		return root;
	}
});
