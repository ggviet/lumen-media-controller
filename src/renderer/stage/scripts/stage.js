// ==================== STAGE INPUT & CURSOR SHIELD ====================
        (function initStageInputShield() {
            // 1. Enforce cursor hidden immediately on DOM root and body
            document.documentElement.style.cursor = 'none';
            if (document.body) {
                document.body.style.cursor = 'none';
            }

            // 2. Hardware Pointer Lock acquisition with error catch
            function acquirePointerLock() {
                if (!document.pointerLockElement && document.body && typeof document.body.requestPointerLock === 'function') {
                    try {
                        const lockPromise = document.body.requestPointerLock();
                        if (lockPromise && typeof lockPromise.catch === 'function') {
                            lockPromise.catch(() => {
                                // Graceful fallback in environments restricting pointer lock without active user gesture
                            });
                        }
                    } catch (err) {
                        // Silently swallow in headless / non-gesture contexts
                    }
                }
            }

            window.addEventListener('focus', acquirePointerLock, { capture: true });
            document.addEventListener('click', acquirePointerLock, { capture: true });
            document.addEventListener('mousedown', acquirePointerLock, { capture: true });

            // 3. Block right-click context menu
            window.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }, { capture: true });

            // 4. Block file drag and drop navigation
            const dragEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
            dragEvents.forEach((eventName) => {
                window.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'none';
                    }
                    return false;
                }, { capture: true });
            });

            // 5. Suppress text selection & auxiliary clicks
            window.addEventListener('selectstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }, { capture: true });

            window.addEventListener('auxclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }, { capture: true });

            // 6. Suppress disruptive keyboard inputs on Stage window
            window.addEventListener('keydown', (e) => {
                const blockedKeys = ['F5', 'F11', 'Tab', ' '];
                const isRefresh = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
                const isClose = (e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W');
                const isPrintOrSave = (e.ctrlKey || e.metaKey) && ['p', 'P', 's', 'S', 'u', 'U'].includes(e.key);

                if (blockedKeys.includes(e.key) || isRefresh || isClose || isPrintOrSave) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }, { capture: true });

            // 7. Clean Stage Policy: Suppress dragstart and eliminate any native tooltips
            window.addEventListener('dragstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }, { capture: true });

            function stripTooltips(node) {
                if (!node) return;
                if (node.hasAttribute && node.hasAttribute('title')) {
                    node.removeAttribute('title');
                }
                if (node.querySelectorAll) {
                    node.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
                }
            }
            stripTooltips(document);
            try {
                const tooltipObserver = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.type === 'attributes' && m.attributeName === 'title' && m.target) {
                            m.target.removeAttribute('title');
                        } else if (m.addedNodes) {
                            m.addedNodes.forEach(stripTooltips);
                        }
                    }
                });
                tooltipObserver.observe(document.documentElement, { attributes: true, subtree: true, childList: true, attributeFilter: ['title'] });
            } catch (err) {
                // Silently ignore if MutationObserver is unsupported
            }
        })();

        const { ipcRenderer } = require('electron');

        const decks = {
            A: document.getElementById('deckA'),
            B: document.getElementById('deckB')
        };

        const blackoutCover = document.getElementById('blackoutCover');
        const safeLogoLayer = document.getElementById('safeLogoLayer');
        const safeLogoImg = document.getElementById('safeLogoImg');
        const watermarkOverlay = document.getElementById('watermarkOverlay');
        const tickerOverlay = document.getElementById('tickerOverlay');
        const tickerContent = document.getElementById('tickerContent');

        let activeDeckKey = 'A';
        let currentMedia = null;
        let masterVolume = 1.0;
        let isMuted = false;
        let audioSinkId = '';
        let scalingMode = 'contain';
        let isBlackout = false;
        let isFTB = false;
        let isFrozen = false;
        let isSafeLogo = false;

        // Transition management & audio crossfade state
        let cleanupTimeoutId = null;
        let audioCrossfadeAnimId = null;
        let ftbAnimId = null;
        let activeTransitionToken = 0;

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

        // Apply transition class
        function applyTransitionClass(deckEl, durationMode) {
            deckEl.classList.remove('fade-cut', 'fade-fast', 'fade-normal', 'fade-slow');
            if (durationMode === 'cut') deckEl.classList.add('fade-cut');
            else if (durationMode === 'fast') deckEl.classList.add('fade-fast');
            else if (durationMode === 'slow') deckEl.classList.add('fade-slow');
            else deckEl.classList.add('fade-normal');
        }

        function getTransitionDurationMs(durationMode) {
            if (durationMode === 'cut') return 0;
            if (durationMode === 'fast') return 400;
            if (durationMode === 'slow') return 1600;
            return 800; // 'normal' default
        }

        function preRollVideo(video, timeoutMs = 500) {
            return new Promise((resolve) => {
                if (!video) return resolve(false);
                if (video.readyState >= 2) return resolve(true);
                let settled = false;
                let timer = null;

                const onReady = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(true);
                };

                const onError = (err) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    console.warn('Video pre-roll error/fallback:', err);
                    resolve(false);
                };

                function cleanup() {
                    if (timer) clearTimeout(timer);
                    video.removeEventListener('loadeddata', onReady);
                    video.removeEventListener('canplay', onReady);
                    video.removeEventListener('playing', onReady);
                    video.removeEventListener('error', onError);
                }

                video.addEventListener('loadeddata', onReady, { once: true });
                video.addEventListener('canplay', onReady, { once: true });
                video.addEventListener('playing', onReady, { once: true });
                video.addEventListener('error', onError, { once: true });

                timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    console.warn('Video pre-roll timeout fallback');
                    resolve(false);
                }, timeoutMs);
            });
        }

        async function preRollImage(img, timeoutMs = 400) {
            if (!img) return false;
            if (typeof img.decode === 'function') {
                try {
                    await Promise.race([
                        img.decode(),
                        new Promise(r => setTimeout(r, timeoutMs))
                    ]);
                    return true;
                } catch (err) {
                    console.warn('Image decode fallback:', err);
                    return false;
                }
            } else {
                if (img.complete) return true;
                return new Promise((resolve) => {
                    let settled = false;
                    let timer = null;
                    const cleanup = () => {
                        if (timer) clearTimeout(timer);
                        img.removeEventListener('load', onFinish);
                        img.removeEventListener('error', onError);
                    };
                    const onFinish = () => {
                        if (settled) return;
                        settled = true;
                        cleanup();
                        resolve(true);
                    };
                    const onError = () => {
                        if (settled) return;
                        settled = true;
                        cleanup();
                        resolve(false);
                    };
                    timer = setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        cleanup();
                        resolve(false);
                    }, timeoutMs);
                    img.addEventListener('load', onFinish, { once: true });
                    img.addEventListener('error', onError, { once: true });
                });
            }
        }

        // GO LIVE Handler with Dual-Deck Crossfade & Pre-Roll
        ipcRenderer.on('stage-go-live', async (event, payload) => {
            console.log('Stage GO LIVE received:', payload);
            const { media, transition = 'normal', scaling = scalingMode } = payload;
            if (!media || !media.path) return;

            // Increment transition token to cancel any stale transitions
            const thisTransitionToken = ++activeTransitionToken;

            // Cancel any pending deck cleanups or audio crossfade animations
            if (cleanupTimeoutId) {
                clearTimeout(cleanupTimeoutId);
                cleanupTimeoutId = null;
            }
            if (audioCrossfadeAnimId) {
                cancelAnimationFrame(audioCrossfadeAnimId);
                audioCrossfadeAnimId = null;
            }
            if (ftbAnimId) {
                cancelAnimationFrame(ftbAnimId);
                ftbAnimId = null;
            }

            function abortSupersededMedia(el) {
                if (!el) return;
                if (el.tagName === 'VIDEO') {
                    el.pause();
                    el.removeAttribute('src');
                    try { el.load(); } catch (_) {}
                }
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }

            currentMedia = media;
            scalingMode = scaling;

            // If blackout or FTB was active, lift it
            if (isBlackout || isFTB) {
                blackoutCover.className = '';
                isBlackout = false;
                isFTB = false;
            }

            // If Safe Logo was active, hide it
            if (isSafeLogo) {
                safeLogoLayer.classList.remove('active');
                isSafeLogo = false;
            }

            // Next deck to load onto
            const nextDeckKey = activeDeckKey === 'A' ? 'B' : 'A';
            const incomingDeck = decks[nextDeckKey];
            const outgoingDeck = decks[activeDeckKey];

            // Safely unload any prior media in incomingDeck before mounting new element
            const oldVideoInIncoming = incomingDeck.querySelector('video');
            if (oldVideoInIncoming) {
                oldVideoInIncoming.pause();
                oldVideoInIncoming.src = '';
                oldVideoInIncoming.load();
            }
            incomingDeck.innerHTML = '';

            // Setup transition speed
            applyTransitionClass(incomingDeck, transition);
            applyTransitionClass(outgoingDeck, transition);

            const fadeDurationMs = getTransitionDurationMs(transition);
            let mediaElement;

            if (media.type === 'video') {
                mediaElement = document.createElement('video');
                mediaElement.src = toMediaUrl(media.path);
                mediaElement.className = 'stage-media-element';
                mediaElement.style.objectFit = scalingMode;
                mediaElement.playsInline = true;
                mediaElement.preload = 'auto';

                // Initial volume: 0 for smooth crossfade, or masterVolume for cut
                mediaElement.volume = fadeDurationMs === 0 ? (isMuted ? 0 : masterVolume) : 0;
                mediaElement.muted = isMuted;

                if (audioSinkId && typeof mediaElement.setSinkId === 'function') {
                    try {
                        await mediaElement.setSinkId(audioSinkId);
                    } catch (err) {
                        console.warn('setSinkId failed, falling back to default:', err);
                        try {
                            await mediaElement.setSinkId('');
                        } catch (fallbackErr) {
                            console.warn('Fallback setSinkId failed:', fallbackErr);
                        }
                    }
                }

                // Handle End Behavior
                const endBehavior = media.endBehavior || 'HOLD_LAST_FRAME';
                if (endBehavior === 'LOOP') {
                    mediaElement.loop = true;
                    mediaElement.onended = () => {
                        mediaElement.currentTime = 0;
                        mediaElement.play().catch(e => console.warn('Loop restart error:', e));
                    };
                } else {
                    mediaElement.loop = false;
                    mediaElement.onended = () => {
                        console.log('Video ended with behavior:', endBehavior);
                        if (endBehavior === 'HOLD_LAST_FRAME') {
                            mediaElement.pause();
                            try { mediaElement.currentTime = mediaElement.duration; } catch (e) {}
                        } else if (endBehavior === 'FADE_TO_BLACK') {
                            blackoutCover.className = 'active-ftb';
                            isFTB = true;
                            if (ftbAnimId) {
                                cancelAnimationFrame(ftbAnimId);
                                ftbAnimId = null;
                            }
                            // Synchronized FTB audio ramp down over 1.0s
                            const ftbStart = performance.now();
                            const startVol = mediaElement.volume;
                            const ftbRamp = (now) => {
                                if (!isFTB) return;
                                const elapsed = now - ftbStart;
                                const progress = Math.min(1, elapsed / 1000);
                                if (!isMuted) mediaElement.volume = startVol * (1 - progress);
                                if (progress < 1) {
                                    ftbAnimId = requestAnimationFrame(ftbRamp);
                                } else {
                                    ftbAnimId = null;
                                    mediaElement.pause();
                                }
                            };
                            ftbAnimId = requestAnimationFrame(ftbRamp);
                            ipcRenderer.send('stage-status', {
                                event: 'media-ended',
                                id: media.id,
                                cueId: media.id,
                                endBehavior: 'FADE_TO_BLACK',
                                isFTB: true
                            });
                        } else if (endBehavior === 'AUTO_NEXT') {
                            mediaElement.pause();
                            ipcRenderer.send('stage-status', {
                                event: 'media-ended',
                                id: media.id,
                                cueId: media.id,
                                endBehavior: 'AUTO_NEXT'
                            });
                        }
                    };
                }

                incomingDeck.appendChild(mediaElement);

                // Wait for decoder readyState >= 2 (first frame decoded)
                await preRollVideo(mediaElement, 500);

                try {
                    await mediaElement.play();
                } catch (e) {
                    console.warn('Video auto-play prevented:', e);
                }

                // Verify presentation to compositor
                if (typeof mediaElement.requestVideoFrameCallback === 'function') {
                    await new Promise((resolve) => {
                        mediaElement.requestVideoFrameCallback(() => resolve(true));
                        setTimeout(() => resolve(false), 120);
                    });
                } else {
                    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                }

            } else {
                // Image or SVG
                mediaElement = document.createElement('img');
                mediaElement.src = toMediaUrl(media.path);
                mediaElement.className = 'stage-media-element';
                mediaElement.style.objectFit = scalingMode;
                incomingDeck.appendChild(mediaElement);

                // Wait for image decoding
                await preRollImage(mediaElement, 400);
            }

            // Abort if superseded by newer transition during pre-roll
            if (thisTransitionToken !== activeTransitionToken) {
                abortSupersededMedia(mediaElement);
                return;
            }

            // Synchronized Audio Crossfade Ramp
            const outgoingVideo = outgoingDeck.querySelector('video');
            const incomingVideo = mediaElement.tagName === 'VIDEO' ? mediaElement : null;

            if (fadeDurationMs > 0 && (outgoingVideo || incomingVideo)) {
                const startTime = performance.now();
                const initialMasterVol = masterVolume > 0 ? masterVolume : 1;
                const initialOutRatio = outgoingVideo ? Math.min(1, outgoingVideo.volume / initialMasterVol) : 0;

                const stepAudioCrossfade = (now) => {
                    if (thisTransitionToken !== activeTransitionToken) return;
                    const elapsed = now - startTime;
                    const progress = Math.min(1, Math.max(0, elapsed / fadeDurationMs));

                    const targetVol = isMuted ? 0 : masterVolume;
                    const targetInVol = isMuted ? 0 : masterVolume;
                    const startOutVol = targetVol * initialOutRatio;

                    if (!isMuted) {
                        if (incomingVideo) incomingVideo.volume = targetInVol * progress;
                        if (outgoingVideo) outgoingVideo.volume = startOutVol * (1 - progress);
                    }

                    if (progress < 1) {
                        audioCrossfadeAnimId = requestAnimationFrame(stepAudioCrossfade);
                    } else {
                        audioCrossfadeAnimId = null;
                        if (incomingVideo && !isMuted) incomingVideo.volume = targetInVol;
                        if (outgoingVideo) outgoingVideo.volume = 0;
                    }
                };
                audioCrossfadeAnimId = requestAnimationFrame(stepAudioCrossfade);
            } else {
                if (incomingVideo && !isMuted) incomingVideo.volume = masterVolume;
                if (outgoingVideo) outgoingVideo.volume = 0;
            }

            // Trigger Visual Crossfade
            requestAnimationFrame(() => {
                if (thisTransitionToken !== activeTransitionToken) {
                    abortSupersededMedia(mediaElement);
                    return;
                }

                incomingDeck.classList.add('active');
                outgoingDeck.classList.remove('active');

                // After crossfade completes, stop and cleanup outgoing deck
                cleanupTimeoutId = setTimeout(() => {
                    if (thisTransitionToken !== activeTransitionToken) return;

                    const oldVideo = outgoingDeck.querySelector('video');
                    if (oldVideo) {
                        oldVideo.pause();
                        oldVideo.src = '';
                        oldVideo.load();
                    }
                    outgoingDeck.innerHTML = '';
                    cleanupTimeoutId = null;
                }, fadeDurationMs + 80);

                activeDeckKey = nextDeckKey;
                isFrozen = false;
            });
        });

        let watermarkOpacity = 0.85;
        let watermarkScalePercent = 100;
        let watermarkPosition = 'top-right';

        // Initialize packaged asset paths if running from unpacked resources
        (function initPackagedStageAssets() {
            try {
                const path = require('path');
                const fs = require('fs');
                if (process.resourcesPath) {
                    const kvPath = path.join(process.resourcesPath, 'assets', 'sample_keyvisual.svg');
                    const logoPath = path.join(process.resourcesPath, 'assets', 'logo.svg');
                    if (fs.existsSync(kvPath) && safeLogoImg) {
                        safeLogoImg.src = toMediaUrl(kvPath);
                    }
                    const wmImg = watermarkOverlay ? watermarkOverlay.querySelector('img') : null;
                    if (fs.existsSync(logoPath) && wmImg) {
                        wmImg.src = toMediaUrl(logoPath);
                    }
                }
            } catch (_) {}
        })();

        // Stage Control Handler
        ipcRenderer.on('stage-control', (event, action, data) => {
            console.log('Stage control action:', action, data);
            const activeVideo = decks[activeDeckKey].querySelector('video');

            switch(action) {
                case 'BLACKOUT':
                    // Blackout has highest emergency priority; cancel any FTB ramp immediately
                    if (ftbAnimId) {
                        cancelAnimationFrame(ftbAnimId);
                        ftbAnimId = null;
                    }
                    if (data && typeof data.active === 'boolean') {
                        isBlackout = data.active;
                    } else {
                        isBlackout = !isBlackout;
                    }
                    if (isBlackout) {
                        isFTB = false;
                        blackoutCover.className = 'active-blackout';
                        document.querySelectorAll('.media-deck video').forEach(v => {
                            v.pause();
                            v.volume = 0;
                        });
                    } else {
                        blackoutCover.className = '';
                        if (activeVideo) {
                            activeVideo.volume = isMuted ? 0 : masterVolume;
                            if (!isFrozen && !isSafeLogo) {
                                activeVideo.play().catch(() => {});
                            }
                        }
                    }
                    break;

                case 'FTB': // Synchronized 1.0s Audio & Video Fade To Black
                    if (ftbAnimId) {
                        cancelAnimationFrame(ftbAnimId);
                        ftbAnimId = null;
                    }
                    if (data && typeof data.active === 'boolean') {
                        isFTB = data.active;
                    } else {
                        isFTB = !isFTB;
                    }
                    blackoutCover.className = isFTB ? 'active-ftb' : '';
                    if (isFTB) {
                        isBlackout = false;
                        if (activeVideo) {
                            const startVol = activeVideo.volume;
                            const startTime = performance.now();
                            const stepFtbDown = (now) => {
                                if (!isFTB) return;
                                const progress = Math.min(1, Math.max(0, (now - startTime) / 1000));
                                if (!isMuted) {
                                    activeVideo.volume = Math.max(0, startVol * (1 - progress));
                                }
                                if (progress < 1) {
                                    ftbAnimId = requestAnimationFrame(stepFtbDown);
                                } else {
                                    ftbAnimId = null;
                                    activeVideo.volume = 0;
                                    activeVideo.pause();
                                }
                            };
                            ftbAnimId = requestAnimationFrame(stepFtbDown);
                        }
                    } else {
                        if (activeVideo) {
                            activeVideo.volume = 0;
                            if (!isFrozen && !isSafeLogo) {
                                activeVideo.play().catch(() => {});
                            }
                            const startTime = performance.now();
                            const stepFtbUp = (now) => {
                                if (isFTB || isBlackout) return;
                                const progress = Math.min(1, Math.max(0, (now - startTime) / 1000));
                                const targetVol = isMuted ? 0 : masterVolume;
                                activeVideo.volume = targetVol * progress;
                                if (progress < 1) {
                                    ftbAnimId = requestAnimationFrame(stepFtbUp);
                                } else {
                                    ftbAnimId = null;
                                    activeVideo.volume = targetVol;
                                }
                            };
                            ftbAnimId = requestAnimationFrame(stepFtbUp);
                        }
                    }
                    break;

                case 'FREEZE':
                    if (data && typeof data.active === 'boolean') {
                        isFrozen = data.active;
                    } else {
                        isFrozen = !isFrozen;
                    }
                    if (activeVideo) {
                        if (isFrozen) activeVideo.pause();
                        else if (!isBlackout && !isFTB && !isSafeLogo) activeVideo.play().catch(() => {});
                    }
                    break;

                case 'SAFE_LOGO':
                    if (data && typeof data.active === 'boolean') {
                        isSafeLogo = data.active;
                    } else {
                        isSafeLogo = !isSafeLogo;
                    }
                    if (data && data.logoPath) {
                        safeLogoImg.src = toMediaUrl(data.logoPath);
                    }
                    safeLogoLayer.classList.toggle('active', isSafeLogo);
                    if (activeVideo) {
                        if (isSafeLogo) activeVideo.pause();
                        else if (!isBlackout && !isFTB && !isFrozen) activeVideo.play().catch(() => {});
                    }
                    break;

                case 'TOGGLE_LOGO':
                case 'UPDATE_LOGO':
                    if (data && typeof data.visible === 'boolean') {
                        watermarkOverlay.classList.toggle('visible', data.visible);
                    } else if (action === 'TOGGLE_LOGO') {
                        watermarkOverlay.classList.toggle('visible');
                    }
                    if (data && typeof data.opacity === 'number') {
                        watermarkOpacity = Math.max(0, Math.min(1, data.opacity));
                        if (watermarkOverlay.classList.contains('visible')) {
                            watermarkOverlay.style.opacity = String(watermarkOpacity);
                        }
                    }
                    if (data && typeof data.scalePercent === 'number') {
                        watermarkScalePercent = Math.max(20, Math.min(200, data.scalePercent));
                        watermarkOverlay.style.width = `${Math.round(140 * (watermarkScalePercent / 100))}px`;
                    }
                    if (data && typeof data.position === 'string') {
                        watermarkPosition = data.position;
                        watermarkOverlay.style.top = watermarkPosition.startsWith('top') ? '36px' : 'auto';
                        watermarkOverlay.style.bottom = watermarkPosition.startsWith('bottom') ? '80px' : 'auto';
                        watermarkOverlay.style.right = watermarkPosition.endsWith('right') ? '48px' : 'auto';
                        watermarkOverlay.style.left = watermarkPosition.endsWith('left') ? '48px' : 'auto';
                    }
                    break;

                case 'UPDATE_TICKER':
                    if (data && typeof data.text === 'string') {
                        const cleanText = data.text.trim().slice(0, 1000);
                        if (!cleanText) {
                            tickerOverlay.classList.remove('visible');
                            break;
                        }
                        const durationSec = Math.max(14, Math.min(60, Math.round(cleanText.length * 0.28)));
                        tickerContent.innerText = cleanText;
                        tickerContent.style.animation = 'none';
                        void tickerContent.offsetWidth; // Trigger clean CSS reflow
                        tickerContent.style.animation = `marquee ${durationSec}s linear infinite`;
                        tickerOverlay.classList.add('visible');
                    }
                    break;

                case 'HIDE_TICKER':
                    tickerOverlay.classList.remove('visible');
                    break;

                case 'SET_VOLUME':
                    if (data && typeof data.volume === 'number') {
                        masterVolume = Math.max(0, Math.min(1, data.volume));
                        if (!audioCrossfadeAnimId) {
                            if (!ftbAnimId && !isBlackout && !isFTB) {
                                document.querySelectorAll('.media-deck video').forEach(v => {
                                    if (!isMuted) v.volume = masterVolume;
                                });
                            }
                        }
                    }
                    break;

                case 'SET_MUTE':
                    isMuted = !!data.muted;
                    document.querySelectorAll('.media-deck video').forEach(v => {
                        v.muted = isMuted;
                    });
                    break;

                case 'SET_SCALING':
                    if (data && data.scaling) {
                        scalingMode = data.scaling;
                        const allMedia = document.querySelectorAll('.stage-media-element');
                        allMedia.forEach(el => el.style.objectFit = scalingMode);
                    }
                    break;

                case 'SET_AUDIO_SINK':
                    if (data && typeof data.sinkId === 'string') {
                        audioSinkId = data.sinkId;
                        document.querySelectorAll('.media-deck video').forEach(v => {
                            if (typeof v.setSinkId === 'function') {
                                v.setSinkId(audioSinkId).catch(err => {
                                    console.warn('Failed to set sink ID, falling back to default:', err);
                                    v.setSinkId('').catch(console.warn);
                                });
                            }
                        });
                    }
                    break;
            }
        });

        // Stage Status Heartbeat (Sends progress & state back to Operator Window)
        setInterval(() => {
            const activeVideo = decks[activeDeckKey].querySelector('video');
            const status = {
                activeMedia: currentMedia,
                hasVideo: !!activeVideo,
                currentTime: activeVideo ? activeVideo.currentTime : 0,
                duration: activeVideo ? activeVideo.duration : 0,
                paused: activeVideo ? activeVideo.paused : false,
                isBlackout: isBlackout,
                isFTB: isFTB,
                isFrozen: isFrozen,
                isSafeLogo: isSafeLogo,
                scalingMode: scalingMode,
                masterVolume: masterVolume,
                isMuted: isMuted,
                audioSinkId: audioSinkId
            };
            ipcRenderer.send('stage-status', status);
        }, 250);
