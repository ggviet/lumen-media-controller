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
            ipcRenderer.send('stage-control', 'SAFE_LOGO', {
                logoPath: path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg')
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
            }
        });


        // Focus-Independent Panic Hotkeys & Tactile Shortcuts
        window.addEventListener('keydown', (e) => {
            const tagName = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
            const isFormInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
            const isTextEntry = ['INPUT', 'TEXTAREA'].includes(tagName);
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
                code === 'Numpad4' ||
                (e.location === 3 && ['-', '*', '+', '/', 'Enter', '4'].includes(key))
            );

            // If inside a SELECT dropdown, single-letter panic hotkeys (B, F, L, T, M, Space) also take priority
            const isSelectPriorityKey = (
                tagName === 'SELECT' &&
                ['Space', 'KeyB', 'KeyF', 'KeyL', 'KeyT', 'KeyM'].includes(code)
            );

            if (isFormInput) {
                if (isGlobalEmergencyKey || isSelectPriorityKey) {
                    if (e.target && typeof e.target.blur === 'function') {
                        e.target.blur();
                    }
                } else if (isTextEntry) {
                    return;
                } else {
                    return;
                }
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
                case 'Escape':
                case 'F4':
                case 'NumpadSubtract':
                    e.preventDefault();
                    btnBlackout.click();
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
                    if (key === 'Escape' || key === 'F4') { e.preventDefault(); btnBlackout.click(); }
                    else if (key === 'F1') { e.preventDefault(); btnSafeLogo.click(); }
                    else if (key === 'F2') { e.preventDefault(); btnFreeze.click(); }
                    else if (key === 'F3') { e.preventDefault(); btnFTB.click(); }
                    else if (e.location === 3 && (key === 'Enter' || code === 'NumpadEnter')) { e.preventDefault(); triggerGoLive(); }
                    else if (e.location === 3 && key === '-') { e.preventDefault(); btnBlackout.click(); }
                    else if (e.location === 3 && key === '*') { e.preventDefault(); btnFreeze.click(); }
                    else if (e.location === 3 && key === '+') { e.preventDefault(); btnFTB.click(); }
                    else if (e.location === 3 && key === '/') { e.preventDefault(); btnMuteMaster.click(); }
                    else if (e.location === 3 && key === '4') { e.preventDefault(); btnSafeLogo.click(); }
                    break;
            }
        });
    
