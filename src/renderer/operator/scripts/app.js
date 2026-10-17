
        const { ipcRenderer } = require('electron');
        const path = require('path');

        // State variables
        let rundown = [];
        let selectedIndex = -1;
        let pvwCue = null;
        let pgmCue = null;
        let currentTransition = 'normal';
        let currentScaling = 'contain';
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


        // Overlays
        btnToggleWatermark.addEventListener('click', () => {
            watermarkVisible = !watermarkVisible;
            btnToggleWatermark.innerText = `Logo: ${watermarkVisible ? 'ON' : 'OFF'}`;
            btnToggleWatermark.style.color = watermarkVisible ? 'var(--accent-blue)' : '';
            ipcRenderer.send('stage-control', 'TOGGLE_LOGO');
        });

        function showPgmTicker(text) {
            const pgmTickerOverlay = document.getElementById('pgmTickerOverlay');
            const pgmTickerContent = document.getElementById('pgmTickerContent');
            if (pgmTickerOverlay && pgmTickerContent) {
                const cleanText = text.trim().slice(0, 1000);
                if (!cleanText) {
                    hidePgmTicker();
                    return;
                }
                const durationSec = Math.max(10, Math.min(45, Math.round(cleanText.length * 0.2)));
                pgmTickerContent.innerText = cleanText;
                pgmTickerContent.style.animation = 'none';
                void pgmTickerContent.offsetWidth;
                pgmTickerContent.style.animation = `marquee ${durationSec}s linear infinite`;
                pgmTickerOverlay.classList.add('visible');
            }
        }

        function hidePgmTicker() {
            const pgmTickerOverlay = document.getElementById('pgmTickerOverlay');
            if (pgmTickerOverlay) {
                pgmTickerOverlay.classList.remove('visible');
            }
        }

        btnPushTicker.addEventListener('click', () => {
            const txt = tickerInput.value.trim().slice(0, 1000);
            if (txt) {
                ipcRenderer.send('stage-control', 'UPDATE_TICKER', { text: txt });
                showPgmTicker(txt);
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
            btnPushTicker.style.background = 'var(--accent-blue)';
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
                }
                if (status.isFTB !== undefined) {
                    btnFTB.classList.toggle('active', !!status.isFTB);
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
        });

        // Global Ergonomic Hotkeys
