        // Emergency Panic Controls (with deduplication guard for Main + Renderer hotkey path)
        let lastPanicActionTimestamp = 0;
        let lastPanicActionName = '';

        function canExecutePanicAction(actionName) {
            const now = performance.now();
            if (actionName === lastPanicActionName && (now - lastPanicActionTimestamp) < 40) {
                return false;
            }
            lastPanicActionName = actionName;
            lastPanicActionTimestamp = now;
            return true;
        }

        btnSafeLogo.addEventListener('click', () => {
            if (!canExecutePanicAction('SAFE_LOGO')) return;
            btnSafeLogo.classList.toggle('active');
            const customSafePath = window.customSafeLogoPath || localStorage.getItem('lumen_custom_safelogo_path');
            const defaultPath = path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg');
            ipcRenderer.send('stage-control', 'SAFE_LOGO', {
                logoPath: customSafePath || defaultPath
            });
        });

        btnFreeze.addEventListener('click', () => {
            if (!canExecutePanicAction('FREEZE')) return;
            btnFreeze.classList.toggle('active');
            ipcRenderer.send('stage-control', 'FREEZE');
        });

        btnFTB.addEventListener('click', () => {
            if (!canExecutePanicAction('FTB')) return;
            btnFTB.classList.toggle('active');
            ipcRenderer.send('stage-control', 'FTB');
        });

        btnBlackout.addEventListener('click', () => {
            if (!canExecutePanicAction('BLACKOUT')) return;
            btnBlackout.classList.toggle('active');
            ipcRenderer.send('stage-control', 'BLACKOUT');
        });

        // Listen to Main Process before-input-event emergency shortcut relay
        ipcRenderer.on('panic-shortcut-triggered', (event, payload) => {
            if (!payload || !payload.action) return;
            const activeEl = document.activeElement;
            if (activeEl && typeof activeEl.blur === 'function' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)) {
                activeEl.blur();
            }
            switch (payload.action) {
                case 'BLACKOUT':
                    btnBlackout.click();
                    if (payload && payload.preserveAudio === false) {
                        if (typeof stopAudioDeck === 'function') stopAudioDeck();
                    }
                    break;
                case 'FREEZE':
                    btnFreeze.click();
                    break;
                case 'SAFE_LOGO':
                    btnSafeLogo.click();
                    break;
                case 'FTB':
                    btnFTB.click();
                    break;
                case 'GO_LIVE':
                    triggerGoLive();
                    break;
                case 'MUTE':
                    btnMuteMaster.click();
                    break;
                case 'AUDIO_PLAY_PAUSE':
                    if (typeof toggleAudioDeckPlayPause === 'function') {
                        toggleAudioDeckPlayPause();
                    }
                    break;
                case 'AUDIO_FADE_OUT':
                    if (typeof startAudioDeckFadeOut === 'function') {
                        startAudioDeckFadeOut((payload && payload.durationMs) ? payload.durationMs : 2500);
                    }
                    break;
            }
        });


        // Focus-Independent Panic Hotkeys & Tactile Shortcuts
        window.addEventListener('keydown', (e) => {
            const tagName = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
            const isContentEditable = !!(e.target && (e.target.isContentEditable || (typeof e.target.getAttribute === 'function' && e.target.getAttribute('contenteditable') === 'true')));
            const isFormInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName) || isContentEditable;
            const isTextEntry = ['INPUT', 'TEXTAREA'].includes(tagName) || isContentEditable;
            const code = e.code || '';
            const key = e.key || '';

            // Emergency panic keys take priority even inside TEXTAREA/INPUT/SELECT
            const isGlobalEmergencyKey = (
                code === 'Escape' || key === 'Escape' ||
                code === 'F1' || key === 'F1' ||
                code === 'F2' || key === 'F2' ||
                code === 'F3' || key === 'F3' ||
                code === 'F4' || key === 'F4' ||
                code === 'NumpadSubtract' || code === 'NumpadMultiply' ||
                code === 'NumpadAdd' || code === 'NumpadDivide' || code === 'NumpadEnter' ||
                code === 'Numpad4' || code === 'Numpad5' || code === 'NumpadDecimal' ||
                (e.location === 3 && ['-', '*', '+', '/', 'Enter', '4', '5', '.', ','].includes(key))
            );

            // If inside a SELECT dropdown, single-letter panic hotkeys also take priority
            const isSelectPriorityKey = (
                tagName === 'SELECT' &&
                ['Space', 'KeyB', 'KeyF', 'KeyL', 'KeyT', 'KeyM', 'KeyP', 'KeyO', 'Numpad5', 'NumpadDecimal'].includes(code)
            );

            if (isTextEntry) {
                // When isTextEntry is true (INPUT, TEXTAREA, or isContentEditable), ALL typing
                // (letters, numbers, space, with or without Shift) MUST be allowed to type normally
                // without e.preventDefault(), without blur(), and without triggering hotkeys!
                if (!isGlobalEmergencyKey) {
                    return;
                }
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                }
            } else if (tagName === 'SELECT') {
                if (isGlobalEmergencyKey || isSelectPriorityKey) {
                    if (e.target && typeof e.target.blur === 'function') {
                        e.target.blur();
                    }
                } else {
                    return;
                }
            }

            // Tactile Audio Shortcuts (Highest precedence)
            // 1. Audio Play / Pause: Shift+Space / Numpad5 / Shift+KeyP / KeyP
            if ((e.shiftKey && code === 'Space') || (e.shiftKey && code === 'KeyP') || code === 'KeyP' || code === 'Numpad5' || (e.location === 3 && key === '5')) {
                e.preventDefault();
                if (typeof toggleAudioDeckPlayPause === 'function') toggleAudioDeckPlayPause();
                return;
            }

            // 2. Audio Fade-Out: Shift+T / Numpad. / Shift+KeyO / KeyO
            if ((e.shiftKey && (code === 'KeyT' || key === 'T' || key === 't')) || (e.shiftKey && code === 'KeyO') || code === 'NumpadDecimal' || code === 'KeyO' || (e.location === 3 && (key === '.' || key === ','))) {
                e.preventDefault();
                if (typeof startAudioDeckFadeOut === 'function') startAudioDeckFadeOut(2500);
                return;
            }

            // Rundown card reordering shortcuts
            if (e.altKey && e.code === 'ArrowUp') {
                e.preventDefault();
                if (selectedIndex > 0) reorderRundown(selectedIndex, selectedIndex - 1);
                return;
            }
            if (e.altKey && e.code === 'ArrowDown') {
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < rundown.length - 1) reorderRundown(selectedIndex, selectedIndex + 1);
                return;
            }

            switch (code) {
                case 'Space':
                case 'NumpadEnter':
                    e.preventDefault();
                    triggerGoLive();
                    break;
                case 'KeyB':
                case 'F4':
                case 'NumpadSubtract':
                    e.preventDefault();
                    btnBlackout.click();
                    if (e.shiftKey && typeof stopAudioDeck === 'function') {
                        stopAudioDeck();
                    }
                    break;
                case 'Escape':
                    // Prevent accidental blackout on Esc! Only trigger Blackout if Shift+Esc or Alt+Esc is pressed
                    if (e.shiftKey || e.altKey) {
                        e.preventDefault();
                        btnBlackout.click();
                    }
                    break;
                case 'KeyF':
                case 'F2':
                case 'NumpadMultiply':
                    e.preventDefault();
                    btnFreeze.click();
                    break;
                case 'KeyL':
                case 'F1':
                case 'Numpad4':
                    e.preventDefault();
                    btnSafeLogo.click();
                    break;
                case 'KeyT':
                case 'F3':
                case 'NumpadAdd':
                    e.preventDefault();
                    btnFTB.click();
                    break;
                case 'KeyM':
                case 'NumpadDivide':
                    e.preventDefault();
                    btnMuteMaster.click();
                    break;
                case 'Delete':
                    deleteSelectedCue();
                    break;
                case 'ArrowUp':
                    if (selectedIndex > 0) selectCue(selectedIndex - 1);
                    break;
                case 'ArrowDown':
                    if (selectedIndex < rundown.length - 1) selectCue(selectedIndex + 1);
                    break;
                default:
                    // Fallback for Numpad keys when NumLock is toggled or key string is matched
                    if (key === 'F4') { e.preventDefault(); btnBlackout.click(); }
                    else if (key === 'Escape' && (e.shiftKey || e.altKey)) { e.preventDefault(); btnBlackout.click(); }
                    else if (key === 'F1') { e.preventDefault(); btnSafeLogo.click(); }
                    else if (key === 'F2') { e.preventDefault(); btnFreeze.click(); }
                    else if (key === 'F3') { e.preventDefault(); btnFTB.click(); }
                    else if (e.location === 3 && (key === 'Enter' || code === 'NumpadEnter')) { e.preventDefault(); triggerGoLive(); }
                    else if (e.location === 3 && key === '-') { e.preventDefault(); btnBlackout.click(); }
                    else if (e.location === 3 && key === '*') { e.preventDefault(); btnFreeze.click(); }
                    else if (e.location === 3 && key === '+') { e.preventDefault(); btnFTB.click(); }
                    else if (e.location === 3 && key === '/') { e.preventDefault(); btnMuteMaster.click(); }
                    else if (e.location === 3 && key === '4') { e.preventDefault(); btnSafeLogo.click(); }
                    else if (e.location === 3 && key === '5') { e.preventDefault(); if (typeof toggleAudioDeckPlayPause === 'function') toggleAudioDeckPlayPause(); }
                    else if (e.location === 3 && (key === '.' || key === ',')) { e.preventDefault(); if (typeof startAudioDeckFadeOut === 'function') startAudioDeckFadeOut(2500); }
                    break;
            }
        });
    
