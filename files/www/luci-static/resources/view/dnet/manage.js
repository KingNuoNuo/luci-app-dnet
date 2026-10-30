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

function notify(message, error) {
	ui.addNotification(null, E('p', {}, message), error ? 'error' : 'info');
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
				return false;
			}
		program.value = r.program_path || program.value;
		config.value = r.config_path || config.value;
			notify('设置已保存；服务运行状态未更改');
			return true;
		}).catch(function(err) {
			notify('保存失败：' + (err.message || err), true);
			return false;
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
				return false;
			}
			program.value = r.program_path || program.value;
			config.value = r.config_path || config.value;
			if (r.pending) {
				notify('未找到 D-NET 程序，已开始下载；完成后会自动创建缺少的配置文件并启动服务');
				return true;
			}
			return callStatus().then(function(s) {
				notify(s.enabled ? '设置已保存并应用，D-NET 服务已启动' : '设置已保存并应用，D-NET 服务已停止');
				return true;
			});
		}).catch(function(err) {
			notify('应用失败：' + (err.message || err), true);
			return false;
		});
	},
	load: function() { return Promise.all([ callStatus(), callUpdateStatus(), callBinaryStatus() ]); },
	render: function(data) {
		var e = E, initial = data[0], binaryInitial = data[2];
		var pathStyle = 'display:block;width:100%;max-width:56rem;min-width:0;box-sizing:border-box';
		var program = e('input', { 'id': 'dnet-program-path', 'class': 'cbi-input-text', 'style': pathStyle, value: initial.program_path, placeholder: '/mnt/sda1/overlay/usr/bin/dnet' });
		var config = e('input', { 'id': 'dnet-config-path', 'class': 'cbi-input-text', 'style': pathStyle, value: initial.config_path, placeholder: '/mnt/sda1/.dnet_config.yaml' });
		var enabled = e('input', { 'id': 'dnet-enabled', 'type': 'checkbox', 'class': 'cbi-input-checkbox', checked: initial.enabled });
		var state = e('span', { 'class': 'label' }, initial.running ? '运行中' : (initial.enabled ? '已启用，未运行' : '已关闭'));
		var binaryProgress = e('progress', { 'max': 100, 'value': 0, 'style': 'display:none;width:100%;max-width:36rem;height:1.2em' });
		var binaryMessage = e('p', { 'class': 'cbi-value-description', 'style': 'margin:0.4em 0 0' }, '程序不存在时，启用服务会自动下载；缺少的配置文件也会自动创建。');
		var job = e('pre', { 'style': 'white-space:pre-wrap;max-height:22em;overflow:auto' }, '尚未检查更新。');
		var upgradeButton;
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
				binaryMessage.textContent = 'D-NET 程序已就绪，服务已启动。';
				state.textContent = '已启动';
				state.className = 'label success';
			}
			else if (result.status == 'error') {
				binaryMessage.textContent = '自动准备失败：' + (result.message || '未知错误');
				state.textContent = '启动失败';
				state.className = 'label error';
			}
			else {
				binaryMessage.textContent = '程序不存在时，启用服务会自动下载；缺少的配置文件也会自动创建。';
				updateState(isEnabled);
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
		var root = e('div', { 'class': 'dnet-page' }, [
			e('h2', {}, 'D-NET'),
			e('p', { 'class': 'description' }, '服务、程序和配置路径统一在下方保存并应用。'),
			e('div', { 'class': 'cbi-section' }, [
				e('h3', {}, '服务与路径'),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title', 'for': 'dnet-enabled' }, '服务开关'),
					e('div', { 'class': 'cbi-value-field' }, [
						e('label', { 'style': 'display:inline-flex;align-items:center;gap:0.6em;cursor:pointer' }, [ enabled, '启用 D-NET 服务' ]),
						e('span', { 'style': 'margin-left:1em' }, state)
					])
				]),
				e('p', { 'class': 'cbi-value-description' }, '勾选状态会在保存后应用，并同步设置开机启动。'),
				e('div', { 'class': 'cbi-value' }, [
					e('label', { 'class': 'cbi-value-title' }, '程序状态'),
					e('div', { 'class': 'cbi-value-field' }, [ binaryProgress, binaryMessage ])
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
				e('h3', {}, '版本升级'),
				e('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5em' }, [
					e('p', { 'style': 'margin:0' }, '检查和升级使用已保存的应用程序路径。'),
					button('检查更新', '', function() { return runUpdate('check'); }),
				(upgradeButton = button('立即升级', 'cbi-button-negative', function() { return runUpdate('update'); }))
				]),
				job
			]),
			e('div', { 'class': 'cbi-section' }, [
				e('h3', {}, 'Web 管理界面'),
				e('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5em' }, [
					e('p', { 'style': 'margin:0' }, 'D-NET Web 默认端口：9877'),
					e('a', { 'class': 'cbi-button cbi-button-action', 'href': 'http://' + window.location.hostname + ':' + initial.web_port + '/', 'target': '_blank', 'rel': 'noreferrer' }, '打开 D-NET Web 界面')
				])
			])
		]);
		upgradeButton.style.display = 'none';
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
			});
		});
		return root;
	}
});
