        let pgmActiveDeckKey = 'A';
        let pgmTransitionTimer = null;

        // ==================== GO LIVE ====================
        function triggerGoLive(cueToLive = null) {
            const target = (cueToLive && !(cueToLive instanceof Event) && typeof cueToLive === 'object' && cueToLive.id) ? cueToLive : pvwCue;
            if (!target) return;
            pgmCue = { ...target };
            
            // Check if audio deck is currently playing or being triggered
            const isAudioActive = typeof operatorAudioDeck !== 'undefined' && operatorAudioDeck && (!operatorAudioDeck.paused && !operatorAudioDeck.ended);
            const isAudioCue = target.type === 'audio';
            const hasPairedAudio = Boolean(target.pairedAudioPath);

            if (isAudioCue) {
                if (typeof loadTrackToAudioDeck === 'function') {
                    loadTrackToAudioDeck(target, true);
                } else if (typeof playAudioDeck === 'function') {
                    playAudioDeck();
                }
            } else if (hasPairedAudio) {
                if (typeof loadTrackToAudioDeck === 'function') {
                    loadTrackToAudioDeck(target.pairedAudioPath, true);
                }
            }

            const isAudioPlaying = isAudioActive ||
                (typeof isAudioDeckPlaying !== 'undefined' && (typeof isAudioDeckPlaying === 'function' ? isAudioDeckPlaying() : !!isAudioDeckPlaying));

            const hasIndependentAudioTrack = isAudioCue || hasPairedAudio || isAudioPlaying;

            const stageMediaPayload = isAudioCue ? {
                ...pgmCue,
                isAudioFallback: true,
                path: typeof resolveOperatorAssetDir === 'function' ? path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg') : 'sample_keyvisual.svg'
            } : pgmCue;

            // Send IPC to Stage Window
            ipcRenderer.send('go-live', {
                media: stageMediaPayload,
                transition: currentTransition,
                scaling: currentScaling,
                hasIndependentAudioTrack: !!hasIndependentAudioTrack
            });

            // Instantly clear Blackout & FTB UI toggles
            if (btnBlackout && btnBlackout.classList && typeof btnBlackout.classList.toggle === 'function') {
                btnBlackout.classList.toggle('active', false);
            }
            if (btnFTB && btnFTB.classList && typeof btnFTB.classList.toggle === 'function') {
                btnFTB.classList.toggle('active', false);
            }

            pgmCueTitle.innerText = pgmCue.name;
            pgmFrame.classList.add('is-live');

            // Hide empty hint if present
            const emptyHintEl = typeof document !== 'undefined' && document.getElementById ? document.getElementById('pgmEmptyHint') : null;
            if (emptyHintEl) emptyHintEl.style.display = 'none';

            // Check if Dual-Deck PGM elements exist (Browser runtime)
            const deckA = typeof document !== 'undefined' && document.getElementById ? document.getElementById('pgmDeckA') : null;
            const deckB = typeof document !== 'undefined' && document.getElementById ? document.getElementById('pgmDeckB') : null;

            if (deckA && deckB) {
                const nextKey = pgmActiveDeckKey === 'A' ? 'B' : 'A';
                const incomingDeck = nextKey === 'A' ? deckA : deckB;
                const outgoingDeck = pgmActiveDeckKey === 'A' ? deckA : deckB;

                if (pgmTransitionTimer) {
                    clearTimeout(pgmTransitionTimer);
                    pgmTransitionTimer = null;
                }

                // Safely unload prior video in incoming deck
                const priorVid = incomingDeck.querySelector('video');
                if (priorVid) {
                    priorVid.pause();
                    priorVid.removeAttribute('src');
                    try { priorVid.load(); } catch (_) {}
                }
                incomingDeck.innerHTML = '';

                // Apply transition classes
                incomingDeck.className = `pgm-deck fade-${currentTransition}`;
                outgoingDeck.className = `pgm-deck active fade-${currentTransition}`;

                const mediaUrl = typeof toMediaUrl === 'function' ? toMediaUrl(pgmCue.path) : (pgmCue.path && pgmCue.path.startsWith('file://') ? pgmCue.path : `file://${pgmCue.path}`);

                let newEl;
                if (pgmCue.type === 'video') {
                    newEl = document.createElement('video');
                    newEl.src = mediaUrl;
                    newEl.className = 'stage-media-element';
                    newEl.style.objectFit = currentScaling;
                    newEl.autoplay = true;
                    newEl.preload = 'auto';
                    newEl.playsInline = true;
                    newEl.muted = true; // Muted in dashboard mirror to prevent doubling sound
                    if (pgmCue.endBehavior === 'LOOP') newEl.loop = true;
                    newEl.onended = () => newEl.pause();
                    newEl.ontimeupdate = () => {
                        const cur = newEl.currentTime || 0;
                        const dur = Number.isFinite(newEl.duration) && newEl.duration > 0 ? newEl.duration : (pgmCue.duration || 0);
                        if (dur > 0 && typeof formatTime === 'function') {
                            pgmElapsed.innerText = formatTime(cur);
                            pgmRemaining.innerText = formatTime(Math.max(0, dur - cur));
                        }
                    };
                    if (typeof newEl.play === 'function') {
                        const p = newEl.play();
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                    }
                } else if (pgmCue.type === 'audio') {
                    newEl = document.createElement('img');
                    const kvSrc = typeof resolveOperatorAssetDir === 'function' ? toMediaUrl(path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg')) : '../../../assets/sample_keyvisual.svg';
                    newEl.src = kvSrc;
                    newEl.className = 'stage-media-element';
                    newEl.style.objectFit = currentScaling;
                    const dur = pgmCue.duration || 0;
                    if (typeof formatTime === 'function') {
                        pgmElapsed.innerText = formatTime(0);
                        pgmRemaining.innerText = formatTime(dur);
                    }
                } else {
                    newEl = document.createElement('img');
                    newEl.src = mediaUrl;
                    newEl.style.objectFit = currentScaling;
                    pgmElapsed.innerText = 'STATIC';
                    pgmRemaining.innerText = 'STATIC';
                }
                incomingDeck.appendChild(newEl);

                // Trigger visual crossfade in next frame
                const fadeDurMs = currentTransition === 'cut' ? 0 : (currentTransition === 'fast' ? 400 : (currentTransition === 'slow' ? 1600 : 800));

                requestAnimationFrame(() => {
                    incomingDeck.classList.add('active');
                    outgoingDeck.classList.remove('active');

                    pgmTransitionTimer = setTimeout(() => {
                        const oldVid = outgoingDeck.querySelector('video');
                        if (oldVid) {
                            oldVid.pause();
                            oldVid.removeAttribute('src');
                            try { oldVid.load(); } catch (_) {}
                        }
                        outgoingDeck.innerHTML = '';
                        pgmTransitionTimer = null;
                    }, fadeDurMs + 80);

                    pgmActiveDeckKey = nextKey;
                });
            } else {
                // Fallback for headless test environments (pgmContainer as simple element)
                const oldVid = pgmContainer.querySelector ? pgmContainer.querySelector('video') : null;
                if (oldVid) {
                    if (oldVid.pause) oldVid.pause();
                    oldVid.src = '';
                    if (oldVid.load) try { oldVid.load(); } catch (_) {}
                    if (oldVid.remove) oldVid.remove();
                }
                pgmContainer.innerHTML = '';

                if (pgmCue.type === 'video') {
                    const vid = document.createElement('video');
                    vid.src = typeof toMediaUrl === 'function' ? toMediaUrl(pgmCue.path) : (pgmCue.path && pgmCue.path.startsWith('file://') ? pgmCue.path : `file://${pgmCue.path}`);
                    vid.className = 'stage-media-element';
                    vid.style.objectFit = currentScaling;
                    vid.autoplay = true;
                    vid.preload = 'auto';
                    vid.playsInline = true;
                    vid.muted = true;
                    if (pgmCue.endBehavior === 'LOOP') vid.loop = true;
                    vid.onended = () => vid.pause();
                    vid.ontimeupdate = () => {
                        const cur = vid.currentTime || 0;
                        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : (pgmCue.duration || 0);
                        if (dur > 0 && typeof formatTime === 'function') {
                            pgmElapsed.innerText = formatTime(cur);
                            pgmRemaining.innerText = formatTime(Math.max(0, dur - cur));
                        }
                    };
                    if (typeof vid.play === 'function') {
                        const p = vid.play();
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                    }
                    pgmContainer.appendChild(vid);
                } else if (pgmCue.type === 'audio') {
                    const img = document.createElement('img');
                    const kvSrc = typeof resolveOperatorAssetDir === 'function' ? toMediaUrl(path.join(resolveOperatorAssetDir(), 'sample_keyvisual.svg')) : '../../../assets/sample_keyvisual.svg';
                    img.src = kvSrc;
                    img.className = 'stage-media-element';
                    img.style.objectFit = currentScaling;
                    pgmContainer.appendChild(img);
                    const dur = pgmCue.duration || 0;
                    if (typeof formatTime === 'function') {
                        pgmElapsed.innerText = formatTime(0);
                        pgmRemaining.innerText = formatTime(dur);
                    }
                } else {
                    const img = document.createElement('img');
                    img.src = typeof toMediaUrl === 'function' ? toMediaUrl(pgmCue.path) : (pgmCue.path && pgmCue.path.startsWith('file://') ? pgmCue.path : `file://${pgmCue.path}`);
                    img.style.objectFit = currentScaling;
                    pgmContainer.appendChild(img);
                    pgmElapsed.innerText = 'STATIC';
                    pgmRemaining.innerText = 'STATIC';
                }
            }

            renderRundown();
        }

        btnGoLive.addEventListener('click', triggerGoLive);

        // Transition Buttons
        document.querySelectorAll('.btn-trans').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-trans').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTransition = btn.dataset.trans;
            });
        });

        // Scaling Buttons
        document.querySelectorAll('.btn-scale').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-scale').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentScaling = btn.dataset.scale;
                ipcRenderer.send('stage-control', 'SET_SCALING', { scaling: currentScaling });
                
                // Update local previews
                const pvwEl = pvwContainer.querySelector('video, img');
                if (pvwEl) pvwEl.style.objectFit = currentScaling;
                const pgmEl = pgmContainer.querySelector('video, img');
                if (pgmEl) pgmEl.style.objectFit = currentScaling;
            });
        });

