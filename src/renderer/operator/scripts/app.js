
        const { ipcRenderer } = require('electron');
        const path = require('path');

        function resolveOperatorAssetDir() {
            try {
                const fs = require('fs');
                if (process.resourcesPath) {
                    const pkgAssets = path.join(process.resourcesPath, 'assets');
                    if (fs.existsSync(pkgAssets)) return pkgAssets;
                }
            } catch (_) {}
            return path.join(__dirname, '../../../assets');
        }
        window.resolveOperatorAssetDir = resolveOperatorAssetDir;

        function toMediaUrl(filePath) {
            if (!filePath || typeof filePath !== 'string') return '';
            if (filePath.startsWith('file://') || filePath.startsWith('data:') || filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
                return filePath;
            }
            try {
                const urlMod = typeof require === 'function' ? require('url') : null;
                if (urlMod && typeof urlMod.pathToFileURL === 'function') {
                    return urlMod.pathToFileURL(filePath).href;
                }
            } catch (_) {}
            let normalized = filePath.replace(/\\/g, '/');
            if (!normalized.startsWith('/')) normalized = '/' + normalized;
            return 'file://' + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
        }
        window.toMediaUrl = toMediaUrl;

        // State variables
        let rundown = [];
        let selectedIndex = -1;
        let pvwCue = null;
        let pgmCue = null;
        let currentTransition = localStorage.getItem('lumen_current_transition') || 'normal';
        let currentScaling = localStorage.getItem('lumen_aspect_scaling') || 'contain';
        let isMasterMuted = false;
        let watermarkVisible = false;
        let isCueAudioOn = false;

        // Elements
        const rundownList = document.getElementById('rundownList');
        const rundownCol = document.getElementById('rundownCol');
        const dropOverlay = document.getElementById('dropOverlay');
        const cueCount = document.getElementById('cueCount');
        const stageDisplaySelect = document.getElementById('stageDisplaySelect');
        const pvwContainer = document.getElementById('pvwContainer');
        const pvwCueTitle = document.getElementById('pvwCueTitle');
        const pvwTypeTag = document.getElementById('pvwTypeTag');
        const pvwEndBehaviorSelect = document.getElementById('pvwEndBehaviorSelect');
        const pvwTimeDisplay = document.getElementById('pvwTimeDisplay');
        const btnPvwPlayPause = document.getElementById('btnPvwPlayPause');
        const btnCueAudio = document.getElementById('btnCueAudio');
        const pvwScrubber = document.getElementById('pvwScrubber');
        const pgmContainer = document.getElementById('pgmContainer');
        const pgmCueTitle = document.getElementById('pgmCueTitle');
        const pgmFrame = document.getElementById('pgmFrame');
        const pgmElapsed = document.getElementById('pgmElapsed');
        const pgmRemaining = document.getElementById('pgmRemaining');
        const masterVolumeSlider = document.getElementById('masterVolumeSlider');
        const volumeValueText = document.getElementById('volumeValueText');
        const btnMuteMaster = document.getElementById('btnMuteMaster');
        const audioSinkSelect = document.getElementById('audioSinkSelect');
        const cueAudioSinkSelect = document.getElementById('cueAudioSinkSelect');
        const audioIsolationWarning = document.getElementById('audioIsolationWarning');
        const vuLeft = document.getElementById('vuLeft');
        const vuRight = document.getElementById('vuRight');
        const tickerInput = document.getElementById('tickerInput');
        const btnPushTicker = document.getElementById('btnPushTicker');
        const btnHideTicker = document.getElementById('btnHideTicker');
        const btnToggleWatermark = document.getElementById('btnToggleWatermark');

        // Action buttons
        const btnGoLive = document.getElementById('btnGoLive');
        const btnSafeLogo = document.getElementById('btnSafeLogo');
        const btnFreeze = document.getElementById('btnFreeze');
        const btnFTB = document.getElementById('btnFTB');
        const btnBlackout = document.getElementById('btnBlackout');

        // Format Seconds to MM:SS
        function formatTime(seconds) {
            if (isNaN(seconds) || seconds < 0) return '00:00';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        // Live Clock (Broadcast 24H Non-Jitter Timecode Standard)
        function updateClock() {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            document.getElementById('clockText').innerText = `${h}:${m}:${s}`;
            document.getElementById('dateText').innerText = now.toLocaleDateString('vi-VN');
        }
        setInterval(updateClock, 1000);
        updateClock();

        // Displays Populate
        async function refreshDisplays() {
            const data = await ipcRenderer.invoke('get-displays');
            stageDisplaySelect.innerHTML = '';
            data.displays.forEach(disp => {
                const opt = document.createElement('option');
                opt.value = disp.id;
                opt.innerText = disp.label;
                if (disp.id === data.selectedId) opt.selected = true;
                stageDisplaySelect.appendChild(opt);
            });
        }
        refreshDisplays();

        stageDisplaySelect.addEventListener('change', () => {
            const selectedId = Number(stageDisplaySelect.value);
            ipcRenderer.send('set-stage-display', selectedId);
        });

        const btnToggleStagePip = document.getElementById('btnToggleStagePip');
        if (btnToggleStagePip) {
            btnToggleStagePip.addEventListener('click', () => {
                ipcRenderer.send('toggle-stage-preview');
            });
        }

        ipcRenderer.on('displays-changed', () => refreshDisplays());


        // Overlays: Watermark / Event Logo Controller
        const watermarkPreviewThumb = document.getElementById('watermarkPreviewThumb');
        const watermarkFileName = document.getElementById('watermarkFileName');
        const btnSelectWatermark = document.getElementById('btnSelectWatermark');
        const btnResetWatermark = document.getElementById('btnResetWatermark');
        const watermarkPosSelect = document.getElementById('watermarkPosSelect');
        const watermarkOpacitySlider = document.getElementById('watermarkOpacitySlider');
        const watermarkOpacityVal = document.getElementById('watermarkOpacityVal');

        let customWatermarkPath = localStorage.getItem('lumen_custom_watermark_path') || '';
        let watermarkPosition = localStorage.getItem('lumen_watermark_position') || 'top-right';
        let watermarkOpacity = parseFloat(localStorage.getItem('lumen_watermark_opacity') || '0.85');

        if (watermarkPosSelect) watermarkPosSelect.value = watermarkPosition;
        if (watermarkOpacitySlider) {
            watermarkOpacitySlider.value = Math.round(watermarkOpacity * 100);
            if (watermarkOpacityVal) watermarkOpacityVal.textContent = `${Math.round(watermarkOpacity * 100)}%`;
        }

        function updateWatermarkDisplay() {
            if (customWatermarkPath) {
                if (watermarkPreviewThumb) watermarkPreviewThumb.src = toMediaUrl(customWatermarkPath);
                if (watermarkFileName) {
                    const baseName = customWatermarkPath.replace(/\\/g, '/').split('/').pop();
                    watermarkFileName.textContent = baseName;
                    watermarkFileName.title = customWatermarkPath;
                }
            } else {
                if (watermarkPreviewThumb) watermarkPreviewThumb.src = toMediaUrl(path.join(resolveOperatorAssetDir(), 'logo.svg'));
                if (watermarkFileName) {
                    watermarkFileName.textContent = 'logo.svg (Mặc định)';
                    watermarkFileName.title = 'logo.svg (Mặc định)';
                }
            }
        }
        updateWatermarkDisplay();

        function syncWatermarkToStage() {
            ipcRenderer.send('stage-control', 'UPDATE_LOGO', {
                visible: watermarkVisible,
                opacity: watermarkOpacity,
                position: watermarkPosition,
                logoPath: customWatermarkPath || ''
            });
        }

        btnToggleWatermark.addEventListener('click', () => {
            watermarkVisible = !watermarkVisible;
            btnToggleWatermark.innerText = `Logo: ${watermarkVisible ? 'ON' : 'OFF'}`;
            btnToggleWatermark.style.color = watermarkVisible ? 'var(--accent-blue)' : '';
            syncWatermarkToStage();
        });

        if (btnSelectWatermark) {
            btnSelectWatermark.addEventListener('click', async () => {
                try {
                    const res = await ipcRenderer.invoke('open-file-dialog', {
                        title: 'Chọn Logo sự kiện (Watermark)',
                        filters: [
                            { name: 'Hình ảnh Logo', extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp'] },
                            { name: 'Tất cả tập tin', extensions: ['*'] }
                        ]
                    });
                    if (res && res.length > 0) {
                        customWatermarkPath = res[0];
                        localStorage.setItem('lumen_custom_watermark_path', customWatermarkPath);
                        updateWatermarkDisplay();
                        syncWatermarkToStage();
                        if (typeof showOperatorToast === 'function') {
                            showOperatorToast(`Đã nạp logo sự kiện mới!`, 'info');
                        }
                    }
                } catch (err) {
                    console.error('Lỗi chọn logo:', err);
                }
            });
        }

        if (btnResetWatermark) {
            btnResetWatermark.addEventListener('click', () => {
                customWatermarkPath = '';
                localStorage.removeItem('lumen_custom_watermark_path');
                updateWatermarkDisplay();
                // Reset to default asset on stage
                try {
                    const defaultLogo = path.join(resolveOperatorAssetDir(), 'logo.svg');
                    ipcRenderer.send('stage-control', 'UPDATE_LOGO', {
                        visible: watermarkVisible,
                        opacity: watermarkOpacity,
                        position: watermarkPosition,
                        logoPath: defaultLogo
                    });
                } catch (_) {
                    syncWatermarkToStage();
                }
                if (typeof showOperatorToast === 'function') {
                    showOperatorToast('Đã khôi phục Logo mặc định', 'info');
                }
            });
        }

        if (watermarkPosSelect) {
            watermarkPosSelect.addEventListener('change', () => {
                watermarkPosition = watermarkPosSelect.value;
                localStorage.setItem('lumen_watermark_position', watermarkPosition);
                syncWatermarkToStage();
            });
        }

        if (watermarkOpacitySlider) {
            watermarkOpacitySlider.addEventListener('input', () => {
                const percent = parseInt(watermarkOpacitySlider.value, 10);
                watermarkOpacity = percent / 100;
                if (watermarkOpacityVal) watermarkOpacityVal.textContent = `${percent}%`;
                localStorage.setItem('lumen_watermark_opacity', String(watermarkOpacity));
                syncWatermarkToStage();
            });
        }

        // Safe Logo / Event Key Visual Backdrop Controller
        const safeLogoPreviewThumb = document.getElementById('safeLogoPreviewThumb');
        const safeLogoFileName = document.getElementById('safeLogoFileName');
        const btnSelectSafeLogo = document.getElementById('btnSelectSafeLogo');
        const safeLogoScalingSelect = document.getElementById('safeLogoScalingSelect');
        let customSafeLogoScaling = localStorage.getItem('lumen_safelogo_scaling') || 'cover';
        window.customSafeLogoScaling = customSafeLogoScaling;

        let customSafeLogoPath = localStorage.getItem('lumen_custom_safelogo_path') || '';
        window.customSafeLogoPath = customSafeLogoPath;

        function syncSafeLogoToStage() {
            const defaultPath = path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg');
            const targetPath = customSafeLogoPath || defaultPath;
            ipcRenderer.send('stage-control', 'SET_SAFELOGO_IMAGE', {
                logoPath: targetPath,
                scaling: customSafeLogoScaling
            });
        }

        function updateSafeLogoDisplay() {
            if (customSafeLogoPath) {
                if (safeLogoPreviewThumb) safeLogoPreviewThumb.src = toMediaUrl(customSafeLogoPath);
                if (safeLogoFileName) {
                    const baseName = customSafeLogoPath.replace(/\\/g, '/').split('/').pop();
                    safeLogoFileName.textContent = baseName;
                    safeLogoFileName.title = customSafeLogoPath;
                }
            } else {
                if (safeLogoPreviewThumb) safeLogoPreviewThumb.src = toMediaUrl(path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg'));
                if (safeLogoFileName) {
                    safeLogoFileName.textContent = 'sample_keyvisual.svg (Mặc định)';
                    safeLogoFileName.title = 'sample_keyvisual.svg (Mặc định)';
                }
            }
        }
        updateSafeLogoDisplay();
        syncSafeLogoToStage();

        if (btnSelectSafeLogo) {
            btnSelectSafeLogo.addEventListener('click', async () => {
                try {
                    const res = await ipcRenderer.invoke('open-file-dialog', {
                        title: 'Chọn ảnh nền sự kiện / Safe Key Visual (16:9)',
                        filters: [
                            { name: 'Hình ảnh Backdrop', extensions: ['jpg', 'jpeg', 'png', 'svg', 'webp'] },
                            { name: 'Tất cả tập tin', extensions: ['*'] }
                        ]
                    });
                    if (res && res.length > 0) {
                        customSafeLogoPath = res[0];
                        window.customSafeLogoPath = customSafeLogoPath;
                        localStorage.setItem('lumen_custom_safelogo_path', customSafeLogoPath);
                        updateSafeLogoDisplay();
                        syncSafeLogoToStage();
                        if (typeof showOperatorToast === 'function') {
                            showOperatorToast(`Đã cập nhật ảnh nền Safe Logo / KV sự kiện!`, 'info');
                        }
                    }
                } catch (err) {
                    console.error('Lỗi chọn safe logo:', err);
                }
            });
        }

        if (btnResetSafeLogo) {
            btnResetSafeLogo.addEventListener('click', () => {
                customSafeLogoPath = '';
                window.customSafeLogoPath = '';
                localStorage.removeItem('lumen_custom_safelogo_path');
                updateSafeLogoDisplay();
                syncSafeLogoToStage();
                if (typeof showOperatorToast === 'function') {
                    showOperatorToast('Đã khôi phục Key Visual mặc định', 'info');
                }
            });
        }

        if (safeLogoScalingSelect) {
            safeLogoScalingSelect.value = customSafeLogoScaling;
            ipcRenderer.send('stage-control', 'SET_SAFELOGO_SCALING', {
                scaling: customSafeLogoScaling
            });
            safeLogoScalingSelect.addEventListener('change', () => {
                customSafeLogoScaling = safeLogoScalingSelect.value;
                window.customSafeLogoScaling = customSafeLogoScaling;
                localStorage.setItem('lumen_safelogo_scaling', customSafeLogoScaling);
                ipcRenderer.send('stage-control', 'SET_SAFELOGO_SCALING', {
                    scaling: customSafeLogoScaling
                });
            });
        }

        // Helper: Resolve active badge configuration (Preset or Custom)
        const tickerBadgeSelect = document.getElementById('tickerBadgeSelect');
        const tickerCustomBadgeWrap = document.getElementById('tickerCustomBadgeWrap');
        const tickerCustomBadgeInput = document.getElementById('tickerCustomBadgeInput');

        if (tickerBadgeSelect) {
            tickerBadgeSelect.addEventListener('change', () => {
                if (tickerCustomBadgeWrap) {
                    tickerCustomBadgeWrap.style.display = tickerBadgeSelect.value === 'CUSTOM' ? 'block' : 'none';
                }
            });
        }

        function getTickerBadgeConfig() {
            if (!tickerBadgeSelect) return { badgeText: 'THÔNG BÁO', badgeClass: '' };
            const val = tickerBadgeSelect.value;
            const opt = tickerBadgeSelect.selectedOptions[0];
            if (val === 'CUSTOM') {
                const customTxt = (tickerCustomBadgeInput ? tickerCustomBadgeInput.value : '').trim().toUpperCase() || 'THÔNG BÁO';
                return { badgeText: customTxt, badgeClass: '' };
            }
            if (val === 'NO_BADGE') {
                return { badgeText: '', badgeClass: 'badge-hidden' };
            }
            const badgeText = opt ? opt.getAttribute('data-badge-text') || 'THÔNG BÁO' : 'THÔNG BÁO';
            const badgeClass = opt ? opt.getAttribute('data-badge-class') || '' : '';
            return { badgeText, badgeClass };
        }

        function showPgmTicker(text, badgeConfig = null) {
            const pgmTickerOverlay = document.getElementById('pgmTickerOverlay');
            const pgmTickerContent = document.getElementById('pgmTickerContent');
            if (pgmTickerOverlay && pgmTickerContent) {
                const cleanText = text.trim().slice(0, 1000);
                if (!cleanText) {
                    hidePgmTicker();
                    return;
                }
                const cfg = badgeConfig || getTickerBadgeConfig();
                const badgeEl = pgmTickerOverlay.querySelector('.pgm-ticker-badge');
                if (badgeEl) {
                    if (cfg.badgeClass === 'badge-hidden') {
                        badgeEl.className = 'pgm-ticker-badge badge-hidden';
                        badgeEl.innerText = '';
                    } else {
                        badgeEl.className = `pgm-ticker-badge ${cfg.badgeClass}`.trim();
                        badgeEl.innerText = cfg.badgeText || 'THÔNG BÁO';
                    }
                }

                const durationSec = Math.max(10, Math.min(45, Math.round(cleanText.length * 0.2)));
                pgmTickerContent.innerText = cleanText;
                pgmTickerContent.style.animation = 'none';
                void pgmTickerContent.offsetWidth;
                pgmTickerContent.style.animation = `marquee ${durationSec}s linear infinite`;
                pgmTickerOverlay.classList.add('visible');
            }
        }

        // Identify Displays Button Listener
        const btnIdentifyDisplays = document.getElementById('btnIdentifyDisplays');
        if (btnIdentifyDisplays) {
            btnIdentifyDisplays.addEventListener('click', () => {
                ipcRenderer.send('identify-displays');
            });
        }

        // Preview Ticker Overlay Support with Badge Options
        function showPvwTicker(text, badgeConfig = null) {
            const pvwTickerOverlay = document.getElementById('pvwTickerOverlay');
            const pvwTickerContent = document.getElementById('pvwTickerContent');
            if (pvwTickerOverlay && pvwTickerContent) {
                const cfg = badgeConfig || getTickerBadgeConfig();
                const badgeEl = pvwTickerOverlay.querySelector('.pgm-ticker-badge');
                if (badgeEl) {
                    if (cfg.badgeClass === 'badge-hidden') {
                        badgeEl.className = 'pgm-ticker-badge badge-hidden';
                        badgeEl.innerText = '';
                    } else {
                        badgeEl.className = `pgm-ticker-badge ${cfg.badgeClass}`.trim();
                        badgeEl.innerText = cfg.badgeText || 'THÔNG BÁO';
                        // For PVW, retain distinct green border/accent if not overridden
                        if (!cfg.badgeClass) {
                            badgeEl.style.background = '#059669';
                        } else {
                            badgeEl.style.background = '';
                        }
                    }
                }

                pvwTickerContent.innerText = text;
                const charCount = text.length;
                const durationSec = Math.max(5, Math.min(25, Math.round(charCount * 0.25)));
                pvwTickerContent.style.animation = 'none';
                void pvwTickerContent.offsetWidth; // Force CSS reflow
                pvwTickerContent.style.animation = `marquee ${durationSec}s linear infinite`;
                pvwTickerOverlay.classList.add('visible');
            }
        }

        function hidePvwTicker() {
            const pvwTickerOverlay = document.getElementById('pvwTickerOverlay');
            if (pvwTickerOverlay) {
                pvwTickerOverlay.classList.remove('visible');
            }
        }

        const btnPreviewTicker = document.getElementById('btnPreviewTicker');
        if (btnPreviewTicker) {
            btnPreviewTicker.addEventListener('click', () => {
                const txt = tickerInput.value.trim().slice(0, 1000);
                if (txt) {
                    showPvwTicker(txt);
                    btnPreviewTicker.style.background = 'rgba(0, 230, 118, 0.2)';
                } else {
                    hidePvwTicker();
                    btnPreviewTicker.style.background = 'transparent';
                }
            });
        }

        btnPushTicker.addEventListener('click', () => {
            const txt = tickerInput.value.trim().slice(0, 1000);
            if (txt) {
                const badgeCfg = getTickerBadgeConfig();
                ipcRenderer.send('stage-control', 'UPDATE_TICKER', { 
                    text: txt,
                    badgeText: badgeCfg.badgeText,
                    badgeClass: badgeCfg.badgeClass
                });
                showPgmTicker(txt, badgeCfg);
                btnPushTicker.style.background = 'var(--pvw-green)';
            } else {
                ipcRenderer.send('stage-control', 'HIDE_TICKER');
                hidePgmTicker();
                btnPushTicker.style.background = 'var(--accent-blue)';
            }
        });

        btnHideTicker.addEventListener('click', () => {
            ipcRenderer.send('stage-control', 'HIDE_TICKER');
            hidePgmTicker();
            hidePvwTicker();
            btnPushTicker.style.background = 'var(--accent-blue)';
            if (btnPreviewTicker) btnPreviewTicker.style.background = 'transparent';
        });

        // Column 3 Tabs Switching
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                document.querySelectorAll('.settings-tab-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.borderBottomColor = 'transparent';
                    b.style.color = 'var(--text-muted)';
                });
                btn.classList.add('active');
                btn.style.borderBottomColor = 'var(--accent-cyan)';
                btn.style.color = 'var(--text-main)';

                document.querySelectorAll('.settings-tab-pane').forEach(pane => {
                    if (pane.id === targetTab) {
                        pane.style.display = 'flex';
                    } else {
                        pane.style.display = 'none';
                    }
                });
            });
        });

        // Stage Heartbeat Listener
        ipcRenderer.on('stage-status', (event, status) => {
            if (status.event === 'media-ended') {
                const endBehavior = status.endBehavior || (pgmCue ? pgmCue.endBehavior : null);
                if (endBehavior === 'AUTO_NEXT') {
                    const activeId = status.cueId || status.id || (pgmCue ? pgmCue.id : null);
                    const currentPgmIdx = rundown.findIndex(c => c.id === activeId);
                    if (currentPgmIdx !== -1 && currentPgmIdx < rundown.length - 1) {
                        const nextCue = rundown[currentPgmIdx + 1];
                        triggerGoLive(nextCue);
                    }
                } else if (endBehavior === 'RETURN_TO_SAFE_LOGO') {
                    if (btnSafeLogo) btnSafeLogo.classList.add('active');
                }
                if (status.isFTB !== undefined) {
                    btnFTB.classList.toggle('active', !!status.isFTB);
                }
                if (status.isSafeLogo !== undefined) {
                    btnSafeLogo.classList.toggle('active', !!status.isSafeLogo);
                }
                return;
            }

            if (status.hasVideo) {
                pgmElapsed.innerText = formatTime(status.currentTime);
                pgmRemaining.innerText = formatTime(status.duration - status.currentTime);
            }

            // Sync indicators
            btnBlackout.classList.toggle('active', !!status.isBlackout);
            btnFTB.classList.toggle('active', !!status.isFTB);
            btnFreeze.classList.toggle('active', !!status.isFrozen);
            btnSafeLogo.classList.toggle('active', !!status.isSafeLogo);

            const btnRevealEl = document.getElementById('btnReveal');
            if (btnRevealEl && status.isVisualHidden !== undefined) {
                btnRevealEl.disabled = !status.isVisualHidden;
            }
        });

        // Global Ergonomic Hotkeys
